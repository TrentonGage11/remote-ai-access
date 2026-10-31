import { createHash, randomBytes } from 'node:crypto'

export const MAX_ITEMS = 200

export function normalizePlaylist(input) {
  const title = String(input?.title || '').trim().slice(0, 100)
  if (!title) throw new Error('Playlist name is required')
  if (!Array.isArray(input?.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) throw new Error(`Playlist must contain 1-${MAX_ITEMS} items`)
  const items = input.items.map((item, index) => {
    const rawUrl = String(item?.url || '').trim()
    let parsed
    try { parsed = new URL(rawUrl) } catch { throw new Error(`Item ${index + 1} has an invalid URL`) }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Item ${index + 1} must use HTTP or HTTPS`)
    if (rawUrl.length > 2048) throw new Error(`Item ${index + 1} URL is too long`)
    return { title: String(item?.title || '').trim().slice(0, 120), url: parsed.href }
  })
  return { title, items }
}

export function makeId() { return randomBytes(8).toString('base64url') }
export function makeEditToken() { return randomBytes(24).toString('base64url') }
export function hashToken(token) { return createHash('sha256').update(String(token || '')).digest('hex') }

export function toM3u(playlist) {
  const lines = ['#EXTM3U', `#PLAYLIST:${playlist.title}`]
  playlist.items.forEach((item, index) => { lines.push(`#EXTINF:-1,${item.title || `Item ${index + 1}`}`); lines.push(item.url) })
  return `${lines.join('\n')}\n`
}

export function publicPlaylist(record) {
  const { editTokenHash, ...playlist } = record
  return playlist
}