import { NavLink } from 'react-router-dom'
import { Cpu } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: '提炼文案风格', end: true },
  { to: '/style-visual', label: '提炼画面风格', end: false },
  { to: '/rewrite', label: '改文', end: false },
  { to: '/write', label: '原创文', end: false },
  { to: '/image', label: '配图', end: false },
  { to: '/history', label: '历史', end: false },
]

export function AppHeader({
  providerLabel,
  configured,
  onOpenSettings,
}: {
  providerLabel: string
  configured: boolean
  onOpenSettings: () => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-gradient-to-r from-[hsl(214_52%_15%)] via-[hsl(208_56%_21%)] to-[hsl(200_62%_27%)] shadow-xl backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <Brand subtitle="提炼范文的文案与画面风格,产出你自己的内容" />

        <nav className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 p-1.5 sm:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-5 py-2 text-[15px] font-bold tracking-tight transition-all duration-200',
                  isActive
                    ? 'bg-white text-primary shadow-lg shadow-black/20'
                    : 'text-white/70 hover:bg-white/15 hover:text-white'
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <Button variant="outline" size="sm" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onOpenSettings}>
          <Cpu className="h-4 w-4" />
          {providerLabel}
          <span
            className={cn('ml-1 h-2 w-2 rounded-full', configured ? 'bg-emerald-500' : 'bg-amber-500')}
          />
        </Button>
      </div>
    </header>
  )
}
