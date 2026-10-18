import { useEffect, useState } from 'react'
import { useGalaxyStore, type GalaxyStore } from '#/state/store'
import { formatCompact, formatCount } from '#/lib/format'

const HOVER_DELAY_MS = 450

function describeStar(s: GalaxyStore, i: number) {
  const g = s.galaxy!
  const r = g.repos[i]!
  return `${r.fullName}, ${r.kind}, ${formatCompact(r.stars)} stars, in ${g.systems[g.systemOf[i]!]!.name}`
}

/** Polite announcements for what the canvas shows, since the canvas itself is aria-hidden. */
export function LiveRegion() {
  const [text, setText] = useState('')

  useEffect(() => {
    const store = useGalaxyStore
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    const say = (t: string) => setText(t)
    const offs = [
      store.subscribe(
        (s) => s.hovered,
        (i) => {
          clearTimeout(hoverTimer)
          if (i === null) return
          hoverTimer = setTimeout(() => say(describeStar(store.getState(), i)), HOVER_DELAY_MS)
        },
      ),
      store.subscribe(
        (s) => s.selected,
        (i) => i !== null && say(`Selected ${describeStar(store.getState(), i)}`),
      ),
      store.subscribe(
        (s) => s.focusCluster,
        (id) => {
          const c = id ? store.getState().galaxy?.clusterById.get(id) : null
          if (c) say(`Focused ${c.name}, ${formatCount(c.members.length)} stars`)
        },
      ),
      // Once per query: the semantic upgrade of the same query would repeat it.
      store.subscribe(
        (s) => s.hits?.query ?? null,
        (q) => {
          const h = store.getState().hits
          if (q && h) say(`${h.idx.length} results for ${q}`)
        },
      ),
      store.subscribe(
        (s) => s.filtered?.count,
        (n, prev) => n !== undefined && prev !== undefined && say(`${formatCount(n)} of ${formatCount(store.getState().galaxy?.n ?? 0)} stars shown`),
      ),
      store.subscribe(
        (s) => s.lens.state,
        (state) => {
          const l = store.getState().lens
          if (state === 'ready' && l.state === 'ready') say(`Lens on: stars light up by closeness to ${l.query}`)
        },
      ),
      store.subscribe(
        (s) => s.view,
        (v) => say(v === 'list' ? 'List view' : v === 'flat' ? 'Flat map view' : '3D view'),
      ),
    ]
    return () => {
      clearTimeout(hoverTimer)
      offs.forEach((off) => off())
    }
  }, [])

  return (
    <div aria-live="polite" aria-atomic className="sr-only">
      {text}
    </div>
  )
}
