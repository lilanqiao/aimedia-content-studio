import { useEffect, useRef, useState } from 'react'
import {
  ImagePlus,
  Loader2,
  Sparkles,
  Square,
  Copy,
  Check,
  Download,
  ExternalLink,
  Eraser,
  Pencil,
} from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { TrackEditorModal } from '@/components/TrackEditorModal'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useApiConfig, useTracks, providerLabel, isConfigured, effectiveConfig, imageConfig } from '@/lib/store'
import { streamChat, generateImage } from '@/lib/llm'
import { addHistory } from '@/lib/history'
import { cacheGet, cacheSet } from '@/lib/pageCache'
import { cn } from '@/lib/utils'

interface Shot {
  id: string
  prompt: string
  caption?: string // 这张图对应的文案段(只有「按内容配图」有)
  image?: string
  imgLoading?: boolean
  error?: string
  copied?: boolean
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

type ImgMode = 'whole' | 'perSentence'

// 出图比例 → 实际尺寸(gpt-image-2 实测都能出)
const RATIOS = [
  { label: '1:1', size: '1024x1024' },
  { label: '3:4', size: '768x1024' },
  { label: '4:3', size: '1024x768' },
  { label: '9:16', size: '1080x1920' },
  { label: '16:9', size: '1920x1080' },
]

// 整篇随机:文案 + 画面风格 → 「出图提示词」。n 给数字=出固定张数;n 为 null=AI 自己决定。
function buildSystemWhole(styleDesc: string, n: number | null) {
  const howMany =
    n != null
      ? `产出 ${n} 段彼此不同、能配这篇文案的画面描述。`
      : '根据这篇文案的长度和内容,自己决定要出几张配图(一般 3~8 张,内容多就多出),产出对应段数、彼此不同、能配这篇文案的画面描述。'
  return [
    '你是自媒体图文配图的出图提示词专家。根据【文案】内容,产出可直接拿去 AI 出图的画面描述。',
    styleDesc
      ? `必须贴合这套风格的【画面风格】(色彩/光影/构图/质感都按它来):\n${styleDesc}`
      : '画面要干净、有质感、统一风格。',
    `${howMany}每段是一整段连贯的中文描述,涵盖:主体、场景、光影、色彩、构图,自然融入上面的画面风格。`,
    '铁律·真实朝向:人物在看/用手机、单据、屏幕、书本等物体时,物体按真实使用朝向(朝着人物自己、自然手持或低头看),绝不为了让观众看清内容就把它扭向镜头/正对观众;用过肩、侧面、俯视等自然机位,物体内容只露自然角度能看到的部分,宁可看不清内容也不许违反物理朝向。',
    '铁律:画面里如果出现任何文字,必须是简体中文,绝不出现英文/拼音/外语;能不放文字就不放文字(标题后期再加)。',
    '只输出这些段,段与段之间用一行 === 分隔,不要编号、不要标题、不要任何解释。',
  ].join('\n\n')
}

// 按内容配图:AI 通读文案,按语义/情节自己决定在哪切画面、出几张,逐段产出提示词,整组连贯。
function buildSystemBySemantics(styleDesc: string) {
  return [
    '你是自媒体图文配图的出图提示词专家。通读下面整篇【文案】,按内容和情节把它分成若干个画面——',
    '判断标准是语义:讲到下一件事、场景变了、情绪/重点转了,才切下一个画面;不要只看标点(一个问句、一句短话不一定单独成一张)。',
    styleDesc
      ? `每张都必须贴合这套风格的【画面风格】(色彩/光影/构图/质感):\n${styleDesc}`
      : '画面要干净、有质感、统一风格。',
    '画面数量由你按内容多少决定(短文案两三张、长文案多几张)。整组要像同一系列(同一主体/同一画风)前后连贯。',
    '铁律·真实朝向:人物在看/用手机、单据、屏幕、书本等物体时,物体按真实使用朝向(朝着人物自己、自然手持或低头看),绝不为了让观众看清内容就把它扭向镜头/正对观众;用过肩、侧面、俯视等自然机位,物体内容只露自然角度能看到的部分,宁可看不清内容也不许违反物理朝向。',
    '铁律:画面里如果出现任何文字,必须是简体中文,绝不出现英文/拼音/外语;能不放文字就不放文字。',
    '每个画面严格按这个格式输出(两行),画面之间用一行 === 分隔,不要编号/标题/解释:\n原文:<这一画面对应的那段文案原文,逐字摘抄>\n画面:<一整段连贯中文画面描述,涵盖主体/场景/光影/色彩/构图,融入画面风格>',
  ].join('\n\n')
}

// 解析「按内容配图」的输出:每块含「原文:」「画面:」两段。容错:缺标记时整块当画面提示词。
function parseSemantic(full: string): { caption: string; prompt: string }[] {
  return full
    .split(/\n?={3,}\n?/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const m = block.match(/原文[：:]\s*([\s\S]*?)\n+\s*画面[：:]\s*([\s\S]*)/)
      if (m) return { caption: m[1].trim(), prompt: m[2].trim() }
      return { caption: '', prompt: block.replace(/^画面[：:]\s*/, '').trim() }
    })
    .filter((x) => x.prompt)
}

