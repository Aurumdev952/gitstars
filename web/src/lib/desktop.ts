// The desktop app's Rust commands and events (web/src-tauri/src). Import only under `isTauri`.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { assetBase } from './platform'

export type AppState = {
  root: string
  hasDb: boolean
  hasExport: boolean
  hasPrevious: boolean
  installed: boolean
  gpu: string | null
  hasGithubToken: boolean
  hasOpenrouterKey: boolean
  running: boolean
  importDefault: string | null
}

export type NewStars = { count: number; more: boolean; names: string[]; totalStarred: number; inGalaxy: number }
export type ImportReport = { db: string; repos: number; exportFrom: string | null }
export type RunResult = { code: number | null; cancelled: boolean; failedStep: number | null }
export type LogLine = { stream: 'stdout' | 'stderr' | 'app'; line: string }
export type SecretName = 'github' | 'openrouter'

export const desktop = {
  appState: () => invoke<AppState>('app_state'),
  importExisting: (sourceDir: string) => invoke<ImportReport>('import_existing', { sourceDir }),
  checkNewStars: () => invoke<NewStars | null>('check_new_stars'),
  backupSnapshot: () => invoke<void>('backup_snapshot'),
  restorePrevious: () => invoke<void>('restore_previous'),
  setup: () => invoke<RunResult>('pipeline_setup'),
  /** Runs `gs <step…>` for each step, stopping at the first failure. */
  run: (steps: string[][]) => invoke<RunResult>('pipeline_run', { steps }),
  cancel: () => invoke<void>('pipeline_cancel'),
  setSecret: (name: SecretName, value: string) => invoke<void>('secret_set', { name, value }),
  onLog: (fn: (l: LogLine) => void): Promise<UnlistenFn> => listen<LogLine>('pipeline://log', (e) => fn(e.payload)),
}

/**
 * Makes sure the search model is in the app data dir before the worker loads it, downloading it
 * with progress on first use. The worker then finds it through `gs://` like a vendored model.
 * Returns false, without downloading, when it is missing and `download` is off.
 */
export async function ensureModel(
  model: string,
  files: string[],
  download: boolean,
  onProgress: (loaded: number, total: number) => void,
): Promise<boolean> {
  const res = await fetch(`${assetBase()}models/${model}/config.json`).catch(() => null)
  if (res?.ok && (await res.json().then(() => true, () => false))) return true
  if (!download) return false
  const off = await listen<{ loaded: number; total: number }>('model://progress', (e) => onProgress(e.payload.loaded, e.payload.total))
  try {
    await invoke<number>('model_fetch', { model, files })
    return true
  } finally {
    off()
  }
}

/** Repo links open in the system browser; the webview has no tabs to open them in. */
export function openLinksExternally(): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || !/^https?:/.test(a.href) || new URL(a.href).origin === location.origin) return
    e.preventDefault()
    void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(a.href))
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
