import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlaylist, publicPlaylist, toM3u } from '../lib/playlist.js'

test('normalizes safe HTTP playlist items', () => {
  const result = normalizePlaylist({ title: ' Night ', items: [{ title: ' One ', url: 'https://example.com/video.mp4' }] })
  assert.deepEqual(result, { title: 'Night', items: [{ title: 'One', url: 'https://example.com/video.mp4' }] })
})

test('rejects unsupported URL schemes', () => {
  assert.throws(() => normalizePlaylist({ title: 'Bad', items: [{ url: 'file:///etc/passwd' }] }), /HTTP or HTTPS/)
})

test('renders extended M3U without exposing edit hash', () => {
  const record = { id: 'abcdefgh', title: 'Night', items: [{ title: 'One', url: 'https://example.com/1.mp4' }], editTokenHash: 'secret' }
  assert.equal(toM3u(record), '#EXTM3U\n#PLAYLIST:Night\n#EXTINF:-1,One\nhttps://example.com/1.mp4\n')
  assert.equal('editTokenHash' in publicPlaylist(record), false)
})