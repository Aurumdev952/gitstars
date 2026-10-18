import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { INTRO, introCamera, introFrame, type IntroMode } from '#/lib/intro'
import type { GalaxyIndex } from '#/lib/load'
import { useGalaxyStore, type IntroPhase } from '#/state/store'
import { homePose } from './Director'
import { sceneBus } from './sceneBus'

/** A skipped intro still finishes, compressed into this long, so nothing snaps. */
const SKIP_S = 0.45
/** A long first frame (shader compiles) must not eat the start of the choreography. */
const MAX_STEP = 1 / 30

const modeOf = (p: IntroPhase): IntroMode => (p === 'fade' ? 'fade' : p === 'done' ? 'done' : 'full')

/**
 * Plays the opening: stars spiral out of the galaxy's centre while the camera pulls back to home,
 * nebulae gather, labels stagger in and the HUD slides up (lib/intro.ts holds the timing). Any
 * pointer, wheel or key input fast-forwards it.
 */
export function Intro({ galaxy }: { galaxy: GalaxyIndex }) {
  const gl = useThree((s) => s.gl)
  const clock = useRef({ t: 0, rate: 1, started: false, cameraFree: false })

  useLayoutEffect(() => {
    const u = sceneBus.uniforms
    u.uIntroOrigin.value.x = galaxy.center[0]
    u.uIntroOrigin.value.y = galaxy.center[1]
    u.uIntroOrigin.value.z = galaxy.center[2]
    u.uIntroRadius.value = galaxy.radius
    if (useGalaxyStore.getState().intro !== 'done') {
      gl.domElement.style.opacity = '0'
      u.uIntro.value = 0
    }
  }, [galaxy, gl])

  useEffect(() => {
    const fastForward = () => {
      const c = clock.current
      if (useGalaxyStore.getState().intro === 'done') return
      c.rate = Math.max(c.rate, (INTRO.end - c.t) / SKIP_S)
    }
    const skip = fastForward
    // A camera command (a click on a star, a galaxy key, the flat toggle) or a drag takes the
    // camera over; the intro stops posing it so the flight it started is not overwritten.
    const offCamera = useGalaxyStore.subscribe(
      (s) => s.cameraBusy || s.dragging,
      (taken) => {
        const c = clock.current
        if (!taken || !c.started || useGalaxyStore.getState().intro === 'done') return
        c.cameraFree = true
        fastForward()
      },
    )
    // The list view stops the frame loop, which would strand the intro (and the HUD it holds
    // back) mid-spiral; leaving 3D finishes it on the spot.
    const offView = useGalaxyStore.subscribe(
      (s) => s.view,
      (view) => {
        const s = useGalaxyStore.getState()
        if (view !== 'list' || s.intro === 'done') return
        const u = sceneBus.uniforms
        u.uIntro.value = 1
        sceneBus.labelClock = Infinity
        gl.domElement.style.opacity = ''
        s.actions.setIntro('done')
      },
    )
    const opts = { capture: true, passive: true } as const
    window.addEventListener('pointerdown', skip, opts)
    window.addEventListener('wheel', skip, opts)
    window.addEventListener('keydown', skip, opts)
    return () => {
      offCamera()
      offView()
      window.removeEventListener('pointerdown', skip, opts)
      window.removeEventListener('wheel', skip, opts)
      window.removeEventListener('keydown', skip, opts)
    }
  }, [gl])

  // Ahead of CameraControls (-1), so the pose written here is the one it renders this frame.
  useFrame((state, dt) => {
    const store = useGalaxyStore.getState()
    const phase = store.intro
    if (phase === 'done') return
    const c = sceneBus.controls
    const pose = homePose()
    if (!c || !pose) return
    const ck = clock.current
    ck.started = true
    ck.t += Math.min(dt, MAX_STEP) * ck.rate
    const f = introFrame(modeOf(phase), ck.t)
    const u = sceneBus.uniforms
    u.uIntro.value = f.intro
    gl.domElement.style.opacity = String(f.fade)
    sceneBus.labelClock = f.labelClock
    if ((phase === 'spiral' || phase === 'settling') && !ck.cameraFree) {
      const { azimuth, distance } = introCamera(f, pose)
      const [tx, ty, tz] = pose.target
      const sp = Math.sin(pose.polar)
      void c.setLookAt(
        tx + distance * sp * Math.sin(azimuth),
        ty + distance * Math.cos(pose.polar),
        tz + distance * sp * Math.cos(azimuth),
        tx,
        ty,
        tz,
        false,
      )
    }
    if (f.done) {
      sceneBus.labelClock = Infinity
      gl.domElement.style.opacity = ''
      store.actions.setIntro('done')
    } else if (f.hud && phase === 'spiral') store.actions.setIntro('settling')
    state.invalidate()
  }, -2)

  return null
}
