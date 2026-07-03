export interface Track {
  id: string
  name: string
  /** 这个风格专属的 AI 提示词框架 */
  prompt: string
  /** 内置风格的出厂提示词版本;-1 表示用户已在界面改过、不再自动升级。自建风格无此字段。 */
  seedVersion?: number
  /**
   * 风格类型:改文(给原文→改写) / 原创(给主题→从零原创) / 画面(画面风格,给配图用)。
   * 几种提示词写法完全不同,分批管理,不混在一起。缺省=改文(兼容老数据)。
   */
  kind?: 'rewrite' | 'original' | 'visual'
}

/** 单条线路配置(地址 + key + 模型),streamChat 直接吃这个。 */
export interface ProviderConfig {
  baseURL: string
  apiKey: string
  model: string
}

/** 中转站线路:一套地址/key + 文字模型 + 出图模型。 */
export interface RelayConfig {
  baseURL: string
  apiKey: string
  /** 出文用的模型名,如 gpt-4o / claude-sonnet-4-6 / deepseek-chat。 */
  textModel: string
  /** 出图用的模型名,如 gpt-image-2 / nano-banana(留空=不出图)。 */
  imageModel: string
}

/** 买家走自己订阅时,选用哪一家(本机要装对应 CLI 并登录)。 */
export type SubProvider = 'claude' | 'chatgpt' | 'gemini'

/**
 * 文字线路和配图线路各有自己的开关、各有自己的默认,都能切:
 *  - textMode  文字(提炼风格/改写/原创文):'sub' 订阅(默认,走本机 CLI 免费) / 'relay' 中转站。
 *  - imageMode 配图出图:'relay' 中转站(默认,自动出图) / 'sub' 订阅(订阅出不了图→给提示词手动出)。
 *  relay 凭证(中转站地址/key/模型)两边共用一套;subProvider 是文字订阅选哪家。
 */
export interface ApiConfig {
  textMode: 'relay' | 'sub'
  imageMode: 'relay' | 'sub'
  relay: RelayConfig
  subProvider: SubProvider
}

export interface RewriteResult {
  id: string
  text: string
  done: boolean
  /** 这一版改写时的原文快照——迭代再改时给模型当上下文,即使之后换了原文也不受影响。 */
  origin?: string
  /** 这一版用的风格提示词快照,同理保证迭代稳定。 */
  trackPrompt?: string
  /** 历次旧版本正文(旧字段,保留供迁移到 versions)。 */
  history?: string[]
  /** 当前是第几版(1=首改,2+=迭代过)。 */
  version?: number
  /** 全量版本快照(只增不删,按时间先后,versions[0]=首改)。配 cursor 做前后翻页,永不丢版本。 */
  versions?: string[]
  /** 当前正在看 versions 里的第几版(下标,0=第一版)。 */
  cursor?: number
}
