import { useEffect } from 'react'
import { ClientOnly, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { GalaxyCanvas } from '#/components/galaxy/GalaxyCanvas'
import { Hud } from '#/components/hud/Hud'
import { StarMark } from '#/components/hud/TopBar'
import { GalaxyLoadError, loadGalaxy, resolveDataSource } from '#/lib/load'
import { useGalaxyStore } from '#/state/store'
import { bindNavigate, searchDefaults, searchSchema } from '#/state/url'

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(searchDefaults)] },
  loaderDeps: ({ search }) => ({ data: search.data }),
  loader: ({ deps }) => {
    const source = resolveDataSource(deps.data ?? import.meta.env.VITE_DATA)
    return loadGalaxy(source).then((galaxy) => ({ galaxy, dataName: source.name }))
  },
  staleTime: Infinity,
  pendingComponent: Pending,
  errorComponent: LoadFailed,
  component: Home,
})

function Home() {
  const { galaxy, dataName } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })

  useEffect(() => {
    bindNavigate(({ search: next, replace }) => void navigate({ search: next, replace }))
  }, [navigate])

  useEffect(() => {
    useGalaxyStore.getState().actions.setGalaxy(galaxy)
  }, [galaxy])

  useEffect(() => {
    const repo = search.repo ? galaxy.byFullName.get(search.repo.toLowerCase()) : undefined
    const focusCluster = search.cluster && galaxy.clusterById.has(search.cluster) ? search.cluster : null
    useGalaxyStore.getState().actions.mirrorUrl({
      selected: repo ?? null,
      focusCluster,
      view: search.view,
      frozen: search.freeze,
    })
  }, [galaxy, search.repo, search.cluster, search.view, search.freeze])

  return (
    <main className="h-full">
      <ClientOnly>
        <GalaxyCanvas debug={search.debug} />
      </ClientOnly>
      <Hud dataName={dataName} />
    </main>
  )
}

function Pending() {
  return (
    <main className="grid h-full place-items-center">
      <StarMark className="size-6 animate-pulse text-starlight" />
    </main>
  )
}

function LoadFailed({ error }: { error: unknown }) {
  const missing = error instanceof GalaxyLoadError && /returned 404/.test(error.message)
  return (
    <main className="grid h-full place-items-center px-6">
      <div className="glass max-w-md rounded-[var(--radius-panel)] p-6">
        <h1 className="flex items-center gap-2 text-lg font-medium">
          <StarMark className="size-4 text-starlight" />
          {missing ? 'No galaxy exported yet' : 'The galaxy failed to load'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {missing ? (
            <>
              Run <code className="font-mono text-ink">gs export</code> to write{' '}
              <code className="font-mono text-ink">public/data/galaxy.json</code>, or open the{' '}
              <a className="text-starlight underline-offset-2 hover:underline" href="/?data=fixture">
                synthetic fixture
              </a>
              .
            </>
          ) : (
            String(error instanceof Error ? error.message : error)
          )}
        </p>
      </div>
    </main>
  )
}
