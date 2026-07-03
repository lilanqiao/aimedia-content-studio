import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  Sparkles,
  Loader2,
  Square,
  Copy,
  Check,
  X,
  FileText,
  Image as ImageIcon,
  Film,
  Save,
  UploadCloud,
  AudioLines,
  Eraser,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useApiConfig, useTracks, providerLabel, isConfigured, effectiveConfig } from '@/lib/store'
import { streamChat, type ChatMessage, type ContentPart } from '@/lib/llm'
import { addHistory } from '@/lib/history'
import { META_PROMPT_COPY, META_PROMPT_VISUAL, PAIR_HINT } from '@/lib/metaPrompt'
import { cacheGet, cacheSet } from '@/lib/pageCache'
import { idbGet, idbSet } from '@/lib/idbStore'
import { cn } from '@/lib/utils'

type Mode = 'samples' | 'pair'
type MatKind = 'text' | 'image' | 'video' | 'audio' | 'doc'
interface Material {
  id: string
  kind: MatKind
  name: string
  text?: string // 文本 / 文档抽取出的文字
  dataUrl?: string // 图片 / 视频 base64
}

const TEXT_EXT = ['txt', 'md', 'srt', 'vtt', 'json', 'csv', 'ass', 'lrc']
const uid = () => Math.random().toString(36).slice(2, 10)

