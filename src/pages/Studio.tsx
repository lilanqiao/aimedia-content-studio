import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Pencil,
  Sparkles,
  Copy,
  Check,
  Loader2,
  Square,
  ClipboardPaste,
  Eraser,
  FileText,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Stethoscope,
  ImagePlus,
} from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { TrackEditorModal } from '@/components/TrackEditorModal'
import { useApiConfig, useTracks, providerLabel, isConfigured, effectiveConfig } from '@/lib/store'
import { addHistory } from '@/lib/history'
import { streamRewrite, streamChat } from '@/lib/llm'
import type { ChatMessage } from '@/lib/llm'
import type { RewriteResult } from '@/lib/types'
import { cn } from '@/lib/utils'

// 口播字数:只数真正"读出来"的字(中文/字母/数字),不含标点、空格、换行、emoji——
// 这样字数才能对应口播时长,而不是被标点撑大。
function spokenLen(s: string): number {
  return (s.match(/[㐀-䶿一-鿿豈-﫿a-zA-Z0-9]/g) || []).length
}

// 时长区间:按解说/口播作者的快语速估,约 400(快)→300(适中)字/分钟。
// 依据:影视解说文案普遍 2000–3000 字、配 6–8 分钟成片 ≈ 330–375 字/分;
// 广播新闻/播音员约 300 字/分。所以 1000 字 ≈ 2.5–3.3 分钟。
function durationHint(len: number): string {
  if (!len) return ''
  const fmt = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString())
  return `≈ ${fmt(len / 400)}–${fmt(len / 300)} 分钟`
}

// 通用版:篇幅由"这套风格"决定,不写死字数(作者可能是小红书短文/公众号长文/口播,各不相同)。
// 自动精炼护栏设到极高,正常内容永不触发——长度跟着风格走,不强行压缩。
const COMPRESS_LIMIT = 100000
const COMPRESS_SYS = `把下面这篇文案在保持原风格、立场、语气的前提下精炼一下,删掉明显的重复和啰嗦,出来仍是一篇完整连贯的文案,不是摘要。直接输出正文,不要任何说明。`

// 篇幅护栏:跟着这套风格走,不写死字数。
const LENGTH_GUIDE =
  '\n\n【篇幅 · 跟着上面这套风格走】这套风格里范文的文案大概多长,你就写多长的量级——他写短你就短、他写长你就长,不要硬凑也不要硬砍。把每个点讲透、信息密、钩子密,禁止注水重复,每一句都要有实质内容。'
// 每次调用只产出一篇,禁止模型自己塞多个【版本N】。
const ONE_PER_CALL =
  '\n\n【本次只输出一篇完整文案,直接给正文,不要分多个版本、不要出现"版本一/版本N/方案N"之类的分段标记。】'
// 原创文模式:盖过风格提示词里"改写原文"的设定,告诉模型用户给的是主题而非待改写原文。
const ORIGINAL_GUIDE =
  '\n\n【本次是「按风格原创文」任务,不是改写】用户给的是一个【主题/选题方向】,不是一篇待改写的原文。请基于这个主题,用你上面这套风格的口吻、结构和方法,从零写一篇全新的完整文案。绝不要把主题文字本身当成原文逐句改写或扩写——把它当成"写什么"的命题,自己组织开头、论述和结尾。'

const ORIGINAL_LENGTH_GUIDE = LENGTH_GUIDE
const ORIGINAL_COMPRESS_LIMIT = COMPRESS_LIMIT
const ORIGINAL_COMPRESS_SYS = COMPRESS_SYS

function lengthCfgFor(mode: 'rewrite' | 'original') {
  return mode === 'original'
    ? { guide: ORIGINAL_LENGTH_GUIDE, compressLimit: ORIGINAL_COMPRESS_LIMIT, compressSys: ORIGINAL_COMPRESS_SYS }
    : { guide: LENGTH_GUIDE, compressLimit: COMPRESS_LIMIT, compressSys: COMPRESS_SYS }
}

// 快捷指令库:把常用的手动改写动作,变成点一下就执行的预设指令。
// 覆盖:去AI味/呢吗肯定句、观点穿插、精炼降字、丰满内容、代入感、加情绪、深抠开头、换视角、换案例。
// 点按钮 = 直接拿这条指令在"上一版"基础上迭代;如果意见框里还写了字,会一起带上。
const QUICK_FIXES: { label: string; instruction: string }[] = [
  { label: '去AI味·更口语', instruction: '去除AI味,你写的ai词太多、不够日常口语化。去掉"呢""吗""吧"这类句尾语气词,多用肯定句式;不要翻译腔、不要空洞的排比句,文字要像刀子直插现实,像跟朋友撂大实话。' },
  { label: '加代入感', instruction: '加强代入感、用观众视角:把抽象、书面、第三人称的表述,换成普通人脑子里真实转过的那句念头,让观众读起来觉得"这说的就是我"。比如把"想让父母扬眉吐气"换成"想让父母腰杆挺直、有个好儿子"这种大白话心里话。' },
  { label: '观点织成网', instruction: '不要每个观点都单独拎出来一段一段地罗列,把这些观点结合穿插,写成一篇完整、有衔接、相互勾连的文章,上一层顺势带出下一层,读起来是连贯的一席话,就像在讲观众自己的事,看完有获得感。' },
  { label: '精炼降字', instruction: '逻辑是对的,但写得太啰嗦拖沓了,继续精炼,字数往下降,把废话和重复都砍掉,但要保证内容质量和深度不掉。' },
  { label: '丰满内容', instruction: '还是不够好:重复啰嗦、不紧凑,整体读起来像流水账,逻辑不紧密。你可以加入原文之外的相关观点和具体案例,把内容丰满起来,让逻辑更咬合、信息更密。' },
  { label: '情绪更浓', instruction: '情绪太平淡了,在关键句子上把情绪适度拉起来,让人读着更有共鸣、更走心;用词要贴合这套风格的语气,不要堆形容词、不要喊口号、不要为了煽情而煽情。' },
  { label: '深抠开头', instruction: '重点打磨开头:第一句保持不变,后面快速进正文,中间多余的过渡和铺垫全砍掉;开头这段每个字都抠到读出来顺口、不绕舌、没有一个多余字,删掉所有AI腔和废话;第一句之后立刻用一句反差或抓人的话把人拉住。' },
  { label: '换/简案例', instruction: '把文中举例说明的案例替换或精简:替换就换成更贴近普通人生活、更有画面感、逻辑也站得住的新例子;案例本身要简短精炼,不要拖沓。' },
]

