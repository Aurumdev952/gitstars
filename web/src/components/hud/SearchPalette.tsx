import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Compass, Home, Keyboard, List, Map as MapIcon, Search, Sparkles, SlidersHorizontal, X } from 'lucide-react'
import { useGalaxyStore, type ModelStatus } from '#/state/store'
import { commands } from '#/state/commands'
import { activeFacets } from '#/lib/filters'
import { matchClusters } from '#/lib/search'
import { formatCompact, splitFullName } from '#/lib/format'
import { director } from '#/components/galaxy/Director'
import { warmModel } from '#/workers/searchClient'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '#/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog'
import { Kbd } from '#/components/ui/kbd'
import { cn } from '#/lib/utils'
import { ClusterDot } from './Legend'

const TYPE_DEBOUNCE_MS = 110
const PREVIEW_DEBOUNCE_MS = 150
const SHOWN_REPOS = 12

type Action = { id: string; label: ReactNode; icon: ReactNode; hint?: string; run: () => void }

export function SearchPalette() {
  const open = useGalaxyStore((s) => s.overlay === 'palette')
  const { setOverlay } = useGalaxyStore((s) => s.actions)
  const committed = useRef(false)

  useEffect(() => {
    if (open) {
      committed.current = false
      director.saveView()
      warmModel()
      return
    }
    // Cancelling after arrow-key previews puts the camera back on the hits, or where it started.
    const s = useGalaxyStore.getState()
    s.actions.hover(null)
    if (committed.current || !director.isPreviewing()) return director.forgetView()
    if (s.hits && s.hits.frame.length > 0) {
      director.forgetView()
      void director.frameIndices(s.hits.frame)
    } else void director.restoreView()
  }, [open])

  const close = (how: 'commit' | 'cancel') => {
    committed.current = how === 'commit'
    setOverlay('none')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close('cancel')}>
      <DialogContent
        aria-describedby={undefined}
        overlayClassName="bg-[oklch(0.08_0.02_275/0.18)]"
        className="top-[12vh] w-[min(660px,calc(100vw-2rem))] overflow-hidden"
      >
        <DialogTitle className="sr-only">Search your stars</DialogTitle>
        {open && <PaletteBody onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({ onClose }: { onClose: (how: 'commit' | 'cancel') => void }) {
  const g = useGalaxyStore((s) => s.galaxy)!
  const hits = useGalaxyStore((s) => s.hits)
  const model = useGalaxyStore((s) => s.model)
  const view = useGalaxyStore((s) => s.view)
  const filters = useGalaxyStore((s) => s.filters)
  const lensQuery = useGalaxyStore((s) => s.lensQuery)
  const { setQuery, select, focus, hover } = useGalaxyStore((s) => s.actions)
  const [text, setText] = useState(() => useGalaxyStore.getState().query ?? '')
  const [active, setActive] = useState('')
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const t = setTimeout(() => setQuery(text), TYPE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, setQuery])

  useEffect(() => () => clearTimeout(previewTimer.current), [])

  const trimmed = text.trim()
  const fresh = hits !== null && hits.query === trimmed
  const repos = fresh ? hits.idx.slice(0, SHOWN_REPOS) : []
  const clusters = useMemo(() => (trimmed ? matchClusters(g, trimmed) : g.galaxies.slice(0, 9)), [g, trimmed])

  const actions: Action[] = []
  if (trimmed) {
    actions.push({
      id: 'lens',
      icon: <Sparkles className="size-4 text-starlight" />,
      label: (
        <>
          Light up the galaxy by <span className="text-ink">“{trimmed}”</span>
        </>
      ),
      hint: 'Concept lens',
      run: () => commands.lens(trimmed),
    })
  }
  if (lensQuery) actions.push({ id: 'lens-off', icon: <X className="size-4" />, label: `Turn off the “${lensQuery}” lens`, run: commands.clearLens })
  actions.push(
    { id: 'forgotten', icon: <Compass className="size-4" />, label: 'Show me a forgotten star', hint: 'r', run: commands.forgottenStar },
    view === 'flat'
      ? { id: 'space', icon: <Box className="size-4" />, label: 'Back to 3D space', hint: 'f', run: commands.toggleFlat }
      : { id: 'flat', icon: <MapIcon className="size-4" />, label: 'Flatten into a map', hint: 'f', run: commands.toggleFlat },
    { id: 'list', icon: <List className="size-4" />, label: view === 'list' ? 'Back to the galaxy' : 'Browse as a list', hint: 'l', run: commands.toggleList },
    { id: 'home', icon: <Home className="size-4" />, label: 'Fly home', hint: 'g', run: commands.home },
  )
  if (activeFacets(filters).length > 0)
    actions.push({ id: 'clear-filters', icon: <SlidersHorizontal className="size-4" />, label: 'Clear all filters', run: commands.clearFilters })
  actions.push({ id: 'keys', icon: <Keyboard className="size-4" />, label: 'Keyboard shortcuts', hint: '?', run: commands.openShortcuts })
  const shownActions = trimmed ? actions.filter((a) => a.id === 'lens' || matchesAction(a, trimmed)) : actions

  const values = [...repos.map((i) => `repo:${i}`), ...clusters.map((c) => `cluster:${c.id}`), ...shownActions.map((a) => `action:${a.id}`)]
  const first = values[0] ?? ''
  const current = values.includes(active) ? active : first

  // Only arrow keys preview; the pointer gliding over rows should not fly the camera.
  const byKeys = useRef(false)
  const onActive = (value: string) => {
    setActive(value)
    clearTimeout(previewTimer.current)
    const m = /^repo:(\d+)$/.exec(value)
    if (!m || !byKeys.current) return
    const i = Number(m[1])
    previewTimer.current = setTimeout(() => {
      hover(i)
      void director.preview(i)
    }, PREVIEW_DEBOUNCE_MS)
  }

  return (
    <Command
      shouldFilter={false}
      loop
      value={current}
      onValueChange={onActive}
      label="Search your stars"
      onKeyDownCapture={(e) => (byKeys.current = e.key === 'ArrowDown' || e.key === 'ArrowUp')}
      onPointerMoveCapture={() => (byKeys.current = false)}
    >
      <div className="flex h-[58px] items-center gap-3 border-b border-glass-border px-4">
        <Search className="size-[18px] shrink-0 text-ink-faint" aria-hidden />
        <CommandInput value={text} onValueChange={setText} placeholder="Search your stars, or describe an idea…" autoFocus />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setText('')}
            className="rounded-md p-1 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
        <Kbd>esc</Kbd>
      </div>

      <CommandList className="max-h-[min(58vh,540px)] py-1">
        {trimmed && fresh && repos.length === 0 && clusters.length === 0 && (
          <p className="px-5 py-8 text-center text-[13px] text-ink-faint">
            No stars match <span className="text-ink-muted">“{trimmed}”</span>
            {model.state !== 'ready' && ' yet. Semantic matches arrive once the model is warm.'}
          </p>
        )}
        {repos.length > 0 && (
          <CommandGroup heading={hits?.lexicalOnly ? 'Repositories · keyword matches' : 'Repositories'}>
            {repos.map((i) => {
              const r = g.repos[i]!
              const [owner, name] = splitFullName(r.fullName)
              const sys = g.systems[g.systemOf[i]!]!
              return (
                <CommandItem
                  key={i}
                  value={`repo:${i}`}
                  onSelect={() => {
                    onClose('commit')
                    select(i)
                  }}
                  className="items-start py-2"
                >
                  <ClusterDot color={sys.color.css} className="mt-[7px] size-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">
                      <span className="text-ink-faint">{owner}/</span>
                      <span className="text-ink">{name}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">{r.oneLiner}</span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-right text-[11.5px] text-ink-faint">
                    <span className="tabular block text-ink-muted">★ {formatCompact(r.stars)}</span>
                    <span className="block">{sys.name}</span>
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {clusters.length > 0 && (
          <CommandGroup heading="Galaxies & systems">
            {clusters.map((c) => (
              <CommandItem
                key={c.id}
                value={`cluster:${c.id}`}
                onSelect={() => {
                  onClose('commit')
                  focus(c.id)
                }}
              >
                <ClusterDot color={c.color.css} className={c.level === 0 ? 'size-2' : 'size-1.5'} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-ink">{c.name}</span>
                  {c.level === 1 && <span className="text-ink-faint"> · {g.clusterById.get(c.parentId!)!.name}</span>}
                </span>
                <span className="tabular font-mono text-[11px] text-ink-faint">{c.members.length}</span>
                <span className="w-[52px] text-right text-[11px] text-ink-faint">{c.level === 0 ? 'galaxy' : 'system'}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shownActions.length > 0 && (
          <CommandGroup heading="Actions">
            {shownActions.map((a) => (
              <CommandItem
                key={a.id}
                value={`action:${a.id}`}
                onSelect={() => {
                  onClose('commit')
                  a.run()
                }}
              >
                <span className="flex size-5 items-center justify-center text-ink-faint">{a.icon}</span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.hint && (a.hint.length === 1 ? <Kbd>{a.hint}</Kbd> : <span className="text-[11px] text-ink-faint">{a.hint}</span>)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>

      <footer className="flex h-10 items-center gap-3 border-t border-glass-border px-4 text-[11.5px] text-ink-faint">
        <ModelBadge model={model} />
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="mr-2">preview</span>
          <Kbd>↵</Kbd>
          <span>open</span>
        </span>
      </footer>
    </Command>
  )
}

function matchesAction(a: Action, q: string) {
  const text = typeof a.label === 'string' ? a.label : a.id
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => text.toLowerCase().includes(w))
}

const DEVICE = { webgpu: 'WebGPU', wasm: 'WASM' } as const

export function ModelBadge({ model }: { model: ModelStatus }) {
  const [dot, text] =
    model.state === 'ready'
      ? ['bg-emerald-300/90', `Semantic search ready · ${DEVICE[model.device]}`]
      : model.state === 'loading'
        ? [
            'bg-starlight animate-pulse',
            `Semantic search warming… ${Math.round(model.progress * 100)}%${model.device ? ` (${DEVICE[model.device]})` : ''}`,
          ]
        : model.state === 'error'
          ? ['bg-rose-400/90', `Keyword search only · ${model.message}`]
          : ['bg-ink-faint', 'Keyword search · semantic model not loaded']
  return (
    <span className="flex min-w-0 items-center gap-2" title={model.state === 'error' ? model.message : undefined}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />
      <span className="truncate">{text}</span>
    </span>
  )
}
