/** True inside the desktop app's webview; false in a browser, a worker or during the build. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Where `data/` and `models/` live. The desktop app serves both through its `gs` protocol, from
 * the app data dir with the bundled copies behind it; Windows' webview reaches custom protocols
 * as `http://<scheme>.localhost/`. The web build serves them from `public/`.
 */
export function assetBase(): string {
  if (!isTauri) return import.meta.env.BASE_URL
  return /windows/i.test(navigator.userAgent) ? 'http://gs.localhost/' : 'gs://localhost/'
}
