import { defineConfig, type Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Cross-origin isolation gives onnxruntime-web SharedArrayBuffer, so the WASM fallback runs
// multi-threaded. `credentialless` keeps the model download from the Hub working without CORP.
// A middleware rather than `server.headers`, which the Start SPA handler's HTML response skips.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

function crossOriginIsolation(): Plugin {
  // Returns nothing: a function returned from configureServer would run as a post hook.
  const use = (s: { middlewares: { use(fn: (req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => void): void } }) => {
    s.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v)
      next()
    })
  }
  return { name: 'gitstars:cross-origin-isolation', configureServer: use, configurePreviewServer: use }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000, strictPort: true },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  plugins: [crossOriginIsolation(), tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
})
