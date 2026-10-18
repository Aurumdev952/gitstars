import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { converter, parse, wcagContrast, type Rgb } from 'culori'
import { describe, expect, it } from 'vitest'

// Reads the real tokens from app.css, so a token edit that breaks contrast fails here.
const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')
const token = (name: string) => {
  const m = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`no --color-${name} in app.css`)
  return m[1]!.trim()
}
const utilityBackground = (name: string) => {
  const m = css.match(new RegExp(`@utility ${name} \\{\\s*background: ([^;]+);`))
  if (!m) throw new Error(`no @utility ${name} background`)
  return m[1]!.replace(/var\(--color-([\w-]+)\)/, (_, t: string) => token(t)).trim()
}

const rgb = converter('rgb')
/** `fg` (which may carry its own alpha) composited over the opaque `bg`. */
function over(fg: string, bg: Rgb): Rgb {
  const a = rgb(parse(fg))!
  const k = a.alpha ?? 1
  return { mode: 'rgb', r: a.r * k + bg.r * (1 - k), g: a.g * k + bg.g * (1 - k), b: a.b * k + bg.b * (1 - k) }
}

// What a panel can sit on: empty space, and the brightest blurred nebula behind the HUD in
// screenshots of the real export (the backdrop blur averages star points away).
const BACKDROPS = { void: 'oklch(0.12 0.02 275)', nebula: 'oklch(0.34 0.06 300)' }
const TEXT = ['ink', 'ink-muted', 'ink-faint'] as const

describe('glass panel contrast', () => {
  for (const glass of ['glass', 'glass-strong']) {
    for (const [where, back] of Object.entries(BACKDROPS)) {
      it(`${glass} over ${where} keeps every text token at 4.5:1 or more`, () => {
        const bg = over(utilityBackground(glass), rgb(parse(back))!)
        for (const t of TEXT) expect(wcagContrast(token(t), bg), `${t} on ${glass}/${where}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
