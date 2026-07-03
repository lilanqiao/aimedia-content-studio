import { useCallback, useEffect, useState } from 'react'

export type HistoryKind = 'rewrite' | 'prompt'

export interface HistoryItem {
  id: string
  kind: HistoryKind
  title: string // 一行摘要(风格名/类型/原文开头)
  content: string // 完整内容(改文=成品)
  origin?: string // 改文记录的完整原文(用于原文↔成品配对)
  ts: number // 时间戳
}

const KEY = 'gw_history'
const MAX = 200

const KIND_LABEL: Record<HistoryKind, string> = {
  rewrite: '文案',
  prompt: '提示词',
}
export function kindLabel(k: HistoryKind) {
  return KIND_LABEL[k]
}

function load(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch {
    return []
  }
}

// 模块级订阅,让多个页面共享同一份历史并实时同步
let cache: HistoryItem[] = load()
const listeners = new Set<(items: HistoryItem[]) => void>()
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* 容量满则忽略 */
  }
  listeners.forEach((fn) => fn(cache))
}

/** 任意位置都能调:存一条历史(自动去掉空内容、截断超长标题、滚动淘汰)。
 *  origin 选填:改文时传完整原文,用于原文↔成品配对。 */
export function addHistory(kind: HistoryKind, title: string, content: string, origin?: string) {
  if (!content || !content.trim()) return
  const item: HistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title: (title || '').trim().slice(0, 60) || kindLabel(kind),
    content,
    ...(origin && origin.trim() ? { origin: origin.trim() } : {}),
    ts: Date.now(),
  }
  cache = [item, ...cache].slice(0, MAX)
  persist()
}

export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>(cache)
  useEffect(() => {
    const fn = (next: HistoryItem[]) => setItems(next)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  const remove = useCallback((id: string) => {
    cache = cache.filter((x) => x.id !== id)
    persist()
  }, [])
  const clear = useCallback(() => {
    cache = []
    persist()
  }, [])

  return { items, remove, clear }
}
