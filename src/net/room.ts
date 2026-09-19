import { joinRoom, selfId, type JsonValue } from 'trystero'
import type { Message } from '../game/protocol'

export const APP_ID = 'world-party-guessing-game'
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeRoomCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('')
}

export function normalizeRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export { selfId }

export interface PeerRoom {
  send(msg: Message, target?: string): void
  onMessage(cb: (msg: Message, from: string) => void): void
  onPeerJoin(cb: (peerId: string) => void): void
  onPeerLeave(cb: (peerId: string) => void): void
  peers(): string[]
  leave(): void
}

/**
 * Joins a Trystero room. Signaling goes over public Nostr relays; once peers are
 * connected, all game traffic is WebRTC data channels between browsers.
 */
export function joinPeerRoom(code: string): PeerRoom {
  const room = joinRoom(
    { appId: APP_ID, rtcConfig: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] } },
    `room-${code}`,
  )
  const action = room.makeAction<JsonValue>('msg')
  return {
    send(msg, target) {
      void action.send(msg as unknown as JsonValue, target ? { target } : undefined).catch(() => {})
    },
    onMessage(cb) {
      action.onMessage = (data, { peerId }) => {
        if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.t === 'string') cb(data as unknown as Message, peerId)
      }
    },
    onPeerJoin(cb) {
      room.onPeerJoin = cb
    },
    onPeerLeave(cb) {
      room.onPeerLeave = cb
    },
    peers: () => Object.keys(room.getPeers()),
    leave: () => void room.leave(),
  }
}
