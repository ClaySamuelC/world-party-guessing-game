import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Dataset } from '../data/load'
import { joinPeerRoom, selfId, type PeerRoom } from '../net/room'
import { canAnswer, initialRoomState, roomReducer } from './client'
import { MatchHost, type HostTransport } from './host'
import { HOST_MESSAGE_TYPES, type GuestMessage, type HostMessage } from './protocol'
import type { Answer, MatchSettings } from './questions'

export type Role = 'host' | 'guest' | 'solo'

export interface SessionConfig {
  role: Role
  /** Room code; null for solo. */
  code: string | null
  name: string
}

export interface HostActions {
  start(): void
  updateSettings(patch: Partial<MatchSettings>): void
  backToLobby(): void
  /** After a solo reveal, go to the next question without waiting. */
  advance(): void
  /** Stop an endless (or any) match and show scores. */
  endMatch(): void
}

const flagLoaders = import.meta.glob('/node_modules/flag-icons/flags/4x3/*.svg', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>

async function loadFlagSvg(iso2: string): Promise<string | null> {
  const loader = flagLoaders[`/node_modules/flag-icons/flags/4x3/${iso2.toLowerCase()}.svg`]
  return loader ? loader() : null
}

const NOOP_TRANSPORT: HostTransport = { broadcast() {}, sendTo() {} }

/**
 * Wires a session together: the P2P room (if any), the authoritative host engine
 * (if we are hosting), and the reducer that builds what this screen shows.
 */
export function useSession(config: SessionConfig, dataset: Dataset) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState)
  const [peerCount, setPeerCount] = useState(0)
  const hostRef = useRef<MatchHost | null>(null)
  const roomRef = useRef<PeerRoom | null>(null)
  const hostIdRef = useRef<string | null>(null)
  useEffect(() => {
    hostIdRef.current = state.hostId
  }, [state.hostId])

  useEffect(() => {
    dispatch({ kind: 'reset' })
    const isHost = config.role !== 'guest'
    const room = config.role === 'solo' || !config.code ? null : joinPeerRoom(config.code)
    roomRef.current = room

    const transport: HostTransport = room
      ? { broadcast: (msg) => room.send(msg), sendTo: (id, msg) => room.send(msg, id) }
      : NOOP_TRANSPORT

    let host: MatchHost | null = null
    if (isHost) {
      host = new MatchHost({
        selfId,
        selfName: config.name,
        transport,
        packInputs: { countries: dataset.countryList, places: dataset.places, languages: dataset.languages, history: dataset.history, landmarks: dataset.landmarks, exports: dataset.exports, geojson: dataset.geojson, loadFlagSvg },
        onLocal: (msg, from) => dispatch({ kind: 'host', msg, from }),
      })
      hostRef.current = host
      host.updateSettings({}) // emits the initial roster so we land in the lobby
    }

    if (room) {
      room.onMessage((msg, from) => {
        if (HOST_MESSAGE_TYPES.has(msg.t)) {
          if (!isHost) dispatch({ kind: 'host', msg: msg as HostMessage, from })
        } else if (host) host.handlePeerMessage(from, msg as GuestMessage)
      })
      room.onPeerJoin((peerId) => {
        setPeerCount(room.peers().length)
        if (!isHost) room.send({ t: 'hello', name: config.name }, peerId)
      })
      room.onPeerLeave((peerId) => {
        setPeerCount(room.peers().length)
        if (host) host.handlePeerLeave(peerId)
        else if (peerId === hostIdRef.current) dispatch({ kind: 'host-left' })
      })
    }

    return () => {
      host?.destroy()
      hostRef.current = null
      room?.leave()
      roomRef.current = null
    }
  }, [config.role, config.code, config.name, dataset])

  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const submitAnswer = useCallback((answer: Answer) => {
    const s = stateRef.current
    const q = s.question
    if (!q || !canAnswer(s, selfId, answer)) return
    dispatch({ kind: 'local-answer', answer })
    if (hostRef.current) hostRef.current.submitLocalAnswer(answer)
    else if (roomRef.current && s.hostId) roomRef.current.send({ t: 'answer', questionId: q.q.id, answer }, s.hostId)
  }, [])

  const hostActions = useMemo<HostActions | null>(
    () =>
      config.role === 'guest'
        ? null
        : {
            start: () => void hostRef.current?.start(),
            updateSettings: (patch) => hostRef.current?.updateSettings(patch),
            backToLobby: () => hostRef.current?.backToLobby(),
            advance: () => hostRef.current?.advance(),
            endMatch: () => hostRef.current?.endMatch(),
          },
    [config.role],
  )

  return { state, selfId, isHost: config.role !== 'guest', peerCount, submitAnswer, hostActions }
}
