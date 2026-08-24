'use client'

import { useRouter } from 'next/navigation'

export function CreateRoomButton() {
  const router = useRouter()

  return (
    <button
      className="rounded border border-white/20 px-3 py-2 text-sm"
      onClick={() => {
        // Minted on click, not on page load: the old app/page.tsx redirected
        // (and so created a room) on every visit to "/", even an idle one.
        // Waiting for a click means opening the homepage no longer conjures
        // a room — one only exists once someone actually asks for it.
        const room = crypto.randomUUID().slice(0, 8)
        router.push(`/r/${room}`)
      }}
    >
      Start a room
    </button>
  )
}
