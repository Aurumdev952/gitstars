import { describe, expect, it } from 'vitest'
import { cameraIntent } from './cameraIntent'

const none = { selected: null, focusCluster: null }

describe('cameraIntent', () => {
  it('flies to a newly selected repo, and not again when only the cluster param changes around it', () => {
    expect(cameraIntent(none, { selected: 4, focusCluster: null })).toEqual({ kind: 'repo', index: 4 })
    expect(cameraIntent({ selected: 4, focusCluster: null }, { selected: 4, focusCluster: 'g01' })).toBeNull()
  })

  it('returns to the focused cluster when the repo is dropped (Back from ?cluster&repo)', () => {
    expect(cameraIntent({ selected: 4, focusCluster: 'g01' }, { selected: null, focusCluster: 'g01' })).toEqual({ kind: 'cluster', id: 'g01' })
  })

  it('frames a newly focused cluster and goes home when leaving it', () => {
    expect(cameraIntent(none, { selected: null, focusCluster: 'g02.s01' })).toEqual({ kind: 'cluster', id: 'g02.s01' })
    expect(cameraIntent({ selected: null, focusCluster: 'g02' }, none)).toEqual({ kind: 'home' })
  })

  it('stays put when a repo is deselected in open space', () => {
    expect(cameraIntent({ selected: 4, focusCluster: null }, none)).toBeNull()
    expect(cameraIntent(none, none)).toBeNull()
  })
})
