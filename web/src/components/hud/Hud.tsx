import { HoverTooltip } from './HoverTooltip'
import { Legend } from './Legend'
import { RepoPanel } from './RepoPanel'
import { SelectionReticle } from './SelectionReticle'
import { TopBar } from './TopBar'

export function Hud({ dataName }: { dataName: string }) {
  return (
    <>
      <TopBar dataName={dataName} />
      <Legend />
      <SelectionReticle />
      <HoverTooltip />
      <RepoPanel />
    </>
  )
}
