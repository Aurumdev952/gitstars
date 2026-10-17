import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return <main className="grid h-full place-items-center text-ink-muted">gitstars</main>
}
