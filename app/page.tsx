import { redirect } from 'next/navigation'

export default function Home() {
  const room = crypto.randomUUID().slice(0, 8)
  redirect(`/r/${room}`)
}
