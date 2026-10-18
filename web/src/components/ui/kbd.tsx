import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-white/10 bg-white/[0.05] px-1',
        'font-sans text-[10.5px] leading-none font-medium text-ink-faint shadow-[inset_0_-1px_0_rgb(255_255_255/0.04)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
