import { sceneBus } from '#/components/galaxy/sceneBus'
import { RESTING_LAYOUT } from '#/lib/layout'
import { PLAY_SECONDS, cursorToUniform } from '#/lib/timeline'
import { useGalaxyStore, type PlaySpeed } from './store'
import { navigateSearch } from './url'

// The timeline cursor and its playback. The cursor is written straight into the star uniforms and
// to its few DOM subscribers; React state holds only open, playing and speed.

const URL_INTERVAL_MS = 250
const AZIMUTH_RAD_PER_S = 0.05

const get = () => useGalaxyStore.getState()

let cursor = 1
const listeners = new Set<() => void>()
let urlTimer: ReturnType<typeof setTimeout> | null = null
/** The `t` this module last wrote, so the route's echo of it is not mistaken for a deep link. */
let urlT: number | undefined
let raf = 0
let lastTick = 0

export const timelineCursor = {
  get: () => cursor,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
}

function apply() {
  const u = sceneBus.uniforms
  const open = get().timeline.open
  u.uTimelineOn.value = open ? 1 : 0
  u.uTimeline.value = open ? cursorToUniform(cursor, u.uBirthWindow.value) : RESTING_LAYOUT.timeline
  sceneBus.invalidate()
  for (const l of listeners) l()
}

function flushUrl() {
  if (urlTimer) clearTimeout(urlTimer)
  urlTimer = null
  urlT = get().timeline.open ? Math.round(cursor * 1e4) / 1e4 : undefined
  navigateSearch({ t: urlT }, { replace: true })
}

/** At most one history replace per interval while the cursor moves, ending on its last value. */
function scheduleUrl() {
  urlTimer ??= setTimeout(flushUrl, URL_INTERVAL_MS)
}

function stop() {
  cancelAnimationFrame(raf)
  if (get().timeline.playing) get().actions.setTimeline({ playing: false })
}

function tick(now: number) {
  const dt = Math.min(0.1, (now - lastTick) / 1000)
  lastTick = now
  const s = get()
  cursor = Math.min(1, cursor + (dt * s.timeline.speed) / PLAY_SECONDS)
  const c = sceneBus.controls
  // Same guards as idle autorotate: the azimuth setter bypasses the flat map's polar clamp.
  if (c && s.settings.motion === 'full' && !s.frozen && s.view === '3d' && !s.cameraBusy && !s.dragging) {
    c.azimuthAngle += AZIMUTH_RAD_PER_S * dt
  }
  apply()
  if (cursor >= 1) return timeline.pause()
  scheduleUrl()
  raf = requestAnimationFrame(tick)
}

export const timeline = {
  /** Opens at `at`, or at the end, where the galaxy looks exactly as it does closed. */
  open(at = 1) {
    cursor = Math.min(1, Math.max(0, at))
    get().actions.setTimeline({ open: true })
    apply()
    flushUrl()
  },

  close() {
    stop()
    cursor = 1
    get().actions.setTimeline({ open: false })
    apply()
    flushUrl()
  },

  toggle: () => (get().timeline.open ? timeline.close() : timeline.open()),

  /** Moves the cursor as the user scrubs; scrubbing stops playback. */
  seek(c: number) {
    stop()
    cursor = Math.min(1, Math.max(0, c))
    apply()
    scheduleUrl()
  },

  play() {
    if (!get().timeline.open) timeline.open(0)
    if (cursor >= 1) cursor = 0
    cancelAnimationFrame(raf)
    get().actions.setTimeline({ playing: true })
    lastTick = performance.now()
    raf = requestAnimationFrame(tick)
  },

  pause() {
    stop()
    if (get().timeline.open) flushUrl()
  },

  playPause: () => (get().timeline.playing ? timeline.pause() : timeline.play()),

  setSpeed: (speed: PlaySpeed) => get().actions.setTimeline({ speed }),

  /** Applies `?t=` when it changed outside this module: a deep link, an edit, or Back. */
  syncFromUrl(t: number | undefined) {
    if (t === urlT) return
    urlT = t
    stop()
    cursor = t ?? 1
    get().actions.setTimeline({ open: t !== undefined })
    apply()
  },
}
