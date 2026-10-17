const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en')
const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export const formatCompact = (n: number) => compact.format(n).toLowerCase()
export const formatCount = (n: number) => whole.format(n)
export const formatMonthYear = (iso: string) => monthYear.format(new Date(iso))

const DAY = 86_400_000

/** "3d ago", "5mo ago", "4y ago" relative to `now` (the export's generatedAt, so fixtures stay stable). */
export function formatAgo(iso: string, now: number): string {
  const days = Math.max(0, (now - Date.parse(iso)) / DAY)
  if (days < 1) return 'today'
  if (days < 30) return `${Math.floor(days)}d ago`
  if (days < 365) return `${Math.floor(days / 30.44)}mo ago`
  return `${Math.floor(days / 365.25)}y ago`
}

export function splitFullName(fullName: string): [owner: string, name: string] {
  const at = fullName.indexOf('/')
  return [fullName.slice(0, at), fullName.slice(at + 1)]
}
