import { useGalaxyStore } from '#/state/store'
import { KEYMAP, type Binding } from '#/state/keymap'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog'
import { Kbd } from '#/components/ui/kbd'

const GROUPS: Binding['group'][] = ['Search', 'Navigate', 'View']

export function ShortcutsDialog() {
  const open = useGalaxyStore((s) => s.overlay === 'shortcuts')
  const { setOverlay } = useGalaxyStore((s) => s.actions)
  return (
    <Dialog open={open} onOpenChange={(o) => setOverlay(o ? 'shortcuts' : 'none')}>
      <DialogContent className="top-[16vh] w-[min(560px,calc(100vw-2rem))] p-6">
        <DialogTitle className="text-[16px] font-medium text-ink">Keyboard</DialogTitle>
        <DialogDescription className="mt-1 text-[12.5px] text-ink-faint">Everything the galaxy does, without the mouse.</DialogDescription>
        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group} className={group === 'Navigate' ? 'sm:row-span-2' : undefined}>
              <h3 className="mb-2 text-[11.5px] font-medium tracking-[0.02em] text-ink-faint">{group}</h3>
              <ul className="space-y-1.5">
                {KEYMAP.filter((b) => b.group === group).map((b) => (
                  <li key={b.label} className="flex items-center justify-between gap-4 text-[13px] text-ink-muted">
                    <span>{b.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {b.keys.map((k) => (k === '–' ? <span key={k} className="text-ink-faint">–</span> : <Kbd key={k}>{k}</Kbd>))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
