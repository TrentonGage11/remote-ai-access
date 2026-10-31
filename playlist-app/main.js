import './style.css'

const app = document.querySelector('#app')
const playlistMatch = location.pathname.match(/^\/p\/([A-Za-z0-9_-]{8,32})$/)

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function copyText(value, button) {
  navigator.clipboard.writeText(value).then(() => {
    const previous = button.textContent
    button.textContent = 'Copied'
    setTimeout(() => { button.textContent = previous }, 1200)
  })
}

function parseLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf(' | ')
    if (separator > 0) return { title: line.slice(0, separator).trim(), url: line.slice(separator + 3).trim() }
    return { title: '', url: line }
  })
}

function renderEditor() {
  app.innerHTML = `
    <main class="shell">
      <header class="masthead">
        <a class="brand" href="/" aria-label="Queuecast home"><span class="brand-mark">Q</span><span>QUEUECAST</span></a>
        <div class="signal"><i></i> PLAYLIST PUBLISHER</div>
      </header>
      <section class="workbench">
        <div class="intro">
          <p class="eyebrow">LINKS IN. ONE QUEUE OUT.</p>
          <h1>Build a playlist<br>that travels.</h1>
          <p class="lede">Paste video or audio links, publish once, then use the format your player understands.</p>
        </div>
        <form id="playlistForm" class="editor-panel">
          <label for="title">Playlist name</label>
          <input id="title" name="title" maxlength="100" placeholder="Friday night cinema" required />
          <div class="label-row"><label for="links">Links</label><span id="lineCount">0 items</span></div>
          <textarea id="links" name="links" rows="12" spellcheck="false" placeholder="https://youtube.com/watch?v=...&#10;Episode two | https://example.com/video.mp4" required></textarea>
          <p class="field-note">One URL per line. Optional titles use <code>Title | URL</code>.</p>
          <button class="primary" type="submit">Publish playlist <span aria-hidden="true">→</span></button>
          <p id="status" class="status" role="status" aria-live="polite"></p>
        </form>
      </section>
      <section id="result" class="result-band" hidden></section>
      <section class="compat-band">
        <div><strong>M3U</strong><span>VLC, mpv, Kodi, compatible importers</span></div>
        <div><strong>JSON</strong><span>World scripts and custom integrations</span></div>
        <div><strong>WEB</strong><span>Share, inspect, and open each item</span></div>
      </section>
      <aside class="vr-note"><strong>VRChat note</strong><span>Custom domains require “Allow Untrusted URLs.” YTS, Popcorn Palace, or another world must explicitly support M3U/JSON playlist imports; a normal video URL field only plays one media URL.</span></aside>
    </main>`

  const form = document.querySelector('#playlistForm')
  const links = document.querySelector('#links')
  const status = document.querySelector('#status')
  const result = document.querySelector('#result')
  const lineCount = document.querySelector('#lineCount')
  links.addEventListener('input', () => { lineCount.textContent = `${parseLines(links.value).length} items` })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    status.textContent = 'Publishing…'
    const submit = form.querySelector('button[type="submit"]')
    submit.disabled = true
    try {
      const data = await requestJson('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title.value, items: parseLines(links.value) }) })
      localStorage.setItem(`queuecast-edit-${data.playlist.id}`, data.editToken)
      result.hidden = false
      result.innerHTML = `<div class="result-head"><div><span>Published</span><h2>${escapeHtml(data.playlist.title)}</h2></div><a href="${data.links.web}">Open playlist →</a></div><div class="link-grid">${Object.entries(data.links).map(([name, url]) => `<div class="link-row"><span>${name.toUpperCase()}</span><input value="${escapeHtml(url)}" readonly /><button type="button" data-copy="${escapeHtml(url)}">Copy</button></div>`).join('')}</div>`
      result.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy, button)))
      result.scrollIntoView({ behavior: 'smooth', block: 'start' })
      status.textContent = `${data.playlist.items.length} items published.`
    } catch (error) { status.textContent = error.message }
    finally { submit.disabled = false }
  })
}

async function renderPlaylist(id) {
  app.innerHTML = '<main class="loading">Loading playlist…</main>'
  try {
    const playlist = await requestJson(`/api/playlists/${id}`)
    const first = playlist.items[0]
    app.innerHTML = `
      <main class="share-shell">
        <header class="masthead"><a class="brand" href="/"><span class="brand-mark">Q</span><span>QUEUECAST</span></a><span class="sequence">${String(playlist.items.length).padStart(2, '0')} ITEMS</span></header>
        <section class="share-title"><p class="eyebrow">PUBLIC PLAYLIST</p><h1>${escapeHtml(playlist.title)}</h1><p>Published ${new Date(playlist.createdAt).toLocaleDateString()}</p></section>
        <section class="now-playing"><span>START HERE</span><h2>${escapeHtml(first.title || 'Untitled item')}</h2><a href="${escapeHtml(first.url)}" target="_blank" rel="noopener">Open first link →</a></section>
        <ol class="track-list">${playlist.items.map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(item.title || `Item ${index + 1}`)}</strong><small>${escapeHtml(new URL(item.url).hostname)}</small></div><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" aria-label="Open item ${index + 1}">↗</a></li>`).join('')}</ol>
        <section class="format-strip"><a href="/p/${id}.m3u">M3U</a><a href="/p/${id}.json">JSON</a><button id="copyShare">Copy link</button></section>
        <aside class="vr-note"><strong>VRChat note</strong><span>Enable “Allow Untrusted URLs.” The world must support the selected playlist format.</span></aside>
      </main>`
    document.querySelector('#copyShare').addEventListener('click', (event) => copyText(location.href, event.currentTarget))
  } catch (error) {
    app.innerHTML = `<main class="loading"><strong>Playlist unavailable</strong><span>${escapeHtml(error.message)}</span><a href="/">Create a playlist</a></main>`
  }
}

if (playlistMatch) renderPlaylist(playlistMatch[1])
else renderEditor()
