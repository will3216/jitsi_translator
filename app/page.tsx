import { redirect } from 'next/navigation'

export default function Home() {
  const room = Math.random().toString(36).slice(2, 8)
  redirect(`/r/${room}`)
}
