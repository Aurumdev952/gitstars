import { HoverTooltip } from './HoverTooltip'
import { Legend } from './Legend'
import { RepoPanel } from './RepoPanel'
import { StarReticle } from './StarReticle'
import { TopBar } from './TopBar'

export function Hud({ dataName }: { dataName: string }) {
  return (
    <>
      <TopBar dataName={dataName} />
      <Legend />
      <StarReticle variant="hovered" />
      <StarReticle variant="selected" />
      <HoverTooltip />
      <RepoPanel />
    </>
  )
}