async function readFile(file: File): Promise<Material> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  // Word .docx:zip 压缩包,readAsText 读出来是乱码,必须用 mammoth 抽正文。
  if (ext === 'docx') {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const mammoth = (await import('mammoth')).default // 用到才加载,别拖慢首屏
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      const text = value.trim()
      return {
        id: uid(),
        kind: 'doc',
        name: file.name,
        text: text || `[Word 文档为空或无可提取文字:${file.name}]`,
      }
    } catch {
      return {
        id: uid(),
        kind: 'doc',
        name: file.name,
        text: `[Word 文档解析失败:${file.name},可另存为 .docx 或复制文字粘贴]`,
      }
    }
  }

  // 老版 .doc(OLE 二进制)前端无法可靠解析,提示转 .docx。
  if (ext === 'doc') {
    return {
      id: uid(),
      kind: 'doc',
      name: file.name,
      text: `[旧版 .doc 无法解析:${file.name},请在 Word 里「另存为」.docx 后再上传]`,
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    if (TEXT_EXT.includes(ext) || file.type.startsWith('text/')) {
      reader.onload = () =>
        resolve({ id: uid(), kind: 'doc', name: file.name, text: String(reader.result) })
      reader.readAsText(file)
    } else if (file.type.startsWith('image/')) {
      reader.onload = () =>
        resolve({ id: uid(), kind: 'image', name: file.name, dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    } else if (file.type.startsWith('video/')) {
      reader.onload = () =>
        resolve({ id: uid(), kind: 'video', name: file.name, dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    } else if (file.type.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'aac', 'flac', 'aiff'].includes(ext)) {
      reader.onload = () =>
        resolve({ id: uid(), kind: 'audio', name: file.name, dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    } else {
      // 其他二进制(pdf/docx 等)无法在前端可靠抽取文字
      resolve({ id: uid(), kind: 'doc', name: file.name, text: `[无法解析的文件:${file.name},请改用文本/字幕]` })
    }
  })
}

export default function PromptStudio({ ptype }: { ptype: 'copy' | 'visual' }) {
  const { config, setConfig } = useApiConfig()
  const { addTrack, updateTrack } = useTracks()

  // 文案风格 / 画面风格 各自独立存(键按 ptype 加前缀),互不串内容。
  const pk = (n: string) => `gw_ps_${ptype}_${n}`

  // 通用版固定走「范文逆推」(去掉了原文→成品对照那种进阶喂料,买家用不上)
  const [mode] = useState<Mode>('samples')
  // 切板块:先读会话内存(瞬时还原);整页刷新:内存没了 → 下面 effect 从 IndexedDB 异步捞回(图片大,IndexedDB 才装得下)
  const [materials, setMaterials] = useState<Material[]>(() => cacheGet(pk('materials'), [] as Material[]))
  const [pairOriginal, setPairOriginal] = useState(() => localStorage.getItem(pk('pairOrig')) || '')
  const [pairResult, setPairResult] = useState(() => localStorage.getItem(pk('pairResult')) || '')
  const [note, setNote] = useState(() => localStorage.getItem(pk('note')) || '')

  // 生成的提示词改成「多版本」:每点一次生成就追加一版,永不覆盖,可前后翻看(同改文主页逻辑)。
  const [versions, setVersions] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(pk('versions')) || '[]') as string[]
    } catch {
      return []
    }
  })
  const [verCursor, setVerCursor] = useState<number>(() => {
    const n = Number(localStorage.getItem(pk('vercursor')))
    return Number.isFinite(n) ? n : 0
  })
  // 流式生成中的临时文本 + running 标志:都挂到模块缓存,切板块回来能接上正在跑的那次。
  const [streamOut, setStreamOut] = useState(() => cacheGet(pk('stream'), ''))
  const [running, setRunning] = useState(() => cacheGet(pk('running'), false))
  const [error, setError] = useState('')
  const [showApi, setShowApi] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 当前显示的版本:跑的时候看流式文本,跑完看选中的那一版。
  const totalVers = versions.length
  const safeCursor = Math.min(Math.max(0, verCursor), Math.max(0, totalVers - 1))
  const output = running ? streamOut : totalVers ? versions[safeCursor] ?? '' : ''

  // 在当前版本上原地编辑(用户手改生成结果)。
  function editCurrent(text: string) {
    setVersions((prev) => prev.map((v, i) => (i === safeCursor ? text : v)))
  }
  function goVer(delta: number) {
    const next = safeCursor + delta
    if (next < 0 || next >= totalVers) return
    setVerCursor(next)
  }

  // —— 输入 / 版本持久化(变一个写一个;materials/versions 可能含大体积,容量满就静默跳过)——
  useEffect(() => localStorage.setItem(pk('pairOrig'), pairOriginal), [pairOriginal])
  useEffect(() => localStorage.setItem(pk('pairResult'), pairResult), [pairResult])
  useEffect(() => localStorage.setItem(pk('note'), note), [note])
  // 先恢复、后保存:恢复完成前绝不写入,否则挂载时会用初始空数组把存档覆盖成空(就是"切回来啥都没了"的真凶)。
  const hydrated = useRef(false)
  useEffect(() => {
    let alive = true
    if (cacheGet(pk('materials'), [] as Material[]).length > 0) {
      hydrated.current = true // 会话内存有(切板块回来)→ 直接当已恢复
      return
    }
    // 内存空(整页刷新/首次)→ 从 IndexedDB 捞回,捞完才允许保存
    idbGet<Material[]>(pk('materials')).then((m) => {
      if (alive && Array.isArray(m) && m.length) setMaterials(m)
      hydrated.current = true
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!hydrated.current) return // 没恢复完不写,避免空值覆盖存档
    cacheSet(pk('materials'), materials)
    idbSet(pk('materials'), materials)
  }, [materials])
  useEffect(() => {
    try {
      localStorage.setItem(pk('versions'), JSON.stringify(versions))
      localStorage.setItem(pk('vercursor'), String(safeCursor))
    } catch {
      /* 容量满忽略 */
    }
  }, [versions, safeCursor])

  // 生成挂在模块级:切走再回来(组件重挂)靠轮询接上正在跑的那次;跑完(可能是在别的板块时完成的)自动刷到最新版本。
  const lastRunRef = useRef(cacheGet(pk('running'), false))
  useEffect(() => {
    const t = setInterval(() => {
      const r = cacheGet<boolean>(pk('running'), false)
      if (r) setStreamOut(cacheGet(pk('stream'), ''))
      if (r !== lastRunRef.current) {
        setRunning(r)
        if (!r) {
          // 由跑→停:这次生成结束,从 localStorage 重载版本并跳到最新
          try {
            const vs = JSON.parse(localStorage.getItem(pk('versions')) || '[]') as string[]
            setVersions(vs)
            setVerCursor(Math.max(0, vs.length - 1))
          } catch { /* ignore */ }
          setStreamOut('')
        }
        lastRunRef.current = r
      }
    }, 400)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 文案模式「粘贴框」的临时文字(粘一篇→点加入→清空,再粘下一篇)。也存内存缓存,切板块不丢半截粘的。
  const [pasteText, setPasteText] = useState(() => cacheGet(pk('paste'), ''))
  useEffect(() => { cacheSet(pk('paste'), pasteText) }, [pasteText])
  function addPasted() {
    const t = pasteText.trim()
    if (!t) return
    setMaterials((prev) => [...prev, { id: uid(), kind: 'doc', name: '粘贴的范文', text: t }])
    setPasteText('')
  }

  // 从知识库(gbrain)把你存过的成品全捞回来当素材:文案页拉改文/原创文成品,画面页拉配图记录。
  // 拉进来后照常点「生成」提炼,再「存为风格」覆盖更新——成品越攒越多,风格卡越提越准。
  const [loadingKb, setLoadingKb] = useState(false)
  async function loadFromGbrain() {
    if (loadingKb) return
    const prefixes = ptype === 'visual'
      ? ['图文工坊-配图']
      : ['图文工坊-改文', '图文工坊-原创文']
    setLoadingKb(true)
    setError('')
    try {
      const resp = await fetch('/gbrain-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error || '读取知识库失败')
      const items: { slug: string; content: string }[] = data.items || []
      if (!items.length) {
        window.alert('知识库里还没有存过的成品。先在「改文/原创文」里改到满意,点「存知识库」攒几篇,再回来更新风格卡。')
        return
      }
      setMaterials((prev) => [
        ...prev,
        ...items.map((it) => ({ id: uid(), kind: 'doc' as const, name: `知识库·${it.slug}`, text: it.content })),
      ])
      window.alert(`已从知识库拉入 ${items.length} 篇成品。现在点「生成」重新提炼,再「存为风格」就能更新你的风格卡。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingKb(false)
    }
  }

  // 一键清空本页全部:输入素材 + 对照 + 想法 + 所有生成版本。只有手动点才清。
  function clearAll() {
    setMaterials([])
    setPairOriginal('')
    setPairResult('')
    setNote('')
    setVersions([])
    setVerCursor(0)
    setStreamOut('')
    setError('')
  }

  // 画面提取走文字线路(默认订阅):代理已能把图片存临时文件给 claude -p / codex 读,所以订阅也看得了图;
  // 中转站(gpt-5.5)也能看图。两条都行。
  const eff = effectiveConfig(config)
  const configured = isConfigured(config)
  const canRun =
    ptype === 'visual'
      ? materials.length > 0 || note.trim().length > 0
      : mode === 'samples'
        ? materials.length > 0 || note.trim().length > 0
        : !!(pairOriginal.trim() && pairResult.trim())

  async function addFiles(files: FileList | null) {
    if (!files) return
    const read = await Promise.all(Array.from(files).map(readFile))
    setMaterials((prev) => [...prev, ...read])
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  function buildMessages(): ChatMessage[] {
    const parts: ContentPart[] = []
    let header = ptype === 'visual' ? META_PROMPT_VISUAL : META_PROMPT_COPY
    if (ptype === 'copy' && mode === 'pair') header += PAIR_HINT

    if (ptype === 'copy' && mode === 'pair') {
      parts.push({
        type: 'text',
        text: `【原文】\n${pairOriginal}\n\n【改写后成品】\n${pairResult}`,
      })
    } else {
      materials.forEach((m, i) => {
        if (m.kind === 'text' || m.kind === 'doc') {
          parts.push({ type: 'text', text: `【素材${i + 1}·${m.name || '文本'}】\n${m.text ?? ''}` })
        } else if (m.dataUrl) {
          parts.push({ type: 'text', text: `【素材${i + 1}·${m.kind === 'video' ? '视频' : '图片'}:${m.name}】` })
          parts.push({ type: 'image_url', image_url: { url: m.dataUrl } })
        }
      })
    }
    if (note.trim()) parts.push({ type: 'text', text: `【我的补充要求】\n${note.trim()}` })

    // ⚠️ user 消息末尾焊一句明确动作指令。否则模型读完煽动性范文后会顺着调性
    // 又仿写一篇文章,而不是逆向拆成提示词框架(用户实际踩到的 bug:范文逆推吐出文章)。
    // 放在所有素材之后,是模型读完素材立刻看到的最后一条要求。
    parts.push({
      type: 'text',
      text: '【你现在要做的】逆向拆解以上素材的写作套路,按 system 要求只输出一套可复用的"创作系统提示词"框架。⚠️不是仿写文章、不是复述或续写素材,而是产出"以后照着写就能复刻这种风格"的提示词本身。',
    })

    return [
      { role: 'system', content: header },
      { role: 'user', content: parts.length ? parts : '请基于以上要求生成提示词。' },
    ]
  }

  async function handleGenerate() {
    setError('')
    if (!configured) {
      setShowApi(true)
      return
    }
    if (!canRun) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setStreamOut('')
    cacheSet(pk('running'), true) // 模块级:即使切板块卸载了组件,下面的循环仍把进度写进缓存
    cacheSet(pk('stream'), '')
    let full = ''
    try {
      for await (const delta of streamChat(eff, buildMessages(), controller.signal)) {
        full += delta
        setStreamOut(full)
        cacheSet(pk('stream'), full) // 模块级写入,卸载后也有效
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!controller.signal.aborted) setError(msg === 'NO_CONFIG' ? '请先配置模型 API' : msg)
    } finally {
      abortRef.current = null
      if (full.trim()) {
        // 直接落 localStorage(即使组件已被切走卸载,这次结果也不丢);挂载时的 setState 同步即时显示。
        try {
          const cur = JSON.parse(localStorage.getItem(pk('versions')) || '[]') as string[]
          const next = [...cur, full]
          localStorage.setItem(pk('versions'), JSON.stringify(next))
          localStorage.setItem(pk('vercursor'), String(next.length - 1))
        } catch { /* ignore */ }
        setVersions((prev) => {
          setVerCursor(prev.length)
          return [...prev, full]
        })
        setStreamOut('')
        addHistory('prompt', `${ptype === 'visual' ? '画面' : '文案'}提示词`, full)
      }
      cacheSet(pk('stream'), '')
      cacheSet(pk('running'), false) // 必须最后置 false,轮询靠它判断"跑完了"
      setRunning(false)
    }
  }

  // 风格(改写用) = 给原文→改写成这个风格;风格(原创文用) = 给主题→按这个风格从零写。
  // 两批分开存,去对应板块才看得到。
  function saveAsTrack(kind: 'rewrite' | 'original' | 'visual') {
    const where = kind === 'original' ? '原创文' : kind === 'visual' ? '配图' : '改文'
    const what = kind === 'visual' ? '画面风格' : '风格'
    const name = window.prompt(`给这套风格${what}起个名字(比如风格名):`, kind === 'visual' ? '新画面风格' : '新风格')
    if (name == null) return
    const id = addTrack(name, kind)
    updateTrack(id, { prompt: output })
    window.alert(
      kind === 'visual'
        ? `已保存画面风格「${name || '新画面风格'}」。去「配图」板块选它,把文案配成这个画面风格的图。`
        : `已保存风格「${name || '新风格'}」。去「${where}」板块就能选到它,按这套风格出文案。`
    )
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        providerLabel={providerLabel(config)}
        configured={configured}
        onOpenSettings={() => setShowApi(true)}
      />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-2">
        {/* 左:素材 */}
        <div className="glass-card flex flex-col gap-4 rounded-2xl bg-card/80 p-5">
          <div>
            <h3 className="text-base font-bold text-primary">
              {ptype === 'copy' ? '提炼文案风格' : '提炼画面风格'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {ptype === 'copy'
                ? '丢范文(Word/文本)→ 拆出"怎么写文案"的风格提示词,存起来给改文/原创文用。'
                : '丢作品图片(原图/截图)→ 看图拆出"怎么做画面(色彩/构图/风格)"的提示词,存起来给配图用。'}
            </p>
          </div>

          {/* 通用版只保留「范文逆推」一种喂料方式(丢范文→出风格),不让买家纠结进阶玩法 */}
          {!(ptype === 'copy' && mode === 'pair') ? (
            <>
              {/* 文案模式:① 粘贴框(一次一篇) */}
              {ptype === 'copy' && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-foreground/70">① 粘贴范文(一次粘一篇)</h4>
                  <Textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="把一篇范文的文字粘到这里,点「加入」算一篇;再粘下一篇…"
                    className="min-h-[90px] resize-none text-sm"
                  />
                  <Button size="sm" className="self-start" disabled={!pasteText.trim()} onClick={addPasted}>
                    加入(算一篇)
                  </Button>
                </div>
              )}

              {/* ② 拖拽 / 上传文件(可多篇) */}
              {ptype === 'copy' && <h4 className="text-xs font-semibold text-foreground/70">② 拖拽 / 上传文件(可多篇)</h4>}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed py-6 text-center text-sm transition-colors',
                  dragOver ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:bg-secondary/50 text-muted-foreground'
                )}
              >
                <UploadCloud className="mb-2 h-6 w-6" />
                {ptype === 'visual' ? (
                  <>
                    拖拽 / 点击上传图片
                    <span className="mt-0.5 block text-xs">作品图片(原图/截图都行,建议 5–10 张)</span>
                  </>
                ) : (
                  <>
                    拖拽 / 点击上传文件
                    <span className="mt-0.5 block text-xs">Word / 文本,可多篇</span>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ptype === 'visual' ? 'image/*' : '.txt,.md,.doc,.docx'}
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
              />

              {/* 从知识库更新风格卡:把你存过的满意成品全捞回来当素材,提炼出更准的风格 */}
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-primary">
                  🧠 从知识库更新风格卡
                </div>
                <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                  {ptype === 'visual'
                    ? '把你在「配图」里存进知识库的出图提示词全拉回来,提炼成更准的画面风格。'
                    : '把你在「改文/原创文」里改到满意、存进知识库的成品全拉回来,提炼成更贴近你口味的风格。攒得越多越准。'}
                </p>
                <Button size="sm" variant="outline" className="self-start" disabled={loadingKb} onClick={loadFromGbrain}>
                  {loadingKb ? '正在从知识库读取…' : '从知识库拉入成品'}
                </Button>
              </div>

              <div className="space-y-2">
                {materials.map((m) => (
                  <MaterialCard
                    key={m.id}
                    material={m}
                    ptype={ptype}
                    onChangeText={(t) =>
                      setMaterials((prev) => prev.map((x) => (x.id === m.id ? { ...x, text: t } : x)))
                    }
                    onRemove={() => setMaterials((prev) => prev.filter((x) => x.id !== m.id))}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>原文</Label>
                <Textarea
                  value={pairOriginal}
                  onChange={(e) => setPairOriginal(e.target.value)}
                  placeholder="改写前的原文…"
                  className="min-h-[150px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>改写后成品</Label>
                <Textarea
                  value={pairResult}
                  onChange={(e) => setPairResult(e.target.value)}
                  placeholder="你满意的改写成品…"
                  className="min-h-[150px]"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>补充想法 / 要求(可选)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                ptype === 'visual'
                  ? '例如:色调更暖、背景虚化、多用特写、电影感、留白多一点…'
                  : '例如:这个风格要更口语、钩子更密、结尾留扣子…'
              }
              className="min-h-[70px]"
            />
          </div>

          {running ? (
            <Button variant="outline" size="lg" className="bg-card" onClick={() => abortRef.current?.abort()}>
              <Square className="h-4 w-4" /> 停止
            </Button>
          ) : (
            <Button size="lg" onClick={handleGenerate} disabled={!canRun}>
              <Sparkles className="h-4 w-4" /> 拆解并生成提示词
            </Button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {(materials.length > 0 || pairOriginal || pairResult || note || totalVers > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              disabled={running}
              onClick={clearAll}
            >
              <Eraser className="h-4 w-4" /> 清空
            </Button>
          )}
        </div>

        {/* 右:生成的提示词 */}
        <div className="glass-card flex flex-col rounded-2xl bg-card/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground/80">生成的提示词框架</h3>
            {output && (
              <div className="flex items-center gap-1">
                {totalVers > 1 && !running && (
                  <div
                    className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/40 px-1"
                    title="前后翻看历次生成的版本(只增不删,永不丢)"
                  >
                    <button
                      onClick={() => goVer(-1)}
                      disabled={safeCursor <= 0}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary disabled:opacity-30"
                      title="上一版"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[52px] text-center text-xs tabular-nums text-foreground">
                      第 {safeCursor + 1}/{totalVers} 版
                    </span>
                    <button
                      onClick={() => goVer(1)}
                      disabled={safeCursor >= totalVers - 1}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary disabled:opacity-30"
                      title="下一版"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(output)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已复制' : '复制'}
                </Button>
                {ptype === 'copy' ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => saveAsTrack('rewrite')} disabled={running}>
                      <Save className="h-4 w-4" /> 存为风格(改写用)
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => saveAsTrack('original')} disabled={running}>
                      <Save className="h-4 w-4" /> 存为风格(原创文用)
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => saveAsTrack('visual')} disabled={running}>
                    <Save className="h-4 w-4" /> 存为画面风格(配图用)
                  </Button>
                )}
              </div>
            )}
          </div>

          {output || running ? (
            <Textarea
              value={output}
              onChange={(e) => editCurrent(e.target.value)}
              readOnly={running}
              placeholder="生成中…"
              className="min-h-[420px] flex-1 resize-none font-mono text-xs leading-relaxed"
            />
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center text-muted-foreground">
              {running ? (
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
              ) : (
                <Sparkles className="mb-3 h-10 w-10 opacity-30" />
              )}
              <p>提示词将在这里生成</p>
              <p className="mt-1 text-xs">左侧丢素材 → 拆解 → 生成后可直接编辑、存为新风格</p>
            </div>
          )}
        </div>
      </main>

      {showApi && (
        <ApiSettingsModal config={config} onSave={setConfig} onClose={() => setShowApi(false)} />
      )}
    </div>
  )
}

function MaterialCard({
  material,
  onChangeText,
  onRemove,
}: {
  material: Material
  ptype?: 'copy' | 'visual'
  onChangeText: (t: string) => void
  onRemove: () => void
}) {
  const Icon =
    material.kind === 'image'
      ? ImageIcon
      : material.kind === 'video'
        ? Film
        : material.kind === 'audio'
          ? AudioLines
          : FileText
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="truncate text-xs font-medium">{material.name || '文本'}</span>
        <button onClick={onRemove} className="ml-auto text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>
      {material.kind === 'text' || material.kind === 'doc' ? (
        <Textarea
          value={material.text ?? ''}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="粘贴范文 / 稿子 / 字幕文本…"
          className="min-h-[90px] resize-none text-xs"
        />
      ) : material.kind === 'image' ? (
        <img src={material.dataUrl} alt={material.name} className="max-h-40 rounded-lg" />
      ) : material.kind === 'audio' ? (
        <audio src={material.dataUrl} controls className="w-full" />
      ) : (
        <video src={material.dataUrl} controls className="max-h-40 w-full rounded-lg" />
      )}
    </div>
  )
}
