import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Track } from '@/lib/types'

/**
 * Edit one 风格: its name and its dedicated AI prompt framework.
 * This is where the user pastes the prompt from their Feishu doc.
 */
export function TrackEditorModal({
  track,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: {
  track: Track
  canDelete: boolean
  onSave: (patch: Pick<Track, 'name' | 'prompt' | 'kind'>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(track.name)
  const [prompt, setPrompt] = useState(track.prompt)
  // 画面风格(visual)保持 visual、不显示"改文/原创"切换;文案风格才在 改文/原创 间切。
  const isVisual = track.kind === 'visual'
  const [kind, setKind] = useState<'rewrite' | 'original'>(track.kind === 'original' ? 'original' : 'rewrite')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">编辑风格</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 space-y-2">
          <Label>风格名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：家庭婚姻" />
        </div>

        {!isVisual && (
          <div className="mb-4 space-y-2">
            <Label>风格类型</Label>
            <div className="inline-flex rounded-full border border-border/60 bg-secondary/40 p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setKind('rewrite')}
                className={
                  'rounded-full px-4 py-1.5 transition-all ' +
                  (kind === 'rewrite'
                    ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-primary')
                }
              >
                改文（给原文→改写）
              </button>
              <button
                type="button"
                onClick={() => setKind('original')}
                className={
                  'rounded-full px-4 py-1.5 transition-all ' +
                  (kind === 'original'
                    ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-primary')
                }
              >
                原创（给主题→原创）
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              决定这个风格出现在「改文」还是「原创文」板块。
            </p>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label>{isVisual ? '画面风格提示词' : 'AI 提示词框架'}</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isVisual ? '这个画面风格的提示词(色彩/光影/构图/质感)…' : '把这个风格专属的改文提示词框架粘贴到这里…'}
            className="min-h-[280px] flex-1 resize-none font-mono text-xs leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">
            {isVisual ? '这套提示词决定配图出什么画面风格。' : '这套提示词决定这个风格怎么改文。可把你整理好的风格框架直接粘进来。'}
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3">
          {canDelete && (
            <Button variant="ghost" className="text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> 删除风格
            </Button>
          )}
          <Button variant="outline" className="ml-auto bg-card" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              onSave({ name: name.trim() || '新风格', prompt, kind: isVisual ? 'visual' : kind })
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
