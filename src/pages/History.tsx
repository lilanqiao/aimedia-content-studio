import { useState } from 'react'
import { Copy, Check, Trash2, Search, Clock } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { ApiSettingsModal } from '@/components/ApiSettingsModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { useApiConfig, providerLabel, isConfigured } from '@/lib/store'
import { useHistory, kindLabel, type HistoryItem, type HistoryKind } from '@/lib/history'
import { cn } from '@/lib/utils'

type Filter = 'all' | HistoryKind

function timeAgo(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 把某天 0 点的时间戳作为分组键
function dayKey(ts: number) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
function dayLabel(key: number) {
  const today = dayKey(Date.now())
  const oneDay = 86400000
  if (key === today) return '今天'
  if (key === today - oneDay) return '昨天'
  const d = new Date(key)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
// 列表(已按时间倒序)→ 按天分组,保持倒序
function groupByDay<T extends { ts: number }>(list: T[]) {
  const groups: { key: number; label: string; items: T[] }[] = []
  for (const it of list) {
    const k = dayKey(it.ts)
    let g = groups.find((x) => x.key === k)
    if (!g) {
      g = { key: k, label: dayLabel(k), items: [] }
      groups.push(g)
    }
    g.items.push(it)
  }
  return groups
}

export default function History() {
  const { config, setConfig } = useApiConfig()
  const { items, remove, clear } = useHistory()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [showApi, setShowApi] = useState(false)

  const list = items.filter(
    (it) =>
      (filter === 'all' || it.kind === filter) &&
      (!q.trim() || it.title.includes(q) || it.content.includes(q))
  )

  return (
    <div className="min-h-screen">
      <AppHeader
        providerLabel={providerLabel(config)}
        configured={isConfigured(config)}
        onOpenSettings={() => setShowApi(true)}
      />

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'rewrite', label: '文案' },
              { value: 'prompt', label: '提示词' },
            ]}
          />
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索内容…" className="pl-9" />
          </div>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => window.confirm('确认清空所有历史记录?不可恢复。') && clear()}
            >
              <Trash2 className="h-4 w-4" /> 清空
            </Button>
          )}
        </div>

        {list.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center text-center text-muted-foreground">
            <Clock className="mb-3 h-10 w-10 opacity-30" />
            <p>{items.length === 0 ? '还没有历史记录' : '没有匹配的记录'}</p>
            <p className="mt-1 text-xs">原创文、改文、提炼文案/画面风格、配图的提示词都会自动存到这里</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupByDay(list).map((g) => (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-foreground/70">{g.label}</h3>
                  <span className="text-xs text-muted-foreground">{g.items.length} 条</span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
                <div className="space-y-3">
                  {g.items.map((it) => (
                    <HistoryCard key={it.id} item={it} onRemove={() => remove(it.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showApi && (
        <ApiSettingsModal config={config} onSave={setConfig} onClose={() => setShowApi(false)} />
      )}
    </div>
  )
}

function HistoryCard({
  item,
  onRemove,
}: {
  item: HistoryItem
  onRemove: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const badge =
    item.kind === 'rewrite'
      ? 'bg-primary/10 text-primary'
      : item.kind === 'prompt'
        ? 'bg-accent/15 text-accent'
        : 'bg-emerald-100 text-emerald-700'

  return (
    <div className="glass-card rounded-2xl bg-card/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', badge)}>{kindLabel(item.kind)}</span>
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{timeAgo(item.ts)}</span>
      </div>
      {open && item.origin ? (
        <div className="space-y-2 text-sm leading-relaxed">
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground">原文</span>
            <p className="mt-1 select-text whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 text-foreground/75">
              {item.origin}
            </p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-primary">改写成品</span>
            <p className="mt-1 select-text whitespace-pre-wrap text-foreground/90">{item.content}</p>
          </div>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            收起 ↑
          </button>
        </div>
      ) : (
        <p
          className={cn(
            'cursor-pointer whitespace-pre-wrap text-sm leading-relaxed text-foreground/90',
            !open && 'line-clamp-3'
          )}
          onClick={() => {
            if (window.getSelection()?.toString()) return
            setOpen((v) => !v)
          }}
        >
          {item.content}
        </p>
      )}
      <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
        <Button
          variant="outline"
          size="sm"
          className="bg-card"
          onClick={() => {
            const text = item.content
            if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(text)
            } else {
              const el = document.createElement('textarea')
              el.value = text
              el.style.cssText = 'position:fixed;top:-9999px;left:-9999px'
              document.body.appendChild(el)
              el.select()
              document.execCommand('copy')
              document.body.removeChild(el)
            }
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? '已复制' : '复制'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开全文'}
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" /> 删除
        </Button>
      </div>
    </div>
  )
}
