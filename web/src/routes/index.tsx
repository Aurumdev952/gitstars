import { lazy, Suspense, useEffect } from 'react'
import { ClientOnly, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { Hud } from '#/components/hud/Hud'
import { StarMark } from '#/components/hud/TopBar'
import { GalaxyLoadError, loadGalaxy, resolveDataSource } from '#/lib/load'
import { useGalaxyStore } from '#/state/store'
import { bindNavigate, filtersFromSearch, searchDefaults, searchSchema } from '#/state/url'
import { startSearchRunner, warmModel } from '#/workers/searchClient'
import { seedDiscovery } from '#/state/commands'

// three, R3F and the post chain load in their own chunk, in parallel with galaxy.json.
const GalaxyCanvas = lazy(() => import('#/components/galaxy/GalaxyCanvas'))

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(searchDefaults)] },
  // The galaxy is fetched from static files by the browser; a server-side loader has no origin.
  ssr: false,
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
    const stop = startSearchRunner()
    // The model is a few hundred MB; fetch it once the first frames are on screen.
    const idle = requestIdleCallback(() => warmModel(), { timeout: 4000 })
    return () => {
      cancelIdleCallback(idle)
      stop()
    }
  }, [])

  useEffect(() => {
    const repo = search.repo ? galaxy.byFullName.get(search.repo.toLowerCase()) : undefined
    const focusCluster = search.cluster && galaxy.clusterById.has(search.cluster) ? search.cluster : null
    useGalaxyStore.getState().actions.mirrorUrl({
      selected: repo ?? null,
      focusCluster,
      view: search.view,
      frozen: search.freeze,
      query: search.q ?? null,
      lensQuery: search.lens ?? null,
      filters: filtersFromSearch(search),
    })
  }, [galaxy, search])

  useEffect(() => seedDiscovery(search.seed ?? null), [search.seed])

  return (
    <main className="h-full">
      <ClientOnly>
        <Suspense fallback={null}>
          <GalaxyCanvas debug={search.debug} />
        </Suspense>
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
