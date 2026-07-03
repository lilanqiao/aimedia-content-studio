import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/** Pill-style segmented toggle (workflow type, creation mode, input method). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cn('inline-flex rounded-xl border border-border/50 bg-muted/70 p-1', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-all duration-200',
            value === opt.value
              ? 'bg-card font-semibold text-primary shadow-md ring-1 ring-primary/15'
              : 'font-medium text-muted-foreground hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
