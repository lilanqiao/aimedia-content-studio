import type { ProviderConfig } from './types'

/** A chat message; content is plain text or an array of multimodal parts. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

/**
 * 流式剥离推理模型(gpt-5 等)吐出的 <think>…</think> / <thinking>…</thinking>。
 * 标签可能跨多个分片到达,所以保留状态并在边界处回退可能的半个标签。
 */
function makeThinkStripper() {
  const OPEN = ['<think>', '<thinking>']
  const CLOSE = ['</think>', '</thinking>']
  let buf = ''
  let inThink = false

  // buf 末尾有多少字符是某个标签的前缀(需要暂存等后续分片)
  function partialSuffix(s: string, tags: string[]) {
    let max = 0
    for (const tag of tags) {
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
        if (s.slice(-k) === tag.slice(0, k)) {
          max = Math.max(max, k)
          break
        }
      }
    }
    return max
  }
  function earliest(s: string, tags: string[]) {
    let idx = -1
    let len = 0
    for (const tag of tags) {
      const i = s.indexOf(tag)
      if (i !== -1 && (idx === -1 || i < idx)) {
        idx = i
        len = tag.length
      }
    }
    return { idx, len }
  }
  function process(flush: boolean) {
    let out = ''
    for (;;) {
      if (!inThink) {
        const { idx, len } = earliest(buf, OPEN)
        if (idx === -1) {
          const hold = flush ? 0 : partialSuffix(buf, OPEN)
          out += buf.slice(0, buf.length - hold)
          buf = buf.slice(buf.length - hold)
          break
        }
        out += buf.slice(0, idx)
        buf = buf.slice(idx + len)
        inThink = true
      } else {
        const { idx, len } = earliest(buf, CLOSE)
        if (idx === -1) {
          buf = flush ? '' : buf.slice(buf.length - partialSuffix(buf, CLOSE))
          break
        }
        buf = buf.slice(idx + len)
        inThink = false
      }
    }
    return out
  }
  return {
    push: (chunk: string) => {
      buf += chunk
      return process(false)
    },
    flush: () => process(true),
  }
}

/**
 * Streaming chat completion against an OpenAI-compatible endpoint.
 * Most Chinese relays (中转站) expose Gemini / GPT / Claude through this same
 * `/chat/completions` shape, so one client covers all three providers.
 * Multimodal parts (images, and video where the relay supports it) are passed
 * through as `image_url` data-URL parts.
 */
export async function* streamChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!config.baseURL || !config.apiKey) {
    throw new Error('NO_CONFIG')
  }

  const base = config.baseURL.replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0.9,
      messages,
    }),
    signal,
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const strip = makeThinkStripper()

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') {
        const tail = strip.flush()
        if (tail) yield tail
        return
      }
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          const emit = strip.push(delta as string)
          if (emit) yield emit
        }
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
  const tail = strip.flush()
  if (tail) yield tail
}

/**
 * 出图:走 OpenAI 兼容的 `/images/generations`(中转站普遍支持 gpt-image / dall-e / nano-banana)。
 * 返回一张图的 data-URL(b64)或直链 URL。失败抛错带后端原文,方便排查。
 */
export async function generateImage(
  config: ProviderConfig,
  prompt: string,
  signal?: AbortSignal,
  size = '1024x1024'
): Promise<string> {
  if (!config.baseURL || !config.apiKey) throw new Error('NO_CONFIG')
  const base = config.baseURL.replace(/\/+$/, '')
  const url = base.endsWith('/images/generations') ? base : `${base}/images/generations`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, prompt, n: 1, size }),
    signal,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`出图接口 ${res.status}: ${detail.slice(0, 300)}`)
  }
  const json = await res.json().catch(() => null)
  const item = json?.data?.[0]
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item?.url) return item.url as string
  throw new Error('出图接口没返回图片(检查出图模型名是否被你的中转站支持)')
}

/** 改文:系统提示词 + 一段原文。 */
export function streamRewrite(
  config: ProviderConfig,
  systemPrompt: string,
  userText: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  return streamChat(
    config,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    signal
  )
}
