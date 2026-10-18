import { useEffect, useLayoutEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { useGalaxyStore } from '#/state/store'
import { handleKey } from '#/state/keymap'
import { ClusterPanel } from './ClusterPanel'
import { DiscoverButton } from './DiscoverButton'
import { FirstRunHint } from './FirstRunHint'
import { NoMatches } from './NoMatches'
import { HoverTooltip } from './HoverTooltip'
import { Legend } from './Legend'
import { LensLegend } from './LensLegend'
import { ListView } from './ListView'
import { LiveRegion } from './LiveRegion'
import { RepoLabelPool } from './RepoLabelPool'
import { RepoPanel } from './RepoPanel'
import { SearchPalette } from './SearchPalette'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StarReticle } from './StarReticle'
import { Timeline } from './Timeline'
import { TopBar } from './TopBar'

export function Hud({ dataName }: { dataName: string }) {
  const reduced = useGalaxyStore((s) => s.settings.motion === 'reduced' || s.frozen)
  const list = useGalaxyStore((s) => s.view === 'list' && s.galaxy !== null)

  // HUD chrome (`hud-enter`) waits off-stage during the intro spiral, then slides up in a stagger.
  const held = useGalaxyStore((s) => s.intro === 'spiral')
  useLayoutEffect(() => {
    document.documentElement.dataset.intro = held ? 'held' : 'shown'
  }, [held])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <TopBar dataName={dataName} />
      {list ? (
        <ListView />
      ) : (
        <>
          <Legend />
          <RepoLabelPool />
          <StarReticle variant="hovered" />
          <StarReticle variant="selected" />
          <HoverTooltip />
          <LensLegend />
          <Timeline />
          <DiscoverButton />
          <FirstRunHint />
          <NoMatches />
        </>
      )}
      <ClusterPanel />
      <RepoPanel />
      <SearchPalette />
      <ShortcutsDialog />
      <LiveRegion />
    </MotionConfig>
  )
}
