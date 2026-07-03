import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Input, type InputProps } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface IconFieldProps extends InputProps {
  label: string
  icon: LucideIcon
}

/** Labelled input with a leading icon — the auth-form field used across the app. */
export const IconField = React.forwardRef<HTMLInputElement, IconFieldProps>(
  ({ label, icon: Icon, id, ...props }, ref) => {
    const fieldId = id ?? React.useId()
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{label}</Label>
        <div className="relative">
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={fieldId} ref={ref} className="pl-9" {...props} />
        </div>
      </div>
    )
  }
)
IconField.displayName = 'IconField'
