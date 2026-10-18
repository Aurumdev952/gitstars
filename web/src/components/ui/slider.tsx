import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '#/lib/utils'

export function Slider({ className, thumbLabels, ...props }: React.ComponentProps<typeof SliderPrimitive.Root> & { thumbLabels?: string[] }) {
  const count = (props.value ?? props.defaultValue ?? [0]).length
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full touch-none items-center select-none', className)} {...props}>
      <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-white/[0.08]">
        <SliderPrimitive.Range className="absolute h-full bg-starlight/80" />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, k) => (
        <SliderPrimitive.Thumb
          key={k}
          aria-label={thumbLabels?.[k]}
          className={cn(
            'block size-3.5 rounded-full border border-starlight/70 bg-[oklch(0.94_0.04_85)]',
            'shadow-[0_0_0_4px_oklch(0.86_0.12_85/0.12),0_2px_6px_rgb(0_0_0/0.5)] transition-shadow',
            'hover:shadow-[0_0_0_6px_oklch(0.86_0.12_85/0.16),0_2px_6px_rgb(0_0_0/0.5)] focus-visible:outline-none',
            'focus-visible:shadow-[0_0_0_6px_oklch(0.86_0.12_85/0.3),0_2px_6px_rgb(0_0_0/0.5)]',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}
