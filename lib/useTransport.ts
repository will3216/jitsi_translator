'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Ably from 'ably'
import type { Participant, Utterance } from './types'

export interface Transport {
  publish(u: Utterance): void
  subscribe(cb: (u: Utterance) => void): () => void
  participants: Participant[]
  connected: boolean
}

const EVENT = 'utterance'
const INTERIM_THROTTLE_MS = 150

export function useTransport(roomId: string, me: Participant): Transport {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [connected, setConnected] = useState(false)

  const channel = useRef<Ably.RealtimeChannel | null>(null)
  const subscribers = useRef(new Set<(u: Utterance) => void>())
  const lastInterimAt = useRef(0)

  // Presence payload changes when the speaker changes language; keep it in a
  // ref so that does not tear down the connection.
  const meRef = useRef(me)
  useEffect(() => {
    meRef.current = me
    channel.current?.presence.update({ name: me.name, srcLang: me.srcLang })
  }, [me])

  useEffect(() => {
    const client = new Ably.Realtime({
      authUrl: '/api/realtime-token',
      authParams: { clientId: meRef.current.id },
      clientId: meRef.current.id,
    })

    const ch = client.channels.get(`room:${roomId}`)
    channel.current = ch

    client.connection.on('connected', () => setConnected(true))
    client.connection.on('disconnected', () => setConnected(false))
    client.connection.on('failed', () => setConnected(false))

    ch.subscribe(EVENT, (message) => {
      const u = message.data as Utterance
      // Our own utterances already rendered locally on recognition.
      if (u.speakerId === meRef.current.id) return
      for (const cb of subscribers.current) cb(u)
    })

    const syncPresence = async () => {
      const members = await ch.presence.get()
      setParticipants(
        members.map((m) => ({
          id: m.clientId,
          name: (m.data as { name?: string })?.name ?? m.clientId,
          srcLang: (m.data as { srcLang?: Participant['srcLang'] })?.srcLang ?? 'en',
        })),
      )
    }

    ch.presence.subscribe(['enter', 'leave', 'update'], () => void syncPresence())
    void ch.presence
      .enter({ name: meRef.current.name, srcLang: meRef.current.srcLang })
      .then(syncPresence)

    return () => {
      ch.presence.unsubscribe()
      ch.unsubscribe()
      void ch.presence.leave()
      client.close()
      channel.current = null
      setConnected(false)
    }
  }, [roomId])

  const publish = useCallback((u: Utterance) => {
    const ch = channel.current
    if (!ch) return

    // Interim results are throttled; finals always go immediately.
    if (!u.isFinal) {
      const now = Date.now()
      if (now - lastInterimAt.current < INTERIM_THROTTLE_MS) return
      lastInterimAt.current = now
    } else {
      lastInterimAt.current = 0
    }

    void ch.publish(EVENT, u)
  }, [])

  const subscribe = useCallback((cb: (u: Utterance) => void) => {
    subscribers.current.add(cb)
    return () => {
      subscribers.current.delete(cb)
    }
  }, [])

  return { publish, subscribe, participants, connected }
}
