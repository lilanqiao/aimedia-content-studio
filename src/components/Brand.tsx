import { PenLine } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BrandProps {
  subtitle?: string
  className?: string
}

/** 「自媒体图文工坊」wordmark — pen glyph + bold sans title on the premium-blue theme. */
export function Brand({ subtitle, className }: BrandProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm">
        <PenLine className="h-5 w-5" strokeWidth={2} />
      </div>
      <div className="leading-tight">
        <div className="text-lg font-bold tracking-tight text-white">自媒体图文工坊</div>
        {subtitle && <div className="text-[11px] text-white/55">{subtitle}</div>}
      </div>
    </div>
  )
}
