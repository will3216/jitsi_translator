import Room from './Room'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>
}) {
  const { room } = await params
  return <Room roomId={room} />
}
