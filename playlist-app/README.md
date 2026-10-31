# Queuecast

Queuecast publishes user-supplied HTTP(S) media links as a browser share page, Extended M3U, JSON, and indexed redirect endpoints. It stores playlist metadata only and never fetches or proxies submitted media.

## Development

```powershell
npm install
npm run build
npm test
$env:PUBLIC_BASE_URL="http://localhost:8791"
npm start
```

Production variables: `HOST`, `PORT`, `PUBLIC_BASE_URL`, and `PLAYLIST_DATA_DIR`.

## Compatibility

Extended M3U is suitable for VLC, mpv, Kodi, and applications that explicitly import M3U playlists. JSON and `/next/:index` are integration endpoints. VRChat's ordinary video URL fields do not universally import playlists; a world must implement an importer, and users must enable Allow Untrusted URLs for this domain.