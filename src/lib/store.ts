import { useCallback, useEffect, useState } from 'react'
import type { ApiConfig, ProviderConfig, SubProvider, Track } from './types'

const TRACKS_KEY = 'gw_tracks'
// v3:bump 一次让开发机重新读到下面的"自用预填"(见 SELF_PREFILL)。
// ⚠️ 卖给买家前,这个版本号无所谓,关键是 SELF_PREFILL 必须清空(别把作者 key 打进买家包)。
const API_KEY = 'gw_api_config_v4'

// 配图中转站的默认预填。本包不预置任何 key/地址——买家自己在「设置」里填。
const SELF_PREFILL = {
  baseURL: '',
  apiKey: '',
}

// 本地订阅代理(server/claude-proxy.mjs)的地址 = 当前页面所在的源 + /v1。
// 这样从别的电脑用「这台 Mac 的局域网 IP:8788」打开时,API 也自动指向这台 Mac,
// 而不是写死 localhost(localhost 在每台电脑都指它自己,跨设备必然连不上)。
const LOCAL_PROXY =
  (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:8788') +
  '/v1'
function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// 通用版不内置任何"风格"——风格由买家自己从范文里提取(「提炼风格」页),
// 提取后会存进这个列表,在「原创文/改写」里选用。绝不预置作者私房风格。
const SEED_TRACKS: { name: string; prompt: string; version: number }[] = []
// 预留:需要强制下线某些旧风格名时填在这里(默认空,打开就是空白、自己建风格)。
const REMOVED_TRACK_NAMES = new Set<string>([])
const TRACK_RENAMES: Record<string, string> = {}

const DEFAULT_TRACKS: Track[] = []

// 通用版默认走中转站、且地址/key 留空——买家自己在「设置」里二选一:
//  ① 中转站:填自己的 OpenAI 兼容地址 + key(出文+出图都自动);
//  ② 订阅:走本机代理调自己的 Claude/ChatGPT(出文自动、出图给提示词手动)。
// 绝不预置任何地址/key,绝不指向作者本机代理。
const DEFAULT_API: ApiConfig = {
  // 文字默认订阅(买家自己的 Claude/GPT/Gemini,免费);配图默认中转站(自动出图)。两者都能切。
  textMode: 'sub',
  imageMode: 'relay',
  relay: { baseURL: SELF_PREFILL.baseURL, apiKey: SELF_PREFILL.apiKey, textModel: 'gpt-5.5', imageModel: 'gpt-image-2' },
  subProvider: 'claude',
}

// 订阅模式各家走本机代理时的默认模型名(proxy 按模型名分流到对应 CLI)。
const SUB_TEXT_MODEL: Record<SubProvider, string> = {
  claude: 'claude-sonnet-4-6',
  chatgpt: 'gpt-5.5',
  gemini: 'gemini-3.1-pro',
}

// 旧默认的模型名 → 自动升级到当前默认(让老 localStorage 也能拿到新默认,不动用户填的 key/地址)。
const STALE_TEXT_MODELS = new Set(['gpt-4o', 'gpt-5', 'gpt-4', 'gpt-4-turbo'])
const STALE_IMAGE_MODELS = new Set(['gpt-image-1', 'dall-e-3', 'nano-banana', 'gemini-2.5-flash-image'])

/** 「出文」线路(按文字开关) = streamChat 要的 {baseURL, apiKey, model}。 */
export function effectiveConfig(config: ApiConfig): ProviderConfig {
  if (config.textMode === 'sub') {
    return { baseURL: LOCAL_PROXY, apiKey: 'local', model: SUB_TEXT_MODEL[config.subProvider] }
  }
  return { baseURL: config.relay.baseURL, apiKey: config.relay.apiKey, model: config.relay.textModel }
}

/** 「出图」线路:配图开关选订阅=手动(返回 null);选中转站且填了 key+出图模型才自动出图。 */
export function imageConfig(config: ApiConfig): ProviderConfig | null {
  if (config.imageMode === 'sub') return null
  const { baseURL, apiKey, imageModel } = config.relay
  if (!baseURL || !apiKey || !imageModel) return null
  return { baseURL, apiKey, model: imageModel }
}

/** 某条线路是否配置好可用。context='text' 看文字线路、'image' 看配图线路。
 *  订阅/手动假定可用(本机代理已起);中转站要填了地址+key。 */
export function isConfigured(config: ApiConfig, context: 'text' | 'image' = 'text'): boolean {
  const mode = context === 'image' ? config.imageMode : config.textMode
  if (mode === 'sub') return true
  return !!config.relay.baseURL && !!config.relay.apiKey
}

/** 顶部徽标文字。context='text' 显示文字线路、'image' 显示配图线路——徽标跟着当前页走。 */
const SUB_LABEL: Record<SubProvider, string> = {
  claude: 'Claude 订阅',
  chatgpt: 'ChatGPT 订阅',
  gemini: 'Gemini 订阅',
}
export function providerLabel(config: ApiConfig, context: 'text' | 'image' = 'text'): string {
  if (context === 'image') return config.imageMode === 'relay' ? '中转站·出图' : '订阅·手动出图'
  return config.textMode === 'relay' ? '中转站' : SUB_LABEL[config.subProvider]
}

// 迁移:把老数据(单 mode 结构 / 更早的 byProvider 结构 / 脏数据)安全收敛到新形状
// {textMode, imageMode, relay, subProvider}。买家全新浏览器没有旧数据,只影响开发机自己。
function migrateApi(raw: unknown): ApiConfig {
  const c = raw as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return DEFAULT_API
  const r = (c.relay as Partial<ApiConfig['relay']>) || {}
  const sp = c.subProvider
  const subProvider: SubProvider = sp === 'chatgpt' || sp === 'gemini' ? sp : 'claude'

  // 已是 textMode/imageMode 新结构,或上一版单 mode 结构
  if (c.textMode || c.imageMode || c.mode === 'relay' || c.mode === 'sub') {
    const tm = r.textModel && !STALE_TEXT_MODELS.has(r.textModel) ? r.textModel : 'gpt-5.5'
    const im = r.imageModel && !STALE_IMAGE_MODELS.has(r.imageModel) ? r.imageModel : 'gpt-image-2'
    return {
      // 上一版只有一个 mode:文字沿用它,配图给默认中转站
      textMode: c.textMode === 'relay' || c.textMode === 'sub' ? c.textMode : c.mode === 'relay' ? 'relay' : 'sub',
      imageMode: c.imageMode === 'relay' || c.imageMode === 'sub' ? c.imageMode : 'relay',
      relay: { baseURL: r.baseURL || '', apiKey: r.apiKey || '', textModel: tm, imageModel: im },
      subProvider,
    }
  }
  // 更早的 byProvider 结构 → 取 openai 那套当中转站凭证
  const bp = (c.byProvider as Record<string, ProviderConfig>) || {}
  const op = bp.openai || ({} as ProviderConfig)
  return {
    textMode: c.provider === 'openai' ? 'relay' : 'sub',
    imageMode: 'relay',
    relay: {
      baseURL: op.baseURL && !/localhost|127\.0\.0\.1/.test(op.baseURL) ? op.baseURL : '',
      apiKey: op.apiKey && op.apiKey !== 'local' ? op.apiKey : '',
      textModel: op.model && !STALE_TEXT_MODELS.has(op.model) ? op.model : 'gpt-5.5',
      imageModel: 'gpt-image-2',
    },
    subProvider,
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Tracks (风格) persisted to localStorage. */
export function useTracks() {
  const [tracks, setTracks] = useState<Track[]>(() => {
    const t = load<Track[]>(TRACKS_KEY, DEFAULT_TRACKS)
    let list = t.length ? t : DEFAULT_TRACKS
    // 1) 强制下线 REMOVED_TRACK_NAMES 里的旧风格名(默认空,无副作用)。
    list = list.filter((x) => !REMOVED_TRACK_NAMES.has(x.name))
    // 2) 老风格名平滑改名(目前无需要,留接口给未来用)。
    list = list.map((x) => (TRACK_RENAMES[x.name] ? { ...x, name: TRACK_RENAMES[x.name] } : x))
    // 3) 内置风格自动升级:按 name 匹配种子,版本落后且用户没在界面改过(seedVersion!==-1)就同步最新出厂提示词。
    list = list.map((x) => {
      const seed = SEED_TRACKS.find((s) => s.name === x.name)
      return seed && x.seedVersion !== -1 && x.seedVersion !== seed.version
        ? { ...x, prompt: seed.prompt, seedVersion: seed.version }
        : x
    })
    // 4) 把老用户 localStorage 里还没有的新内置风格补进来(将来加新子风格时自动同步给老用户)。
    for (const seed of SEED_TRACKS) {
      if (!list.some((x) => x.name === seed.name)) {
        list = [...list, { id: uid(), name: seed.name, prompt: seed.prompt, seedVersion: seed.version, kind: 'rewrite' }]
      }
    }
    // 5) 老数据没有 kind 字段的,一律当改文型(原创型是新加的概念,老风格都是改文)。
    list = list.map((x) => (x.kind ? x : { ...x, kind: 'rewrite' as const }))
    // 6) 一次性:把用户那条「人生副本职业」风格挪到原创(它本质是给主题原创,之前误归改文)。
    //    用 flag 保证只跑一次,之后用户在风格编辑器里改类型不会被这条覆盖回去。
    const MOVE_FLAG = 'gw_moved_rsfb_to_original'
    if (!localStorage.getItem(MOVE_FLAG)) {
      let moved = false
      list = list.map((x) => {
        if ((x.kind ?? 'rewrite') === 'rewrite' && x.name.includes('人生副本')) {
          moved = true
          return { ...x, kind: 'original' as const }
        }
        return x
      })
      if (moved) localStorage.setItem(MOVE_FLAG, '1')
    }
    return list
  })

  useEffect(() => {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(tracks))
  }, [tracks])

  const addTrack = useCallback((name: string, kind: Track['kind'] = 'rewrite') => {
    const track: Track = { id: uid(), name: name.trim() || '新风格', prompt: '', kind }
    setTracks((prev) => [...prev, track])
    return track.id
  }, [])

  const updateTrack = useCallback((id: string, patch: Partial<Track>) => {
    // 用户在界面改了提示词 → 标记"已接管"(seedVersion=-1),以后不再自动升级覆盖他的改动。
    setTracks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, ...patch, ...(patch.prompt !== undefined ? { seedVersion: -1 } : {}) }
          : t
      )
    )
  }, [])

  const removeTrack = useCallback((id: string) => {
    setTracks((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev))
  }, [])

  return { tracks, addTrack, updateTrack, removeTrack }
}

/** API config persisted to localStorage. */
export function useApiConfig() {
  const [config, setConfig] = useState<ApiConfig>(() => {
    const raw = load<unknown>(API_KEY, null)
    return migrateApi(raw)
  })

  useEffect(() => {
    localStorage.setItem(API_KEY, JSON.stringify(config))
  }, [config])

  return { config, setConfig }
}
