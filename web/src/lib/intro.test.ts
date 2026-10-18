import { describe, expect, it } from 'vitest'
import { INTRO, introCamera, introDelay, introFrame, introMode, isDeepLink, labelReveal } from './intro'

describe('introMode', () => {
  it('plays the full spiral on a plain first visit', () => {
    expect(introMode({ deepLink: false, reducedMotion: false, frozen: false })).toBe('full')
  })

  it('replaces the spiral with a fade under reduced motion', () => {
    expect(introMode({ deepLink: false, reducedMotion: true, frozen: false })).toBe('fade')
  })

  it('skips entirely for a deep link or a frozen screenshot, even with reduced motion', () => {
    expect(introMode({ deepLink: true, reducedMotion: false, frozen: false })).toBe('done')
    expect(introMode({ deepLink: true, reducedMotion: true, frozen: false })).toBe('done')
    expect(introMode({ deepLink: false, reducedMotion: false, frozen: true })).toBe('done')
  })
})

describe('isDeepLink', () => {
  it('counts a repo, cluster, query, lens, timeline cursor or non-3D view', () => {
    expect(isDeepLink({})).toBe(false)
    expect(isDeepLink({ view: '3d' })).toBe(false)
    for (const s of [{ repo: 'a/b' }, { cluster: 'g01' }, { q: 'rust' }, { lens: 'llm' }, { t: 0 }, { view: 'flat' }, { view: 'list' }]) {
      expect(isDeepLink(s)).toBe(true)
    }
  })
})

describe('introFrame', () => {
  it('starts dark and collapsed, with the HUD held back', () => {
    const f = introFrame('full', 0)
    expect(f).toMatchObject({ fade: 0, intro: 0, dolly: 0, orbit: 0, hud: false, done: false })
  })

  it('settles on the resting scene by the end', () => {
    const f = introFrame('full', INTRO.end)
    expect(f).toMatchObject({ fade: 1, intro: 1, dolly: 1, orbit: 1, hud: true, done: true })
    expect(labelReveal(f.labelClock, 5)).toBe(1)
  })

  it('a skipped intro is the same as a finished one', () => {
    const skipped = introFrame('done', 0)
    expect(skipped).toMatchObject({ fade: 1, intro: 1, dolly: 1, orbit: 1, hud: true, done: true })
    expect(labelReveal(skipped.labelClock, 31)).toBe(1)
  })

  it('brings the HUD up with the labels, after the stars have landed', () => {
    expect(introFrame('full', INTRO.labelsAt - 0.01).hud).toBe(false)
    expect(introFrame('full', INTRO.labelsAt).intro).toBe(1)
    expect(introFrame('full', INTRO.labelsAt).hud).toBe(true)
  })

  it('the reduced-motion fade only fades: no spiral, no camera move, HUD at once', () => {
    const mid = introFrame('fade', INTRO.fadeOnly / 2)
    expect(mid).toMatchObject({ intro: 1, dolly: 1, orbit: 1, hud: true, done: false })
    expect(mid.fade).toBeCloseTo(0.5)
    expect(introFrame('fade', INTRO.fadeOnly).done).toBe(true)
  })

  it('never runs backwards', () => {
    let prev = introFrame('full', 0)
    for (let t = 0.05; t <= INTRO.end; t += 0.05) {
      const f = introFrame('full', t)
      expect(f.intro).toBeGreaterThanOrEqual(prev.intro)
      expect(f.dolly).toBeGreaterThanOrEqual(prev.dolly)
      expect(f.orbit).toBeGreaterThanOrEqual(prev.orbit)
      expect(f.fade).toBeGreaterThanOrEqual(prev.fade)
      prev = f
    }
  })
})

describe('labelReveal', () => {
  it('staggers labels by 60 ms in order', () => {
    expect(labelReveal(0, 0)).toBe(0)
    expect(labelReveal(0.2, 0)).toBeGreaterThan(labelReveal(0.2, 2))
    expect(labelReveal(2 * INTRO.labelStagger, 2)).toBe(0)
  })
})

describe('introCamera', () => {
  it('flies from close in and turned back to the home pose', () => {
    const home = { azimuth: 0.6, distance: 400 }
    const start = introCamera({ dolly: 0, orbit: 0 }, home)
    expect(start.distance).toBeCloseTo(400 * INTRO.startDistance)
    expect(start.azimuth).toBeCloseTo(0.6 - Math.PI / 6)
    expect(introCamera({ dolly: 1, orbit: 1 }, home)).toEqual(home)
  })

  it('backs off as fast as the earliest stars fly out, so the burst stays in frame', () => {
    // At any moment the camera is at least as far out (relative to home) as the earliest star.
    for (let t = INTRO.stars[0]; t < INTRO.stars[1]; t += 0.1) {
      const f = introFrame('full', t)
      const e = 1 - (1 - Math.min(1, f.intro / 0.55)) ** 3
      expect(introCamera(f, { azimuth: 0, distance: 1 }).distance).toBeGreaterThanOrEqual(e - 1e-9)
    }
  })
})

describe('introDelay', () => {
  it('stays inside the 0.45 the layout reserves and orders galaxies', () => {
    expect(introDelay(0, 16, 0)).toBe(0)
    expect(introDelay(15, 16, 1)).toBeLessThanOrEqual(0.45)
    expect(introDelay(8, 16, 0.5)).toBeGreaterThan(introDelay(2, 16, 0.5))
    expect(introDelay(0, 1, 0.5)).toBeLessThanOrEqual(0.45)
  })
})