// 版本状态读取(带旧数据迁移):没有 versions 字段的老结果,从 history+text 推出全量版本列表,
// 这样"只增不删 + 前后翻页"对老稿子也立即生效,不丢任何历史版本。
function verState(r: RewriteResult): { versions: string[]; cursor: number } {
  const versions = r.versions ?? [...(r.history ?? []), ...(r.text ? [r.text] : [])]
  const cursor = r.cursor ?? Math.max(0, versions.length - 1)
  return { versions, cursor }
}

export default function Studio({ mode = 'rewrite' }: { mode?: 'rewrite' | 'original' }) {
  const { tracks, addTrack, updateTrack, removeTrack } = useTracks()
  const { config, setConfig } = useApiConfig()

  // 生成模式由路由决定:'/'=改文(给原文→改写),'/original'=原创文(给主题→从零原创)。
  // 两个 tab 共用本组件但 key 不同 → 各自独立挂载;localStorage 键按模式加前缀,各记各的内容。
  const genMode = mode
  const sk = (name: string) => `${genMode === 'original' ? 'gw_orig' : 'gw_studio'}_${name}`

  // 选中的风格也持久化:刷新后保持上次选的那个;存的风格被删了就回退到第一个。
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(sk('active'))
    if (saved && tracks.some((t) => t.id === saved)) return saved
    return tracks[0]?.id ?? ''
  })
  // 原文/主题 + 结果持久化:切到别的板块再切回来、刷新页面都保留
  const [input, setInput] = useState(() => localStorage.getItem(sk('input')) || '')
  // 热门评论:可选的"观点素材",和原文一样每条视频都换,所以做成独立输入框、独立持久化。
  const [comments, setComments] = useState(() => localStorage.getItem(sk('comments')) || '')
  // 我的要求:可选的"本篇指令"(加重某种情绪/换钩子/改某个点),优先级最高,只对这次首改生效。
  const [directive, setDirective] = useState(() => localStorage.getItem(sk('directive')) || '')
  const [count, setCount] = useState(1)
  const [results, setResults] = useState<RewriteResult[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(sk('results')) || '[]') as RewriteResult[]
      // 迁移老结果:补上 versions/cursor(从 history+text 推),老稿子也能前后翻页、不丢版本。
      return raw.map((r) => (r.versions ? r : { ...r, ...verState(r) }))
    } catch {
      return []
    }
  })
  const [running, setRunning] = useState(false)
  const [merging, setMerging] = useState(false)
  const mergeAbortRef = useRef<AbortController | null>(null)
  const [error, setError] = useState('')
  const [showApi, setShowApi] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const docFileRef = useRef<HTMLInputElement>(null)
  const [importingDoc, setImportingDoc] = useState(false)
  const inputAreaRef = useRef<HTMLTextAreaElement>(null)

  // 提到 effect 之前声明:下面的自动判断 effect 依赖 configured/eff。
  // 当前模式可见的风格:改文模式只看改文型,原创模式只看原创型(缺省=改文,兼容老数据)。
  const visibleTracks = tracks.filter((t) => (t.kind ?? 'rewrite') === genMode)
  const activeTrack = visibleTracks.find((t) => t.id === activeId) ?? visibleTracks[0]
  const editingTrack = tracks.find((t) => t.id === editingId) ?? null
  const eff = effectiveConfig(config)
  const configured = isConfigured(config)

  useEffect(() => {
    if (activeId) localStorage.setItem(sk('active'), activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])
  // 当前批(本模式)风格没选中过 / 选中的被删了,自动选回该批第一个。
  useEffect(() => {
    const vis = tracks.filter((t) => (t.kind ?? 'rewrite') === genMode)
    if (!vis.some((t) => t.id === activeId)) setActiveId(vis[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])
  useEffect(() => {
    localStorage.setItem(sk('input'), input)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])
  useEffect(() => {
    localStorage.setItem(sk('comments'), comments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments])
  useEffect(() => {
    localStorage.setItem(sk('directive'), directive)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directive])
  useEffect(() => {
    // 只存已完成的结果,避免把流式中间态存进去
    try {
      localStorage.setItem(sk('results'), JSON.stringify(results))
    } catch {
      /* 容量满忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  function handleAddTrack() {
    // 新风格归入当前模式那一批(改文模式建改文风格,原创模式建原创风格)。
    const id = addTrack(genMode === 'original' ? '新原创风格' : '新风格', genMode)
    setActiveId(id)
    setEditingId(id)
  }

  async function handleRewrite() {
    setError('')
    if (!configured) {
      setShowApi(true)
      return
    }
    if (!input.trim() || !activeTrack) return

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)

    const trackName = activeTrack.name
    const origin = input
    const trackPrompt = activeTrack.prompt

    const initial: RewriteResult[] = Array.from({ length: count }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      text: '',
      done: false,
      // 快照原文+风格,迭代再改时当稳定上下文(之后换原文/风格也不影响这版)。
      origin,
      trackPrompt,
      version: 1,
      versions: [],
      cursor: 0,
    }))
    setResults(initial)

    // 评论作为"观点素材"拼进 user 消息,并给系统提示词补一条「怎么用评论」的规则。
    // 评论留空时,userMsg=原文、commentGuide='',行为与以前完全一致。
    const isOriginal = genMode === 'original'
    const lc = lengthCfgFor(genMode)
    const srcLabel = isOriginal ? '主题/选题' : '原文案'
    const hasComments = comments.trim().length > 0
    const userMsg = hasComments
      ? `【${srcLabel}】\n${input}\n\n【热门评论(观众的真实反应,仅作观点参考)】\n${comments.trim()}`
      : isOriginal
        ? `【主题/选题】\n${input}`
        : input
    const commentGuide = hasComments
      ? '\n\n【关于热门评论】用户附了该视频的热门评论,仅供参考。你需要先判断:这些评论里有没有能让改写后的文案更好的内容——比如观众说出了原文没触达的痛点、补充了更有共鸣的角度、或者揭示了一个值得深挖的情绪。如果有,就把这个点自然融入正文,不要照搬原话、不要逐条复述;如果评论里没有真正有价值的内容,就完全忽略它们,按原文正常改写即可。评论是否有用,由你判断——不用因为有评论就强行塞进去。'
      : ''
    // 我的要求:本篇专属指令,优先级最高。留空时 directiveGuide='',行为与以前完全一致。
    const directiveGuide = directive.trim()
      ? `\n\n【本篇特别要求(优先级最高,必须执行)】\n${directive.trim()}\n以上是我针对这一篇的具体要求,在不破坏文案基本质量的前提下,优先满足这些要求。`
      : ''
    await Promise.all(
      initial.map(async (r) => {
        let full = ''
        // 每次调用只产出一篇:版本数由"并行调用次数(count)"决定,
        // 强制模型不要在一次回复里自己塞多个【版本N】,这样选1就出1篇。
        const onePerCall =
          trackPrompt + (isOriginal ? ORIGINAL_GUIDE : '') + commentGuide + directiveGuide + lc.guide + ONE_PER_CALL
        try {
          for await (const delta of streamRewrite(
            eff,
            onePerCall,
            userMsg,
            controller.signal
          )) {
            full += delta
            setResults((prev) =>
              prev.map((x) => (x.id === r.id ? { ...x, text: x.text + delta } : x))
            )
          }
          // 硬护栏:改完若超 5 分钟,自动跑一道"精炼压缩"(再不行就再压一次,最多两次)。
          let pass = 0
          while (!controller.signal.aborted && spokenLen(full) > lc.compressLimit && pass < 2) {
            pass++
            setResults((prev) =>
              prev.map((x) => (x.id === r.id ? { ...x, text: '（超篇幅上限,自动精炼中…）' } : x))
            )
            let comp = ''
            for await (const delta of streamChat(
              eff,
              [
                { role: 'system', content: lc.compressSys },
                { role: 'user', content: full },
              ],
              controller.signal
            )) {
              comp += delta
              setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, text: comp } : x)))
            }
            if (comp.trim() && spokenLen(comp) < spokenLen(full)) {
              full = comp.trim()
            } else {
              // 没压短就别越压越乱,回退到上一版
              setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, text: full } : x)))
              break
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg !== 'AbortError' && !controller.signal.aborted) {
            setError(msg === 'NO_CONFIG' ? '请先配置模型 API' : msg)
          }
        } finally {
          // 首版定稿:存进 versions[0],之后每次迭代只往后追加,永不覆盖。
          setResults((prev) =>
            prev.map((x) =>
              x.id === r.id
                ? { ...x, done: true, versions: full.trim() ? [full] : [], cursor: 0, version: 1 }
                : x
            )
          )
          // 自动存历史:标题用风格名+原文开头
          if (full.trim()) {
            addHistory('rewrite', `${trackName} · ${origin.slice(0, 24)}`, full, origin)
          }
        }
      })
    )

    setRunning(false)
    abortRef.current = null
  }

  function handleStop() {
    abortRef.current?.abort()
    setRunning(false)
  }

  // 两版融合:把已生成的多个版本喂给 AI,取各版最好的部分合成一篇,
  // 作为新结果追加到列表末尾(不覆盖原版,方便对比)。
  async function mergeVersions() {
    const done = results.filter((r) => r.done && r.text.trim())
    if (done.length < 2 || merging) return
    if (!configured) {
      setShowApi(true)
      return
    }
    setError('')
    setMerging(true)
    const controller = new AbortController()
    mergeAbortRef.current = controller
    const origin = done[0].origin || ''
    const trackPrompt = done[0].trackPrompt || activeTrack?.prompt || ''
    const id = `merge-${Date.now()}`
    setResults((prev) => [
      ...prev,
      { id, text: '', done: false, origin, trackPrompt, version: 1, versions: [], cursor: 0 },
    ])
    const sys = trackPrompt + lengthCfgFor(genMode).guide + ONE_PER_CALL
    const versionsText = done.map((r, i) => `【版本${i + 1}】\n${r.text}`).join('\n\n')
    const messages: ChatMessage[] = [{ role: 'system', content: sys }]
    if (origin) messages.push({ role: 'user', content: `【原文案】\n${origin}` })
    messages.push({
      role: 'user',
      content:
        `下面是同一篇原文的 ${done.length} 个改写版本。把它们融合成一篇质量更高的:取每一版里最好的部分——更抓人的开头、更精炼有力的案例、更顺的逻辑、更狠的金句,合成一篇完整连贯、能直接念的口播稿。若多版各有自创词,最多只留一个、能不留就不留;整体再口语化、去AI味。直接输出融合后的完整文案,不要任何说明。\n\n` +
        versionsText,
    })
    let full = ''
    try {
      for await (const delta of streamChat(eff, messages, controller.signal)) {
        full += delta
        setResults((prev) => prev.map((x) => (x.id === id ? { ...x, text: full } : x)))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'AbortError' && !controller.signal.aborted) setError(msg)
    } finally {
      setResults((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, done: true, versions: full.trim() ? [full] : [], cursor: 0, version: 1 }
            : x
        )
      )
      setMerging(false)
      mergeAbortRef.current = null
      if (full.trim() && activeTrack) {
        addHistory('rewrite', `${activeTrack.name} · 融合 · ${origin.slice(0, 20)}`, full, origin)
      }
    }
  }

  async function handlePaste() {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        const t = await navigator.clipboard.readText()
        if (t) { setInput(t); return }
      } catch {
        /* fall through */
      }
    }
    // http 局域网访问时 clipboard API 不可用，静默聚焦文本框，用户直接 Cmd+V 即可
    inputAreaRef.current?.focus()
  }

  // 导入 Word(.docx)→ mammoth 抽正文 → 填进原文框(纯前端,买家也能用)。
  async function importDocToInput(file: File | undefined) {
    if (!file) return
    setError('')
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'doc') {
      setError('旧版 .doc 无法解析,请在 Word 里「另存为」.docx 后再导入')
      return
    }
    if (ext !== 'docx') {
      setError('只支持 Word .docx 文件')
      return
    }
    setImportingDoc(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const mammoth = (await import('mammoth')).default // 用到才加载,别拖慢首屏
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      const text = value.trim()
      if (!text) throw new Error('文档为空或无可提取文字')
      setInput((prev) => (prev.trim() ? prev.trim() + '\n\n' + text : text))
    } catch (e) {
      setError('Word 解析失败:' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setImportingDoc(false)
    }
  }


  // 让 AI 看原文和"用户现有的所有风格",建议最该用哪个风格改,并给一句话理由。
  // 只从现有风格里选,不编新分类;输出第一行带风格名,便于一键切换。
  return (
    <div className="min-h-screen">
      <AppHeader
        providerLabel={providerLabel(config)}
        configured={configured}
        onOpenSettings={() => setShowApi(true)}
      />

      {/* 风格栏:只显示当前板块那一批风格(改文板块=改文风格,原创文板块=原创风格) */}
      <div className="mx-auto max-w-7xl px-4 pt-5">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-base font-bold text-primary">
            {genMode === 'original' ? '原创文' : '改文'}
          </h2>
          <span className="text-xs text-muted-foreground">
            {genMode === 'original' ? '给一个主题,按这套风格从零写一篇' : '给一篇文章,按这套风格改写'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visibleTracks.length === 0 && (
            <span className="text-sm text-muted-foreground">
              还没有风格——先去「提炼文案风格」丢范文生成,点「{genMode === 'original' ? '存为风格(原创文用)' : '存为风格(改写用)'}」,或点右边新建。
            </span>
          )}
          {visibleTracks.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={cn(
                'group flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all',
                t.id === activeTrack?.id
                  ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/30'
                  : 'border border-border/60 bg-white/70 text-muted-foreground hover:border-primary/40 hover:bg-white hover:text-primary'
              )}
            >
              {t.name}
              {t.id === activeTrack?.id && (
                <Pencil
                  className="h-3.5 w-3.5 opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(t.id)
                  }}
                />
              )}
            </button>
          ))}
          <button
            onClick={handleAddTrack}
            className="flex items-center gap-1 rounded-full border border-dashed border-border bg-card/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="h-4 w-4" /> 添加风格
          </button>
        </div>
      </div>

      {/* main */}
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-5 lg:grid-cols-2">
        {/* left: input */}
        <div className="glass-card flex flex-col rounded-2xl bg-card/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary">
              {genMode === 'original' ? '主题 / 选题' : '原文（文案）'}
            </h3>
            <div className="flex gap-1">
              {genMode === 'rewrite' && (
                <>
                  <input
                    ref={docFileRef}
                    type="file"
                    accept=".docx,.doc"
                    className="hidden"
                    onChange={(e) => {
                      importDocToInput(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => docFileRef.current?.click()}
                    disabled={importingDoc}
                  >
                    {importingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {importingDoc ? '解析中' : '导入 Word'}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={handlePaste}>
                <ClipboardPaste className="h-4 w-4" /> 粘贴
              </Button>
              {(input || comments || directive || results.length > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={running}
                  onClick={() => {
                    setInput('')
                    setComments('')
                    setDirective('')
                    setResults([])
                  }}
                >
                  <Eraser className="h-4 w-4" /> 清空
                </Button>
              )}
            </div>
          </div>
          <Textarea
            ref={inputAreaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              genMode === 'original'
                ? '输入一个主题/选题方向,例如:35岁裸辞后我才看懂的三件事…'
                : '粘贴文案,或「导入 Word」…'
            }
            className="min-h-[300px] flex-1 resize-none text-sm leading-relaxed"
          />

          {/* 热门评论:可选素材,只在「改文」模式有意义(原创文没有原文/评论可融)。 */}
          {genMode === 'rewrite' && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-bold text-muted-foreground">
                热门评论（可选 · 评论里的观点会被融入改写）
              </h3>
              {comments.trim() && (
                <button
                  onClick={() => setComments('')}
                  className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                >
                  清空评论
                </button>
              )}
            </div>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="把热门评论里有价值的观点贴进来,改写时会自然融入(一行一条或整段都行;留空则只改原文)"
              className="min-h-[84px] resize-none text-sm leading-relaxed"
            />
          </div>
          )}

          {/* 我的要求:本篇专属指令,优先级最高。留空时改写行为不变;改完不满意还能在右侧逐版迭代。 */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-bold text-muted-foreground">
                我的要求（可选 · 这一篇{genMode === 'original' ? '怎么写' : '怎么改'},优先级最高）
              </h3>
              {directive.trim() && (
                <button
                  onClick={() => setDirective('')}
                  className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                >
                  清空要求
                </button>
              )}
            </div>
            <Textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder={
                genMode === 'original'
                  ? '例:开头用一个反常识的观点抓人;中间多举一个具体例子;语气更轻松点;结尾给一句能记住的话(留空则按风格正常写)'
                  : '例:开头钩子换个角度;中间补一个例子;某段再展开透一点;结尾收得更有力(留空则按风格正常改)'
              }
              className="min-h-[72px] resize-none text-sm leading-relaxed"
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">生成版本</span>
            <div className="inline-flex rounded-lg bg-muted p-1">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={cn(
                    'h-7 w-8 rounded-md text-sm font-medium transition-all',
                    count === n ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {spokenLen(input)} 字
              {spokenLen(input) > 0 && ` · ${durationHint(spokenLen(input))}`}
            </span>
          </div>

          {running ? (
            <Button variant="outline" size="lg" className="mt-4 bg-card" onClick={handleStop}>
              <Square className="h-4 w-4" /> 停止
            </Button>
          ) : (
            <Button
              size="lg"
              className="mt-4 bg-gradient-to-r from-accent to-primary shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:brightness-105"
              onClick={handleRewrite}
              disabled={!input.trim()}
            >
              <Sparkles className="h-4 w-4" /> 用「{activeTrack?.name}」{genMode === 'original' ? '原创' : '改写'}
            </Button>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        {/* right: output */}
        <div className="glass-card rounded-2xl bg-card/80 p-5">
          {results.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-muted-foreground">
              <Sparkles className="mb-3 h-10 w-10 opacity-30" />
              <p>{genMode === 'original' ? '原创结果将在这里显示' : '改写结果将在这里显示'}</p>
              <p className="mt-1 text-xs">
                {genMode === 'original' ? '左侧输入主题，选好风格，点击原创' : '左侧贴入原文，选好风格，点击改写'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 两版融合:出了 2 篇及以上、且都生成完,就给一个"融合成一篇"按钮 */}
              {results.filter((r) => r.done && r.text.trim()).length >= 2 && (
                <div className="flex items-center justify-between rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    觉得几版各有亮点?融合取优,合成一篇更高质量的
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-card"
                    onClick={mergeVersions}
                    disabled={merging}
                  >
                    {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {merging ? '融合中…' : '融合成一篇'}
                  </Button>
                </div>
              )}
              {results.map((r, i) => (
                <ResultCard
                  key={r.id}
                  index={i}
                  total={results.length}
                  result={r}
                  eff={eff}
                  mode={genMode}
                  onChange={(patch) =>
                    setResults((prev) =>
                      prev.map((x) => {
                        if (x.id !== r.id) return x
                        const merged = { ...x, ...patch }
                        // 焊死:版本只增不减——任何更新都不许让已有历史版本变少(防迭代/翻页/再改时误删)。
                        // 翻页是等长改、再改/自动改是往后追加,都不受影响;只挡住"异常缩短"这一种情况。
                        if (patch.versions && x.versions && patch.versions.length < x.versions.length) {
                          merged.versions = x.versions
                        }
                        return merged
                      })
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {showApi && (
        <ApiSettingsModal config={config} onSave={setConfig} onClose={() => setShowApi(false)} />
      )}
      {editingTrack && (
        <TrackEditorModal
          track={editingTrack}
          canDelete={tracks.length > 1}
          onSave={(patch) => updateTrack(editingTrack.id, patch)}
          onDelete={() => {
            removeTrack(editingTrack.id)
            setEditingId(null)
            if (activeId === editingTrack.id) setActiveId(tracks[0]?.id ?? '')
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

// 成品质检:对照"像不像目标风格 + 读着自不自然 + 有没有 AI 味"逐条体检,标出没达标的。
function qcSys() {
  return `你是文案质检员。下面给你【这套风格的提示词】和一篇按它生成/改写的【成品文案】。你的核心任务是:**拿成品对照这套风格提示词里写的要求逐条反推**,看它到底做到没做到,再顺带查通用质量问题。直给,别夸、别客套、别复述原文。

【先做:提示词达成度核对(最重要)】
逐条对照【风格提示词】里写明的要求(比如:首句怎么处理、钩子、结构顺序、语气口吻、必做项、禁忌/禁词、篇幅、收尾方式、格式等),这篇成品**每一条做到了没有**?给 ✅/⚠️/❌ + 哪里没做到 + 怎么补。提示词没写的别凭空加要求。

【再查:通用质量,给 ✅ / ⚠️ / ❌ + 一句话】
1. 风格贴合:整体口吻、结构、节奏像不像这套风格?有没有跑偏成另一个味儿?
2. 开头:开头几句抓不抓人?有没有拖沓废话?
3. 去AI味:有没有总结腔(总而言之/综上所述)、公式化开场、冷僻书面词、过多工整排比、机械对仗("X不是Y而是Z")?
4. 口水话:有没有"你说呢""听见没""我跟你说""你想啊"这种没信息量的填充?
5. 自造词/堆砌:有没有为凑数硬造的生僻合成词、强行引用、硬塞的金句?
6. 具体感:有没有真实细节/具体场景/具体数字,还是一直空泛抽象?
7. 连贯:是一篇有衔接的完整文章,还是一段一个互不搭界的流水账?
8. 收尾:结尾落得稳、有回味,还是空喊口号?

【输出】
第一行总评(三选一):✅ 可用 / ⚠️ 能用但有硬伤,要改 / ❌ 没达标,重改
然后**只列 ⚠️ 和 ❌ 的条目**(达标的别啰嗦),每条:第几条 · 问题 · 怎么改
最后一行:最该先改的是哪条。`
}

function ResultCard({
  index,
  total,
  result,
  eff,
  mode,
  onChange,
}: {
  index: number
  total: number
  result: RewriteResult
  eff: { baseURL: string; apiKey: string; model: string }
  mode: 'rewrite' | 'original'
  onChange: (patch: Partial<RewriteResult>) => void
}) {
  // 篇幅护栏 + 质检标准按板块取:原创文走 ~2000 那套,改文走 1500 那套。
  const lc = lengthCfgFor(mode)
  const QC_SYS = qcSys()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const qcKey = `gw_qc_${result.id}`
  const [qc, setQc] = useState(() => localStorage.getItem(qcKey) || '')
  const [qcRunning, setQcRunning] = useState(false)
  // 针对这版再改:用户输入的修改意见 + 流式状态。
  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const reviseAbort = useRef<AbortController | null>(null)
  // 自动改到达标:质检→改→再质检 循环(最多 3 轮)
  const [autoFixing, setAutoFixing] = useState(false)
  const [autoStatus, setAutoStatus] = useState('')
  const autoAbort = useRef<AbortController | null>(null)

  // 一键改到达标:循环【质检 → 按意见改】最多 3 轮,质检判 ✅ 就停;封顶免无限烧额度。
  // 每轮把上一版压进 history(本地维护,避开闭包里 result 不更新的坑),可回退。
  async function autoFixToStandard() {
    if (!eff.baseURL || !eff.apiKey || !result.text || autoFixing || revising || qcRunning) return
    const controller = new AbortController()
    autoAbort.current = controller
    setAutoFixing(true)
    const MAX = 3
    let curText = result.text
    // 版本基线:同步当前(可能手改过的)文本到当前版本,之后每轮把新版往后追加、不覆盖旧版。
    const v0 = verState(result)
    let versions = v0.versions.length ? [...v0.versions] : [curText]
    versions[Math.min(v0.cursor, versions.length - 1)] = curText
    try {
      for (let round = 1; round <= MAX; round++) {
        // 1) 质检当前版本
        setAutoStatus(`第 ${round}/${MAX} 轮 · 质检中…`)
        setQc('')
        let qct = ''
        for await (const d of streamChat(
          eff,
          [
            { role: 'system', content: QC_SYS },
            { role: 'user', content: `【文案】\n${curText}` },
          ],
          controller.signal
        )) {
          qct += d
          setQc(qct)
        }
        const firstLine = qct.split('\n').find((l) => l.trim()) || ''
        const passed = firstLine.includes('✅') || firstLine.includes('可用')
        if (passed) {
          setAutoStatus(`✓ 第 ${round} 轮已达标`)
          break
        }
        if (round === MAX) {
          setAutoStatus(`已改 ${MAX} 轮,仍有上面这些问题——你自己再调一下`)
          break
        }
        // 2) 按这次质检意见改一版(改完追加成新版本,旧版全留着可翻回去)
        setAutoStatus(`第 ${round}/${MAX} 轮 · 按质检意见改写中…`)
        const sys = (result.trackPrompt || '') + lc.guide + ONE_PER_CALL
        const msgs: ChatMessage[] = [{ role: 'system', content: sys }]
        if (result.origin)
          msgs.push({
            role: 'user',
            content: `【最初的原文案 · 仅供背景参考,不要回到它、不要照它重写】\n${result.origin}`,
          })
        msgs.push({ role: 'assistant', content: curText })
        msgs.push({
          role: 'user',
          content:
            '上面这版是当前定稿(可能是我手动逐字改过的),**一切以这版现有文字为准**。请按下面这份"成品质检"意见,只把被点出的 ⚠️/❌ 问题逐条改掉,' +
            '其余已达标的部分**逐字保留、原样照搬**,不要回退到更早的措辞、不要照最初原文重写整篇。直接输出修改后的完整文案、不要任何说明:\n' +
            qct +
            lc.guide,
        })
        let nt = ''
        for await (const d of streamChat(eff, msgs, controller.signal)) {
          nt += d
          onChange({ text: nt })
        }
        // 追加这一轮的新版本,游标指到最新
        versions = [...versions, nt]
        onChange({ versions, cursor: versions.length - 1, version: versions.length })
        curText = nt
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'AbortError' && !controller.signal.aborted) setAutoStatus('自动改写出错:' + msg)
    } finally {
      onChange({ done: true })
      setAutoFixing(false)
      autoAbort.current = null
    }
  }

  function stopAutoFix() {
    autoAbort.current?.abort()
  }

  // 成品质检:把成品按 QC_SYS 标准逐条核,标出哪条没达标。
  async function qualityCheck() {
    if (!eff.baseURL || !eff.apiKey || !result.text || qcRunning) return
    setQcRunning(true)
    setQc('')
    const prompt = result.trackPrompt || ''
    const userMsg = prompt
      ? `【风格提示词(对照它逐条反推)】\n${prompt}\n\n【成品文案】\n${result.text}`
      : `【成品文案】\n${result.text}`
    try {
      for await (const delta of streamChat(eff, [
        { role: 'system', content: QC_SYS },
        { role: 'user', content: userMsg },
      ])) {
        setQc((prev) => prev + delta)
      }
    } catch (e) {
      setQc('质检失败:' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setQcRunning(false)
    }
  }

  // 迭代再改:把【原文 + 上一版 + 我的新意见】喂给模型,在上一版基础上调,而不是从头重写。
  // 旧版本压进 history,可一键回退。风格提示词用这版的快照,保证风格一致。
  async function revise(preset?: string) {
    // 预设指令(点按钮)+ 意见框自由文字,两者都可,拼一起当本次修改意见。
    const note = [preset, feedback.trim()].filter(Boolean).join('\n')
    if (!note || !eff.baseURL || !eff.apiKey || !result.text || revising) return
    const prevText = result.text
    const controller = new AbortController()
    reviseAbort.current = controller
    setRevising(true)
    setQc('') // 一改文本,旧质检就过时了——清掉,别让它改完又弹回来误导
    // 版本基线:把当前(可能手改过的)文本同步进当前版本;迭代结果改完会追加成新版本、永不覆盖旧版。
    // 不清空 text、不动 done——让结果"原地变形",停止按钮和卡片操作区始终可见;新文本流式覆盖旧文本。
    const { versions: baseV, cursor: baseC } = verState(result)
    const synced = baseV.length ? [...baseV] : [prevText]
    synced[Math.min(baseC, synced.length - 1)] = prevText
    onChange({ versions: synced })
    const sys = (result.trackPrompt || '') + lc.guide + ONE_PER_CALL
    const messages: ChatMessage[] = [{ role: 'system', content: sys }]
    // 原文只当"背景素材"给,并明确它不是要回退的目标——否则模型容易拿原文重写,把用户手改冲掉。
    if (result.origin) {
      messages.push({
        role: 'user',
        content:
          `【最初的原文案 · 仅供背景参考,不要回到它、不要照它重写】\n${result.origin}`,
      })
    }
    messages.push({ role: 'assistant', content: prevText })
    messages.push({
      role: 'user',
      content:
        '上面这版是当前定稿,可能是我手动逐字改过的——**一切以这版的现有文字为准**。请只按我下面的意见动我点名的地方,' +
        '其余部分**逐字保留、原样照搬**:不要润色、不要换近义词、不要调整语序、不要回退到更早的措辞,更不要参照最初原文重新改写整篇。' +
        '直接输出修改后的完整文案,不要任何说明或前言。' +
        `\n\n【我的意见】\n${note}` +
        LENGTH_GUIDE,
    })
    let full = ''
    try {
      for await (const delta of streamChat(eff, messages, controller.signal)) {
        full += delta
        onChange({ text: full })
      }
      // 改完:把新版本追加到末尾,游标指到最新(旧版全留着,可前后翻)
      onChange({ versions: [...synced, full], cursor: synced.length, version: synced.length + 1 })
      setFeedback('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'AbortError' && !controller.signal.aborted) {
        // 失败就把显示退回改之前那版,别让用户丢稿(versions 没追加新版,不受影响)
        onChange({ text: prevText, cursor: Math.min(baseC, synced.length - 1) })
      }
    } finally {
      onChange({ done: true })
      setRevising(false)
      reviseAbort.current = null
    }
  }

  function stopRevise() {
    reviseAbort.current?.abort()
  }

  // 版本前后翻页:只移动游标、永不删版本;离开当前版前把手改同步进去,不丢编辑。
  function goVer(delta: number) {
    if (revising || autoFixing) return
    const { versions, cursor } = verState(result)
    const next = cursor + delta
    if (next < 0 || next >= versions.length) return
    const synced = [...versions]
    synced[Math.min(cursor, synced.length - 1)] = result.text // 先提交当前版的手改
    onChange({ versions: synced, cursor: next, text: synced[next], version: next + 1 })
  }
  useEffect(() => {
    if (qc) localStorage.setItem(qcKey, qc)
    else localStorage.removeItem(qcKey)
  }, [qc, qcKey])

  function copyText(text: string, onSuccess: () => void) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess))
    } else {
      fallbackCopy(text, onSuccess)
    }
  }

  function fallbackCopy(text: string, onSuccess: () => void) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand('copy')
      onSuccess()
    } finally {
      document.body.removeChild(ta)
    }
  }

  function copy() {
    copyText(result.text, () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  async function saveToGbrain() {
    if (!result.text || saved) return
    const slug = `图文工坊-${mode === 'rewrite' ? '改文' : '原创文'}-${Date.now()}`
    const content = `# ${slug}\n\n${result.text}`
    try {
      const resp = await fetch('/gbrain-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, content }),
      })
      if (resp.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch { /* 静默失败,不影响正常使用 */ }
  }

  const { versions: verList, cursor: verCursor } = verState(result)
  const totalVers = verList.length
  const navBusy = revising || autoFixing

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {total > 1 ? `版本 ${index + 1}` : '改写结果'}
          {spokenLen(result.text) > 0 && ` · ${spokenLen(result.text)} 字`}
          {result.done && !revising && spokenLen(result.text) > 0 && ` · ${durationHint(spokenLen(result.text))}`}
          {revising && (
            <span className="ml-2 inline-flex items-center gap-1 font-bold text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> 改写中…
            </span>
          )}
          {!result.done && !revising && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
        </span>
        <div className="flex items-center gap-1">
          {totalVers >= 1 && !navBusy && (
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/40 px-1" title="前后翻看历次版本(只增不删,永不丢)">
              <button
                onClick={() => goVer(-1)}
                disabled={verCursor <= 0}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary disabled:opacity-30"
                title="上一版"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[52px] text-center text-xs tabular-nums text-foreground">
                第 {verCursor + 1}/{totalVers} 版
              </span>
              <button
                onClick={() => goVer(1)}
                disabled={verCursor >= totalVers - 1}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary disabled:opacity-30"
                title="下一版"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={copy} disabled={!result.text}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? '已复制' : '复制'}
          </Button>
          {result.done && result.text && (
            <Button variant="ghost" size="sm" onClick={saveToGbrain} disabled={saved} title="存入本地 gbrain 知识库">
              {saved ? <Check className="h-4 w-4 text-emerald-600" /> : <span className="h-4 w-4 text-xs">🧠</span>}
              {saved ? '已存入' : '存知识库'}
            </Button>
          )}
        </div>
      </div>
      {result.done ? (
        <textarea
          value={result.text}
          onChange={(e) => {
            onChange({ text: e.target.value })
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          ref={(el) => {
            if (el) {
              el.style.height = 'auto'
              el.style.height = el.scrollHeight + 'px'
            }
          }}
          className="w-full resize-none rounded-lg border border-border bg-secondary/30 p-2.5 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {result.text || <span className="text-muted-foreground">生成中…</span>}
        </p>
      )}

      {result.done && result.text && (
        <div className="mt-3 border-t border-border/60 pt-3">
          {/* 针对这版再改:看了结果觉得差点意思,提意见让 AI 在这版基础上迭代。 */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1 text-xs font-bold text-primary">
              <Wand2 className="h-3.5 w-3.5" /> 针对这版再改
              <span className="ml-1 font-normal text-[11px] text-muted-foreground">
                点一下直接改,不用打字
              </span>
            </div>
            {/* 快捷指令:点一下 = 拿这条预设指令在这版基础上迭代(意见框里有字会一起带上) */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_FIXES.map((f) => (
                <button
                  key={f.label}
                  onClick={() => revise(f.instruction)}
                  disabled={revising}
                  title={f.instruction}
                  className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter 快捷提交
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void revise()
                }
              }}
              placeholder="也可以自己写意见(会和上面按钮叠加):说哪里要调,AI 在这版基础上改。Cmd/Ctrl+Enter 提交"
              className="min-h-[60px] resize-none text-sm leading-relaxed"
              disabled={revising}
            />
            <div className="mt-1.5">
              {revising ? (
                <Button variant="outline" size="sm" className="bg-card" onClick={stopRevise}>
                  <Square className="h-4 w-4" /> 停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-accent to-primary text-primary-foreground"
                  onClick={() => revise()}
                  disabled={!feedback.trim()}
                >
                  <Wand2 className="h-4 w-4" /> 按我的意见再改一版
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="bg-card" onClick={qualityCheck} disabled={qcRunning || autoFixing}>
              {qcRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
              {qcRunning ? '质检中…' : '成品质检'}
            </Button>
            {result.done && result.text && (
              <Button
                variant="outline"
                size="sm"
                className="bg-card"
                title="把这篇文案带到「配图」页,不用复制粘贴"
                onClick={() => {
                  localStorage.setItem('gw_img_input', result.text)
                  navigate('/image')
                }}
              >
                <ImagePlus className="h-4 w-4" /> 去配图
              </Button>
            )}
            {autoFixing ? (
              <Button variant="outline" size="sm" className="bg-card" onClick={stopAutoFix}>
                <Square className="h-4 w-4" /> 停止
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-gradient-to-r from-accent to-primary text-primary-foreground"
                onClick={autoFixToStandard}
                disabled={qcRunning || revising}
                title="自动循环【质检→按意见改】最多3轮,直到达标"
              >
                <Wand2 className="h-4 w-4" /> 自动改到达标
              </Button>
            )}
          </div>

          {autoStatus && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary">
              {autoFixing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              自动改到达标:{autoStatus}
            </div>
          )}

          {(qcRunning || qc) && (
            <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs leading-relaxed">
              <div className="mb-1 inline-flex items-center gap-1 font-bold text-primary">
                <Stethoscope className="h-3.5 w-3.5" /> 成品质检
              </div>
              {qcRunning && !qc ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在按标准逐条核…
                </p>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-foreground">{qc}</p>
                  {/* 一键按质检意见改:把质检结果当修改意见,走"针对这版再改"的迭代,在这版基础上逐条改掉 */}
                  {!qcRunning && !revising && (
                    <Button
                      size="sm"
                      className="mt-2 bg-gradient-to-r from-accent to-primary text-primary-foreground"
                      onClick={() =>
                        revise(
                          `请按下面这份"成品质检"的意见,把这版里被点出的问题逐条改掉(只改它指出的 ⚠️/❌ 问题,已达标的部分保留不动):\n${qc}`
                        )
                      }
                    >
                      <Wand2 className="h-4 w-4" /> 按质检意见改一版
                    </Button>
                  )}
                </>
              )}
            </div>
          )}


        </div>
      )}
    </div>
  )
}
