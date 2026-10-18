import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '#/lib/utils'

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn('flex h-full w-full flex-col overflow-hidden text-ink', className)} {...props} />
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      className={cn('h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint', className)}
      {...props}
    />
  )
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('scrollbar-thin overflow-x-hidden overflow-y-auto overscroll-contain', className)} {...props} />
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty {...props} />
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'px-2 pb-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.02em] [&_[cmdk-group-heading]]:text-ink-faint',
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13.5px] text-ink-muted outline-none select-none',
        'data-[selected=true]:bg-white/[0.07] data-[selected=true]:text-ink',
        'data-[selected=true]:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]',
        className,
      )}
      {...props}
    />
  )
}
