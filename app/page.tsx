import Image from 'next/image'
import logo from '@/public/logo_flat_bg.jpeg'
import { CreateRoomButton } from '@/components/CreateRoomButton'

export default function Home() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-8 overflow-hidden px-6">
      <Image src={logo} alt="polyglot" className="w-full max-w-md" />
      <CreateRoomButton />
    </main>
  )
}
