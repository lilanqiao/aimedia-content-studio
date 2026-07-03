import { useState } from 'react'
import { X, Cpu, BadgeCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import type { ApiConfig, SubProvider } from '@/lib/types'
import { cn } from '@/lib/utils'

// 订阅各家固定用的模型名(只展示给买家看,版本是定死的)
const SUB_MODEL_NAME: Record<SubProvider, string> = {
  claude: 'claude-sonnet-4-6',
  chatgpt: 'gpt-5.5',
  gemini: 'gemini-3.1-pro',
}

// 一排可点选的模型预设(点一下就选中,不用打字)
function PresetRow({
  value,
  options,
  onPick,
}: {
  value: string
  options: string[]
  onPick: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onPick(o)}
          className={cn(
            'rounded-lg px-3 py-1.5 font-mono text-xs transition-all',
            value === o
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function ApiSettingsModal({
  config,
  onSave,
  onClose,
  context = 'text',
}: {
  config: ApiConfig
  onSave: (c: ApiConfig) => void
  onClose: () => void
  /** 当前页:'text'=文章板块文字线路;'image'=配图出图线路 */
  context?: 'text' | 'image'
}) {
  const [draft, setDraft] = useState<ApiConfig>(config)
  const setRelay = (patch: Partial<ApiConfig['relay']>) =>
    setDraft((d) => ({ ...d, relay: { ...d.relay, ...patch } }))
  const needRelay =
    context === 'text' ? draft.textMode === 'relay' : draft.imageMode === 'relay'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">线路设置</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5">
          {/* 文字线路 —— 只在文章板块显示 */}
          {context === 'text' && (
          <div className="space-y-2">
            <Label>文字(提炼文案风格 / 改写 / 原创文)</Label>
            <Segmented
              className="w-full"
              value={draft.textMode}
              onChange={(m: ApiConfig['textMode']) => setDraft((d) => ({ ...d, textMode: m }))}
              options={[
                { value: 'sub', label: '订阅(默认)' },
                { value: 'relay', label: '中转站' },
              ]}
            />
            {draft.textMode === 'sub' ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['claude', 'chatgpt', 'gemini'] as SubProvider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setDraft((d) => ({ ...d, subProvider: p }))}
                      className={cn(
                        'flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition-all',
                        draft.subProvider === p
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-secondary/40 hover:bg-secondary'
                      )}
                    >
                      <span className={cn('text-sm font-semibold', draft.subProvider === p ? 'text-primary' : 'text-foreground')}>
                        {p === 'claude' ? 'Claude' : p === 'chatgpt' ? 'ChatGPT' : 'Gemini'}
                      </span>
                      <span className="font-mono text-[10px] leading-tight text-muted-foreground">{SUB_MODEL_NAME[p]}</span>
                    </button>
                  ))}
                </div>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <BadgeCheck className="h-3 w-3 shrink-0 text-primary" />
                  免费,需本机装好并登录(见安装说明)
                </p>
              </>
            ) : (
              <PresetRow
                value={draft.relay.textModel}
                options={['gpt-5.5', 'claude-sonnet-4-6', 'gemini-3.1-pro']}
                onPick={(v) => setRelay({ textModel: v })}
              />
            )}
          </div>
          )}

          {/* 配图线路 —— 只在配图板块显示 */}
          {context === 'image' && (
          <div className="space-y-2">
            <Label>配图(出图)</Label>
            <Segmented
              className="w-full"
              value={draft.imageMode}
              onChange={(m: ApiConfig['imageMode']) => setDraft((d) => ({ ...d, imageMode: m }))}
              options={[
                { value: 'relay', label: '中转站·自动(默认)' },
                { value: 'sub', label: '订阅·手动' },
              ]}
            />
            <button
              onClick={() => setRelay({ imageModel: 'gpt-image-2' })}
              className={cn(
                'flex w-full flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition-all',
                draft.relay.imageModel === 'gpt-image-2'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary/40 hover:bg-secondary'
              )}
            >
              <span className={cn('text-sm font-semibold', draft.relay.imageModel === 'gpt-image-2' ? 'text-primary' : 'text-foreground')}>
                ChatGPT
              </span>
              <span className="font-mono text-[10px] leading-tight text-muted-foreground">gpt-image-2</span>
            </button>
            {draft.imageMode === 'sub' && (
              <p className="text-[11px] text-muted-foreground">订阅不自动出图,只给提示词、用你自己会员手动出</p>
            )}
          </div>
          )}

          {/* 中转站凭证:当前线路用了中转站才需要填,只两个框 */}
          {needRelay && (
            <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
              <Label className="text-xs text-muted-foreground">中转站地址 + Key</Label>
              <Input
                value={draft.relay.baseURL}
                onChange={(e) => setRelay({ baseURL: e.target.value })}
                placeholder="https://你的中转站/v1"
                className="font-mono text-xs"
              />
              <Input
                type="password"
                value={draft.relay.apiKey}
                onChange={(e) => setRelay({ apiKey: e.target.value })}
                placeholder="sk-..."
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1 bg-card" onClick={onClose}>
            取消
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
