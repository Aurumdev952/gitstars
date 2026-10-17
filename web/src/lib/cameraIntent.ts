export type NavState = { selected: number | null; focusCluster: string | null }

export type CameraIntent = { kind: 'repo'; index: number } | { kind: 'cluster'; id: string } | { kind: 'home' } | null

/**
 * Where the camera should go when URL-owned navigation changes. Stepping out of a repo returns to
 * its cluster if one is focused; stepping out of a cluster goes home; deselecting a repo in open
 * space leaves the camera where it is.
 */
export function cameraIntent(prev: NavState, next: NavState): CameraIntent {
  if (next.selected !== null) return next.selected === prev.selected ? null : { kind: 'repo', index: next.selected }
  if (next.focusCluster !== null) {
    const changed = next.focusCluster !== prev.focusCluster || prev.selected !== null
    return changed ? { kind: 'cluster', id: next.focusCluster } : null
  }
  return prev.focusCluster !== null ? { kind: 'home' } : null
}
