import Room from './Room'

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ room: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { room } = await params
  const query = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  return <Room roomId={room} speakParam={first(query.speak)} showParam={first(query.show)} />
}
