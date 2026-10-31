import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashToken, makeEditToken, makeId, normalizePlaylist, publicPlaylist, toM3u } from './lib/playlist.js'

const app = express()
const root = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 8791)
const host = process.env.HOST || '127.0.0.1'
const dataDir = path.resolve(process.env.PLAYLIST_DATA_DIR || path.join(root, 'data'))
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '')

app.set('trust proxy', 1)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } }
}))
app.use(express.json({ limit: '256kb' }))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }))

function recordPath(id) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) throw Object.assign(new Error('Playlist not found'), { status: 404 })
  return path.join(dataDir, `${id}.json`)
}

async function loadRecord(id) {
  try { return JSON.parse(await readFile(recordPath(id), 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT' || error?.status === 404) throw Object.assign(new Error('Playlist not found'), { status: 404 })
    throw error
  }
}

async function saveRecord(record) {
  await mkdir(dataDir, { recursive: true })
  const target = recordPath(record.id)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

function linksFor(id) {
  return { web: `${publicBaseUrl}/p/${id}`, m3u: `${publicBaseUrl}/p/${id}.m3u`, json: `${publicBaseUrl}/p/${id}.json`, next: `${publicBaseUrl}/p/${id}/next/0` }
}

app.post('/api/playlists', async (req, res, next) => {
  try {
    const normalized = normalizePlaylist(req.body)
    const id = makeId()
    const editToken = makeEditToken()
    const record = { id, ...normalized, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), editTokenHash: hashToken(editToken) }
    await saveRecord(record)
    res.status(201).json({ playlist: publicPlaylist(record), editToken, links: linksFor(id) })
  } catch (error) { next(error) }
})

app.get('/api/playlists/:id', async (req, res, next) => {
  try { res.set('Access-Control-Allow-Origin', '*').json(publicPlaylist(await loadRecord(req.params.id))) }
  catch (error) { next(error) }
})

app.put('/api/playlists/:id', async (req, res, next) => {
  try {
    const record = await loadRecord(req.params.id)
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token || hashToken(token) !== record.editTokenHash) return res.status(403).json({ error: 'Invalid edit token' })
    const updated = { ...record, ...normalizePlaylist(req.body), updatedAt: new Date().toISOString() }
    await saveRecord(updated)
    res.json({ playlist: publicPlaylist(updated), links: linksFor(updated.id) })
  } catch (error) { next(error) }
})

app.get(/^\/p\/([A-Za-z0-9_-]{8,32})\.m3u$/, async (req, res, next) => {
  try {
    const playlist = await loadRecord(req.params[0])
    res.set({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Content-Disposition': `inline; filename="${playlist.id}.m3u"`, 'Cache-Control': 'public, max-age=60' }).send(toM3u(playlist))
  } catch (error) { next(error) }
})

app.get(/^\/p\/([A-Za-z0-9_-]{8,32})\.json$/, async (req, res, next) => {
  try { res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }).json(publicPlaylist(await loadRecord(req.params[0]))) }
  catch (error) { next(error) }
})

app.get('/p/:id/next/:index', async (req, res, next) => {
  try {
    const playlist = await loadRecord(req.params.id)
    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index >= playlist.items.length) return res.status(404).json({ error: 'Playlist item not found' })
    res.redirect(302, playlist.items[index].url)
  } catch (error) { next(error) }
})

app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', etag: true }))
app.get(['/p/:id', '*'], (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
app.use((error, _req, res, _next) => res.status(error?.status || 400).json({ error: String(error?.message || 'Request failed') }))

app.listen(port, host, () => console.log(`Queuecast listening on http://${host}:${port}`))