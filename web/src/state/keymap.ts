import { commands } from './commands'
import { useGalaxyStore } from './store'

export type Binding = {
  /** Keys shown in the shortcuts dialog. */
  keys: string[]
  label: string
  group: 'Search' | 'Navigate' | 'View'
  match: (e: KeyboardEvent) => boolean
  run: (e: KeyboardEvent) => void
  /** Runs even while a text field has focus. */
  global?: boolean
  /** False keeps a binding out of the shortcuts dialog when another row already lists it. */
  help?: boolean
}

const plain = (key: string) => (e: KeyboardEvent) => e.key === key && !e.metaKey && !e.ctrlKey && !e.altKey
const arrow = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const

/**
 * The single source for keyboard behaviour and the shortcuts dialog. Every `run` reads `commands`
 * at call time: the bundle may evaluate this table before the commands module has initialised.
 */
export const KEYMAP: Binding[] = [
  {
    keys: ['⌘', 'K', 'or', '/'],
    label: 'Search your stars',
    group: 'Search',
    match: (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k',
    run: () => {
      const s = useGalaxyStore.getState()
      s.actions.setOverlay(s.overlay === 'palette' ? 'none' : 'palette')
    },
    global: true,
  },
  { keys: ['/'], label: 'Search', group: 'Search', match: plain('/'), run: () => commands.openPalette(), help: false },
  { keys: ['r'], label: 'Forgotten star', group: 'Search', match: plain('r'), run: () => commands.forgottenStar() },
  { keys: ['Esc'], label: 'Step out a level', group: 'Navigate', match: plain('Escape'), run: () => commands.stepOut() },
  {
    keys: ['←', '↑', '→', '↓'],
    label: 'Nearest star that way',
    group: 'Navigate',
    match: (e) => e.key in arrow && !e.metaKey && !e.ctrlKey && useGalaxyStore.getState().view !== 'list',
    run: (e) => {
      const dir = arrow[e.key as keyof typeof arrow]
      if (!commands.spatial(dir)) commands.orbit(dir)
    },
  },
  { keys: ['n'], label: 'Next neighbour', group: 'Navigate', match: plain('n'), run: () => commands.cycleNeighbor(1) },
  { keys: ['N'], label: 'Previous neighbour', group: 'Navigate', match: plain('N'), run: () => commands.cycleNeighbor(-1) },
  { keys: [']'], label: 'Next hit or member', group: 'Navigate', match: plain(']'), run: () => commands.cycleList(1) },
  { keys: ['['], label: 'Previous hit or member', group: 'Navigate', match: plain('['), run: () => commands.cycleList(-1) },
  {
    keys: ['1', '–', '9'],
    label: 'Jump to a galaxy',
    group: 'Navigate',
    match: (e) => /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey,
    run: (e) => commands.focusGalaxy(Number(e.key) - 1),
  },
  { keys: ['g'], label: 'Home', group: 'Navigate', match: plain('g'), run: () => commands.home() },
  { keys: ['f'], label: 'Flat map', group: 'View', match: plain('f'), run: () => commands.toggleFlat() },
  { keys: ['l'], label: 'List view', group: 'View', match: plain('l'), run: () => commands.toggleList() },
  {
    keys: ['t'],
    label: 'Timeline',
    group: 'View',
    match: (e) => plain('t')(e) && useGalaxyStore.getState().view !== 'list',
    run: () => commands.toggleTimeline(),
  },
  {
    keys: ['Space'],
    label: 'Play or pause the timeline',
    group: 'View',
    match: (e) => plain(' ')(e) && useGalaxyStore.getState().timeline.open && useGalaxyStore.getState().view !== 'list' && !activatable(e.target),
    run: () => commands.playPause(),
  },
  { keys: ['?'], label: 'Keyboard shortcuts', group: 'View', match: plain('?'), run: () => commands.openShortcuts() },
]

/** Controls that Space activates or scrolls; the timeline's Space shortcut leaves them alone. */
const activatable = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.closest('button, a, [role="radio"], [role="slider"], [role="button"], [role="option"], [data-scroll-region]') !== null

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

export function handleKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return
  const s = useGalaxyStore.getState()
  for (const b of KEYMAP) {
    if (!b.match(e)) continue
    if (!b.global && typing(e.target)) return
    // Radix dialogs and popovers own Esc and arrows while open; only global chords pass through.
    if (!b.global && s.overlay !== 'none') return
    e.preventDefault()
    b.run(e)
    return
  }
}
