import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Check, FolderInput, History, LoaderCircle, Orbit, Plus, RefreshCw, Square } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import { desktop, openLinksExternally, type AppState, type LogLine, type NewStars, type RunResult, type SecretName } from '#/lib/desktop'
import { formatCount } from '#/lib/format'
import { cn } from '#/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog'

const MAX_LOG = 1500

const ADD_STEPS = [['run', '--incremental']]
const REBUILD_STEPS = [['layout'], ['name'], ['reassign'], ['name'], ['export']]
const FRESH_STEPS = [['run']]

type Busy = { label: string } | null

/** The desktop app's pipeline: install, keys, new stars, runs and their log. Rendered only under Tauri. */
export default function PipelinePanel() {
  const open = useGalaxyStore((s) => s.overlay === 'pipeline')
  const { setOverlay } = useGalaxyStore((s) => s.actions)
  const router = useRouter()
  const [app, setApp] = useState<AppState | null>(null)
  const [stars, setStars] = useState<NewStars | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<LogLine[]>([])

  const refresh = useCallback(async () => {
    const s = await desktop.appState()
    setApp(s)
    return s
  }, [])

  const checkStars = useCallback(async (s: AppState) => {
    if (!s.hasDb || !s.hasGithubToken) return setStars(null)
    setStars(await desktop.checkNewStars().catch(() => null))
  }, [])

  useEffect(() => {
    const off = desktop.onLog((l) => setLog((prev) => (prev.length >= MAX_LOG ? [...prev.slice(-MAX_LOG + 1), l] : [...prev, l])))
    const offLinks = openLinksExternally()
    void refresh().then(checkStars, (e: unknown) => setError(String(e)))
    return () => {
      void off.then((f) => f())
      offLinks()
    }
  }, [refresh, checkStars])

  /** Runs one action at a time, records its failure, and refreshes the state afterwards. */
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy({ label })
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      await refresh().catch(() => {})
    }
  }

  const reloadGalaxy = () => router.invalidate()

  const runSteps = (label: string, steps: string[][], snapshot: boolean) =>
    act(label, async () => {
      if (snapshot) await desktop.backupSnapshot()
      setLog([])
      const r = await desktop.run(steps)
      throwIfFailed(r, steps)
      await reloadGalaxy()
      const s = await refresh()
      await checkStars(s)
    })

  const install = () =>
    act('Installing the pipeline', async () => {
      setLog([])
      throwIfFailed(await desktop.setup(), [['sync']])
    })

  const importData = () =>
    act('Importing', async () => {
      const dir = await openDialog({ directory: true, defaultPath: app?.importDefault ?? undefined, title: 'The data directory that holds gitstars.db' })
      if (typeof dir !== 'string') return
      const r = await desktop.importExisting(dir)
      setLog((l) => [...l, { stream: 'app', line: `Imported ${formatCount(r.repos)} repos into ${r.db}${r.exportFrom ? `, and the export from ${r.exportFrom}` : ''}` }])
      await reloadGalaxy()
      await checkStars(await refresh())
    })

  const restore = () =>
    act('Restoring', async () => {
      await desktop.restorePrevious()
      await reloadGalaxy()
    })

  const running = busy !== null || app?.running === true
  const canRun = app !== null && app.installed && app.gpu !== null && app.hasGithubToken && app.hasOpenrouterKey && !running
  const newCount = stars?.count ?? 0

  return (
    <>
      <button
        type="button"
        aria-label={newCount > 0 ? `Pipeline, ${newCount} new stars` : 'Pipeline'}
        title="Pipeline"
        onClick={() => setOverlay('pipeline')}
        className="glass relative flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink"
      >
        {running ? <LoaderCircle className="size-4 animate-spin" /> : <Orbit className="size-4" />}
        {newCount > 0 && (
          <span className="tabular absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-starlight px-1 text-[10.5px] font-semibold text-[oklch(0.2_0.03_85)]">
            {stars?.more ? `${newCount}+` : newCount}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={(o) => setOverlay(o ? 'pipeline' : 'none')}>
        <DialogContent className="top-[8vh] flex max-h-[84vh] w-[min(640px,calc(100vw-2rem))] flex-col p-6">
          <DialogTitle className="text-[16px] font-medium text-ink">Pipeline</DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] text-ink-faint">
            Fetches your stars, summarizes and embeds them, and places them in the galaxy. Your data stays in {app?.root ?? 'the app data folder'}.
          </DialogDescription>

          <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {app && <Status app={app} running={running} onInstall={install} onImport={importData} onFresh={() => void runSteps('Building a new galaxy', FRESH_STEPS, false)} />}

            {app && (
              <Section title="Keys">
                <SecretRow name="github" label="GitHub token" set={app.hasGithubToken} hint="Reads your stars; a token with no scopes is enough." onSaved={() => void refresh().then(checkStars)} />
                <SecretRow name="openrouter" label="OpenRouter key" set={app.hasOpenrouterKey} hint="Summaries, names and the decider." onSaved={() => void refresh()} />
              </Section>
            )}

            {app?.hasDb && (
              <Section title="Galaxy">
                <div className="flex flex-wrap items-center gap-2">
                  {newCount > 0 ? (
                    <span className="text-[13px] text-ink">
                      <span className="tabular font-medium text-starlight">{stars?.more ? `${newCount}+` : newCount}</span> new {newCount === 1 ? 'star' : 'stars'}
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-muted">{stars ? 'No new stars.' : app.hasGithubToken ? 'Checking for new stars…' : 'Add a GitHub token to check for new stars.'}</span>
                  )}
                  <span className="flex-1" />
                  <Action primary disabled={!canRun} onClick={() => void runSteps('Adding new stars', ADD_STEPS, true)} icon={<Plus className="size-3.5" />}>
                    Add to galaxy
                  </Action>
                  <Confirm disabled={!canRun} onConfirm={() => void runSteps('Rebuilding the galaxy', REBUILD_STEPS, true)} icon={<RefreshCw className="size-3.5" />} confirm="Rebuild: new layout and names">
                    Rebuild galaxy
                  </Confirm>
                  {app.hasPrevious && (
                    <Confirm disabled={running} onConfirm={() => void restore()} icon={<History className="size-3.5" />} confirm="Restore the last snapshot">
                      Restore previous
                    </Confirm>
                  )}
                </div>
                {stars && stars.names.length > 0 && (
                  <p className="mt-2 truncate font-mono text-[11.5px] text-ink-faint">{stars.names.slice(0, 6).join('  ')}</p>
                )}
                <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
                  Adding keeps every star where it is and places the new ones beside their nearest neighbours. Rebuilding lays the whole galaxy out again and renames it. Both take a snapshot first.
                </p>
              </Section>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-[oklch(0.65_0.2_25/0.4)] bg-[oklch(0.65_0.2_25/0.08)] px-3 py-2 text-[12.5px] text-[oklch(0.85_0.08_25)]">
                {error}
              </p>
            )}

            {(log.length > 0 || running) && <Log lines={log} busy={busy} onCancel={() => void desktop.cancel()} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function throwIfFailed(r: RunResult, steps: string[][]) {
  if (r.cancelled) throw new Error('Cancelled.')
  if (r.code !== 0) {
    const step = r.failedStep !== null ? steps[r.failedStep]?.join(' ') : null
    throw new Error(`${step ? `gs ${step}` : 'The run'} failed${r.code !== null ? ` with exit code ${r.code}` : ''}; the log has the details.`)
  }
}

function Status({
  app,
  running,
  onInstall,
  onImport,
  onFresh,
}: {
  app: AppState
  running: boolean
  onInstall: () => void
  onImport: () => void
  onFresh: () => void
}) {
  return (
    <Section title="Setup">
      <Row label="Data" ok={app.hasDb}>
        {app.hasDb ? (
          'Imported'
        ) : (
          <>
            <span className="text-ink-faint">Showing the bundled galaxy.</span>
            <Action disabled={running} onClick={onImport} icon={<FolderInput className="size-3.5" />}>
              Import existing data
            </Action>
          </>
        )}
      </Row>
      <Row label="GPU" ok={app.gpu !== null}>
        {app.gpu ?? <span className="text-ink-faint">No NVIDIA GPU found. Embedding needs CUDA, so the pipeline is off; the galaxy still works.</span>}
      </Row>
      <Row label="Runtime" ok={app.installed}>
        {app.installed ? (
          'Installed'
        ) : (
          <>
            <span className="text-ink-faint">Downloads Python and PyTorch with CUDA, several GB.</span>
            <Action disabled={running || app.gpu === null} onClick={onInstall}>
              Install
            </Action>
          </>
        )}
      </Row>
      {!app.hasDb && app.installed && (
        <p className="text-[11.5px] leading-snug text-ink-faint">
          No data to import?{' '}
          <button
            type="button"
            disabled={running || app.gpu === null || !app.hasGithubToken || !app.hasOpenrouterKey}
            onClick={onFresh}
            className="text-starlight underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Start fresh
          </button>{' '}
          fetches every star and builds a new galaxy.
        </p>
      )}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11.5px] font-medium tracking-[0.02em] text-ink-faint">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px] text-ink-muted">
      <span className="w-[72px] shrink-0 text-ink-faint">{label}</span>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-starlight shadow-[0_0_6px_oklch(0.86_0.12_85/0.8)]' : 'bg-ink-faint/50')} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">{children}</span>
    </div>
  )
}

function Action({
  children,
  onClick,
  disabled,
  primary,
  icon,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
        primary
          ? 'bg-starlight text-[oklch(0.2_0.03_85)] hover:bg-[oklch(0.9_0.11_85)]'
          : 'border border-glass-border text-ink-muted hover:bg-white/5 hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** A second click within a few seconds confirms; anything that rewrites the galaxy goes through it. */
function Confirm({ children, confirm, onConfirm, disabled, icon }: { children: ReactNode; confirm: string; onConfirm: () => void; disabled?: boolean; icon?: ReactNode }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Action
      disabled={disabled}
      primary={armed}
      icon={armed ? <Check className="size-3.5" /> : icon}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirm : children}
    </Action>
  )
}

function SecretRow({ name, label, set, hint, onSaved }: { name: SecretName; label: string; set: boolean; hint: string; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = (v: string) => {
    setSaving(true)
    setError(null)
    desktop
      .setSecret(name, v)
      .then(() => {
        setValue('')
        onSaved()
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setSaving(false))
  }
  return (
    <div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) save(value)
        }}
      >
        <label htmlFor={`secret-${name}`} className="w-[110px] shrink-0 text-[13px] text-ink-faint">
          {label}
        </label>
        <input
          id={`secret-${name}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={set ? 'Saved in the keychain' : 'Not set'}
          className="h-8 min-w-0 flex-1 rounded-full border border-glass-border bg-white/[0.03] px-3.5 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus-visible:border-starlight/50"
        />
        <Action disabled={saving || !value.trim()} onClick={() => save(value)}>
          Save
        </Action>
        {set && (
          <button type="button" disabled={saving} onClick={() => save('')} className="text-[12px] text-ink-faint transition-colors hover:text-ink disabled:opacity-45">
            Clear
          </button>
        )}
      </form>
      <p className={cn('mt-1 pl-[118px] text-[11.5px]', error ? 'text-[oklch(0.85_0.08_25)]' : 'text-ink-faint')}>{error ?? hint}</p>
    </div>
  )
}

function Log({ lines, busy, onCancel }: { lines: LogLine[]; busy: Busy; onCancel: () => void }) {
  const ref = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])
  return (
    <Section title="Log">
      {busy && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <LoaderCircle className="size-3.5 animate-spin text-starlight" aria-hidden />
          <span className="flex-1">{busy.label}…</span>
          <Action onClick={onCancel} icon={<Square className="size-3" />}>
            Cancel
          </Action>
        </div>
      )}
      <pre
        ref={ref}
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="h-[240px] overflow-auto rounded-lg border border-glass-border bg-black/30 p-3 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-ink-muted"
      >
        {lines.map((l, i) => (
          <div key={i} className={cn(l.stream === 'app' && 'text-starlight', l.stream === 'stderr' && 'text-ink-faint')}>
            {l.line}
          </div>
        ))}
      </pre>
    </Section>
  )
}
