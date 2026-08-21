'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Ably from 'ably'
import type { Participant, Utterance } from './types'
import { languageByCode } from './languages'

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
    channel.current?.presence
      .update({ name: me.name, srcLang: me.srcLang })
      .catch(() => {})
  }, [me])

  useEffect(() => {
    let cancelled = false

    const client = new Ably.Realtime({
      authUrl: '/api/realtime-token',
      authParams: { clientId: meRef.current.id },
      clientId: meRef.current.id,
    })

    const ch = client.channels.get(`room:${roomId}`)
    channel.current = ch

    const onConnected = () => setConnected(true)
    const onDisconnected = () => setConnected(false)
    const onFailed = () => setConnected(false)
    const onClosed = () => setConnected(false)
    client.connection.on('connected', onConnected)
    client.connection.on('disconnected', onDisconnected)
    client.connection.on('failed', onFailed)
    client.connection.on('closed', onClosed)

    ch.subscribe(EVENT, (message) => {
      const u = message.data as Utterance
      // Our own utterances already rendered locally on recognition.
      if (u.speakerId === meRef.current.id) return
      for (const cb of subscribers.current) cb(u)
    })

    const syncPresence = async () => {
      const members = await ch.presence.get()
      if (cancelled) return
      const byClientId = new Map<string, Participant>()
      for (const m of members) {
        const data = m.data as { name?: string; srcLang?: string } | undefined
        byClientId.set(m.clientId, {
          id: m.clientId,
          name: data?.name ?? m.clientId,
          srcLang: languageByCode(data?.srcLang ?? '')?.code ?? 'en',
        })
      }
      setParticipants(Array.from(byClientId.values()))
    }

    ch.presence.subscribe(['enter', 'leave', 'update'], () => {
      syncPresence().catch(() => {})
    })
    ch.presence
      .enter({ name: meRef.current.name, srcLang: meRef.current.srcLang })
      .then(syncPresence)
      .catch(() => {
        if (!cancelled) setConnected(false)
      })

    const handlePageHide = () => {
      client.close()
    }
    window.addEventListener('pagehide', handlePageHide)

    // bfcache restore does not re-run this effect; a page that comes back
    // with the connection already closed must reconnect, or the UI would
    // otherwise keep showing the last-known `connected: true`.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) client.connection.connect()
    }
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      cancelled = true
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      client.connection.off('connected', onConnected)
      client.connection.off('disconnected', onDisconnected)
      client.connection.off('failed', onFailed)
      client.connection.off('closed', onClosed)
      ch.presence.unsubscribe()
      ch.unsubscribe()
      ch.presence.leave().catch(() => {})
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

    ch.publish(EVENT, u).catch(() => {})
  }, [])

  const subscribe = useCallback((cb: (u: Utterance) => void) => {
    subscribers.current.add(cb)
    return () => {
      subscribers.current.delete(cb)
    }
  }, [])

  return useMemo(
    () => ({ publish, subscribe, participants, connected }),
    [publish, subscribe, participants, connected],
  )
}