export default function ImagePage() {
  const { tracks, updateTrack, removeTrack } = useTracks()
  const { config, setConfig } = useApiConfig()

  const visualStyles = tracks.filter((t) => t.kind === 'visual')
  const [styleId, setStyleId] = useState(() => localStorage.getItem('gw_img_style') || '')
  // 选中的画面风格;没选中/选的被删了就用第一个(有风格时总有一个生效)
  const activeStyle = visualStyles.find((s) => s.id === styleId) ?? visualStyles[0]
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingStyle = visualStyles.find((s) => s.id === editingId) ?? null

  const [input, setInput] = useState(() => localStorage.getItem('gw_img_input') || '')
  const [imgMode, setImgMode] = useState<ImgMode>(
    () => (localStorage.getItem('gw_img_mode') as ImgMode) || 'whole'
  )
  // 留空 = 自动随机(AI 按文案长短自己决定出几张);填了数字才按数字出
  const [countStr, setCountStr] = useState('')
  const [ratio, setRatio] = useState(() => localStorage.getItem('gw_img_ratio') || '1024x1024')
  // 出图结果:会话内存(切板块不丢) + localStorage(整页刷新也不丢;图是 URL 时体积小存得下)双保险
  const [shots, setShots] = useState<Shot[]>(() =>
    cacheGet('gw_img_shots', (() => {
      try {
        return JSON.parse(localStorage.getItem('gw_img_shots') || '[]') as Shot[]
      } catch {
        return []
      }
    })())
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [showApi, setShowApi] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const configured = isConfigured(config)
  const imgRoute = imageConfig(config) // null = 订阅模式 / 没填出图模型 → 只给提示词手动出
  const canAutoImage = !!imgRoute

  useEffect(() => localStorage.setItem('gw_img_input', input), [input])
  useEffect(() => localStorage.setItem('gw_img_mode', imgMode), [imgMode])
  useEffect(() => localStorage.setItem('gw_img_ratio', ratio), [ratio])
  useEffect(() => {
    cacheSet('gw_img_shots', shots)
    try {
      localStorage.setItem('gw_img_shots', JSON.stringify(shots))
    } catch {
      /* base64 图太大存不下时,靠内存缓存兜底 */
    }
  }, [shots])
  useEffect(() => localStorage.setItem('gw_img_style', styleId), [styleId])
  useEffect(() => {
    // 选中的画面风格被删了就回到「默认(不带风格)」;不强制选第一个
    if (styleId && !visualStyles.some((s) => s.id === styleId)) setStyleId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  async function handleGenerate() {
    setError('')
    if (!configured) {
      setShowApi(true)
      return
    }
    if (!input.trim()) return

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setShots([])

    try {
      // 1) 先用文字模型把 文案+画面风格 → 出图提示词
      const style = activeStyle?.prompt ?? ''
      let sys: string
      let userMsg: string
      let want: number
      if (imgMode === 'perSentence') {
        want = 99 // 张数由 AI 按内容决定,不截断
        sys = buildSystemBySemantics(style)
        userMsg = `【文案】\n${input}`
      } else {
        // 留空/非法 = 自动随机(AI 自己决定张数);填了数字才固定张数
        const parsed = parseInt(countStr, 10)
        const fixed = !Number.isNaN(parsed) && parsed >= 1 ? parsed : null
        want = fixed ?? 99 // 自动时不截断,模型出几张算几张
        sys = buildSystemWhole(style, fixed)
        userMsg = `【文案】\n${input}`
      }

      let full = ''
      for await (const delta of streamChat(
        effectiveConfig(config),
        [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
        controller.signal
      )) {
        full += delta
      }
      let base: Shot[]
      if (imgMode === 'perSentence') {
        // 按内容配图:每块含「原文」+「画面」,做成文案段↔图对照
        const segs = parseSemantic(full)
        if (!segs.length) throw new Error('没生成画面,换个文案再试')
        base = segs.map((s) => ({ id: uid(), prompt: s.prompt, caption: s.caption }))
      } else {
        const prompts = full
          .split(/\n?={3,}\n?/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, want)
        if (!prompts.length) throw new Error('没生成出图提示词,换个文案再试')
        base = prompts.map((p) => ({ id: uid(), prompt: p }))
      }
      setShots(base)
      addHistory(
        'prompt',
        `配图提示词 · ${input.slice(0, 20)}`,
        base.map((b) => (b.caption ? `【${b.caption}】\n${b.prompt}` : b.prompt)).join('\n\n===\n\n')
      )

      // 2) 中转站模式:逐张自动出图;订阅模式:停在提示词,买家手动出
      if (canAutoImage && imgRoute) {
        for (const s of base) {
          setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, imgLoading: true, error: undefined } : x)))
          // gpt-image-2 上游偶发抽风(bad_response_status_code),失败自动重试一次再报错
          let img = ''
          let lastErr: unknown = null
          for (let attempt = 0; attempt < 2 && !img; attempt++) {
            if (controller.signal.aborted) break
            try {
              img = await generateImage(imgRoute, s.prompt, controller.signal, ratio)
            } catch (e) {
              lastErr = e
              if ((e as Error).name === 'AbortError') break
            }
          }
          if (img) {
            setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, image: img, imgLoading: false } : x)))
          } else {
            setShots((prev) =>
              prev.map((x) =>
                x.id === s.id ? { ...x, imgLoading: false, error: lastErr instanceof Error ? lastErr.message : String(lastErr) } : x
              )
            )
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  function stop() {
    abortRef.current?.abort()
    setRunning(false)
  }

  function copyPrompt(s: Shot) {
    navigator.clipboard.writeText(s.prompt)
    setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, copied: true } : x)))
    setTimeout(() => setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, copied: false } : x))), 1500)
  }

  // 改了某张的提示词后,只重画这一张(用当前比例)
  async function repaint(s: Shot) {
    if (!imgRoute || !s.prompt.trim()) return
    setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, imgLoading: true, error: undefined } : x)))
    try {
      const img = await generateImage(imgRoute, s.prompt, undefined, ratio)
      setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, image: img, imgLoading: false } : x)))
    } catch (e) {
      setShots((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, imgLoading: false, error: e instanceof Error ? e.message : String(e) } : x))
      )
    }
  }

  // 一键重新生成所有"出了错没成图"的那几张(逐张重画,用各自当前提示词)
  async function repaintFailed() {
    if (!imgRoute) return
    const failed = shots.filter((s) => s.error && !s.image)
    for (const s of failed) await repaint(s)
  }

  // 拿到图片字节:data URL 直接解码;http 图(OSS)经代理 /img-download 拉,绕过跨域
  async function imageBlob(src: string): Promise<Blob> {
    if (src.startsWith('data:')) return await (await fetch(src)).blob()
    const r = await fetch(`/img-download?url=${encodeURIComponent(src)}&name=img.png`)
    if (!r.ok) throw new Error('下载失败')
    return await r.blob()
  }

  async function downloadOne(s: Shot, i: number) {
    if (!s.image) return
    try {
      const blob = await imageBlob(s.image)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `配图_${i + 1}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (e) {
      setError('下载失败:' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const [downloading, setDownloading] = useState(false)
  const [shotsSaved, setShotsSaved] = useState(false)

  async function saveShotsToGbrain() {
    const done = shots.filter((s) => s.prompt.trim())
    if (!done.length || shotsSaved) return
    const slug = `图文工坊-配图-${Date.now()}`
    const styleName = activeStyle?.name || '未选风格'
    const lines = done.map((s, i) => {
      const parts = [`## 画面${i + 1}`, `**出图提示词:** ${s.prompt}`]
      if (s.caption) parts.splice(1, 0, `**文案段:** ${s.caption}`)
      return parts.join('\n')
    })
    const content = [`# ${slug}`, `\n风格卡: ${styleName}`, ...lines].join('\n\n')
    try {
      const resp = await fetch('/gbrain-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, content }),
      })
      if (resp.ok) {
        setShotsSaved(true)
        setTimeout(() => setShotsSaved(false), 2000)
      }
    } catch { /* 静默失败 */ }
  }
  // 一键下载全部:Chrome 能选文件夹(直接写进去);其它浏览器逐张下到默认下载目录
  async function downloadAll() {
    const imgs = shots.filter((s) => s.image)
    if (!imgs.length || downloading) return
    setDownloading(true)
    setError('')
    try {
      const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (picker) {
        const dir = await picker()
        for (let i = 0; i < imgs.length; i++) {
          const blob = await imageBlob(imgs[i].image!)
          const fh = await dir.getFileHandle(`配图_${i + 1}.png`, { create: true })
          const w = await fh.createWritable()
          await w.write(blob)
          await w.close()
        }
      } else {
        for (let i = 0; i < imgs.length; i++) {
          const blob = await imageBlob(imgs[i].image!)
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `配图_${i + 1}.png`
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    } catch (e) {
      // 用户取消文件夹选择会抛 AbortError,忽略
      if ((e as Error).name !== 'AbortError') setError('下载失败:' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        providerLabel={providerLabel(config, 'image')}
        configured={isConfigured(config, 'image')}
        onOpenSettings={() => setShowApi(true)}
      />

      <div className="mx-auto max-w-7xl px-4 pt-5">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-base font-bold text-primary">配图</h2>
          <span className="text-xs text-muted-foreground">一段文案 + 画面风格 → 配套的图,给任意平台的内容配图</span>
        </div>

        {/* 画面风格选择:点风格名选用它,点铅笔改名/改提示词/删除(跟改文一样) */}
        <div className="mb-1">
          <div className="mb-1 text-xs text-muted-foreground">画面风格(点一个用它出图)</div>
          <div className="flex flex-wrap items-center gap-2">
            {visualStyles.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-1 rounded-full pl-4 pr-2 py-1 text-sm font-medium transition-all',
                  activeStyle?.id === s.id
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30'
                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
                )}
              >
                <button onClick={() => setStyleId(s.id)}>{s.name}</button>
                <button
                  onClick={() => setEditingId(s.id)}
                  className={cn('rounded-full p-1 transition-colors', activeStyle?.id === s.id ? 'hover:bg-white/20' : 'hover:bg-foreground/10')}
                  title="改名 / 改提示词 / 删除"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          {visualStyles.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              还没有画面风格。去「提炼画面风格」拆一套、点「存为画面风格」,这里就会出现,点铅笔还能改/删。
            </p>
          )}
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-5 lg:grid-cols-2">
        {/* 左:文案 */}
        <div className="glass-card flex flex-col rounded-2xl bg-card/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary">文案</h3>
            {input && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={running}
                onClick={() => {
                  setInput('')
                  setShots([])
                }}
              >
                <Eraser className="h-4 w-4" /> 清空
              </Button>
            )}
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴文案,会按文案内容 + 选中的画面风格出配图…"
            className="min-h-[280px] flex-1 resize-none text-sm leading-relaxed"
          />

          {/* 出图比例 */}
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">比例</span>
            {RATIOS.map((r) => (
              <button
                key={r.size}
                onClick={() => setRatio(r.size)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                  ratio === r.size ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* 两种出图方式 */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setImgMode('whole')}
              className={cn(
                'flex-1 rounded-xl border px-3 py-2 text-left text-xs transition-all',
                imgMode === 'whole'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary/40 text-muted-foreground hover:bg-secondary'
              )}
            >
              <div className="text-sm font-semibold">整篇配几张</div>
              出你要的张数,图不对应具体段落(当封面/点缀图)
            </button>
            <button
              onClick={() => setImgMode('perSentence')}
              className={cn(
                'flex-1 rounded-xl border px-3 py-2 text-left text-xs transition-all',
                imgMode === 'perSentence'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary/40 text-muted-foreground hover:bg-secondary'
              )}
            >
              <div className="text-sm font-semibold">分镜配图</div>
              像分镜一样拆成一个个画面,每个画面配一张图
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {imgMode === 'whole' ? (
              <>
                <span className="text-xs text-muted-foreground">出几张</span>
                <input
                  type="number"
                  min={1}
                  value={countStr}
                  placeholder="自动"
                  onChange={(e) => setCountStr(e.target.value)}
                  className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-center text-sm font-semibold focus:border-primary focus:outline-none"
                />
                <span className="text-xs text-muted-foreground">
                  {countStr.trim() ? '张' : '留空=AI 按文案自动决定'}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">AI 按文案内容拆分镜、自动决定几个画面</span>
            )}
            <div className="flex-1" />
            {running ? (
              <Button variant="outline" onClick={stop}>
                <Square className="h-4 w-4" /> 停止
              </Button>
            ) : (
              <Button onClick={handleGenerate} disabled={!input.trim()}>
                <Sparkles className="h-4 w-4" /> {canAutoImage ? '出配图' : '出提示词'}
              </Button>
            )}
          </div>
          {!canAutoImage && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              还没配出图中转站——去「设置」填中转站地址 + Key + 出图模型就能自动出图;现在先只给提示词,点「打开 ChatGPT」用你自己会员手动出。
            </p>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>

        {/* 右:结果 */}
        <div className="glass-card flex flex-col gap-4 rounded-2xl bg-card/80 p-5">
          {running && shots.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-primary">
              <Loader2 className="mb-3 h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">正在拆文案、生成画面提示词…</p>
              <p className="mt-1 text-xs text-muted-foreground">{canAutoImage ? '稍后逐张出图' : '稍后给出图提示词'}</p>
            </div>
          ) : shots.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
              <ImagePlus className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">{canAutoImage ? '配图会在这里显示' : '出图提示词会在这里显示'}</p>
            </div>
          ) : (
            <>
            {(shots.some((s) => s.image) || shots.some((s) => s.error && !s.image)) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {shots.filter((s) => s.image).length} 张已出
                  {shots.some((s) => s.error && !s.image) && ` · ${shots.filter((s) => s.error && !s.image).length} 张失败`}
                </span>
                <div className="flex-1" />
                {canAutoImage && shots.some((s) => s.error && !s.image) && (
                  <Button variant="outline" size="sm" className="bg-card" onClick={repaintFailed} disabled={running || downloading}>
                    <Sparkles className="h-4 w-4" /> 重新生成失败的 {shots.filter((s) => s.error && !s.image).length} 张
                  </Button>
                )}
                {shots.some((s) => s.image) && (
                  <Button variant="outline" size="sm" className="bg-card" onClick={downloadAll} disabled={downloading}>
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {downloading ? '下载中…' : '一键下载全部图片(选文件夹)'}
                  </Button>
                )}
                {shots.some((s) => s.prompt.trim()) && (
                  <Button variant="outline" size="sm" className="bg-card" onClick={saveShotsToGbrain} disabled={shotsSaved} title="把这批出图提示词 + 文案存进 gbrain 知识库">
                    {shotsSaved ? <Check className="h-4 w-4 text-emerald-600" /> : <span className="text-xs">🧠</span>}
                    {shotsSaved ? '已存入' : '存知识库'}
                  </Button>
                )}
              </div>
            )}
            {shots.map((s, i) => (
              <div key={s.id} className="rounded-xl border border-border bg-card p-3">
                {s.caption && (
                  <div className="mb-2 flex gap-2 rounded-lg bg-secondary/50 p-2">
                    <span className="shrink-0 text-xs font-bold text-primary">画面{i + 1}</span>
                    <p className="text-xs leading-relaxed text-foreground">{s.caption}</p>
                  </div>
                )}
                {s.imgLoading && (
                  <div className="flex h-48 items-center justify-center text-muted-foreground">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 出图中…
                  </div>
                )}
                {s.image && (
                  <div className="mb-2">
                    <img src={s.image} alt={`配图${i + 1}`} className="w-full rounded-lg" />
                    <Button variant="outline" size="sm" className="mt-2 bg-card" onClick={() => downloadOne(s, i)}>
                      <Download className="h-4 w-4" /> 下载
                    </Button>
                  </div>
                )}
                {s.error && <p className="mb-2 text-xs text-destructive">出图失败:{s.error}</p>}

                {/* 提示词可改,改完点「重画」只重出这一张 */}
                <Textarea
                  value={s.prompt}
                  onChange={(e) => setShots((prev) => prev.map((x) => (x.id === s.id ? { ...x, prompt: e.target.value } : x)))}
                  className="min-h-[72px] resize-none text-xs leading-relaxed"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyPrompt(s)}>
                    {s.copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {s.copied ? '已复制' : '复制提示词'}
                  </Button>
                  {canAutoImage && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => repaint(s)} disabled={s.imgLoading}>
                      <Sparkles className="h-3.5 w-3.5" /> {s.image ? '改了重画' : '重画'}
                    </Button>
                  )}
                  {!s.image && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(s.prompt)
                        window.open('https://chatgpt.com', '_blank')
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> 打开 ChatGPT
                    </Button>
                  )}
                </div>
              </div>
            ))}
            </>
          )}
        </div>
      </main>

      {showApi && (
        <ApiSettingsModal config={config} onSave={setConfig} onClose={() => setShowApi(false)} context="image" />
      )}

      {editingStyle && (
        <TrackEditorModal
          track={editingStyle}
          canDelete
          onSave={(patch) => updateTrack(editingStyle.id, patch)}
          onDelete={() => {
            removeTrack(editingStyle.id)
            setEditingId(null)
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}
