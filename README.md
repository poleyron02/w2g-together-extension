# w2g-together-extension

Extension repo for the [w2g-discord](https://github.com/poleyron02/w2g-discord) watch party Activity. It works like Tachiyomi's extension repos: add this repo in the app, install a source, and browse it from the **Browse** sheet.

## Add this repo

In the Activity, the host opens **Browse → Extensions** and pastes any of:

- `github.com/poleyron02/w2g-together-extension`
- `poleyron02/w2g-together-extension`
- `https://raw.githubusercontent.com/poleyron02/w2g-together-extension/main/index.json`

Repos and installed extensions are shared by everyone in the same Discord server.

## Extensions

| Id | Source | Content |
| --- | --- | --- |
| `archive-org` | Internet Archive | Public-domain feature films, silent films, classic TV |
| `kisskh` | kisskh.ovh | Asian dramas and movies with encrypted subtitles (needs an app build with subtitle `cipher` support) |

`kisskh` tries `kisskh.ovh`, then the `kisskh.id` and `kisskh.la` mirrors (same backend), skipping any domain whose Cloudflare blocks the app server and remembering the one that worked. It signs its API calls with values from the site's web build (`APP` at the top of `extensions/kisskh.js`). If episodes start failing with 403, refresh those from the site's JS bundle and bump the version.

## Repo layout

```
index.json            Repo manifest (the app reads this)
extensions/*.js       One file per extension
scripts/index.mjs     Validates index.json and pins sha256 hashes
test/                 node:test suite that runs each extension with a mocked http
```

## `index.json`

```json
{
  "schema": 1,
  "name": "My Repo",
  "extensions": [
    {
      "id": "my-source",
      "name": "My Source",
      "version": "1.0.0",
      "file": "extensions/my-source.js",
      "hosts": ["example.com"],
      "lang": "en",
      "icon": "icons/my-source.png",
      "nsfw": false,
      "sha256": "…written by npm run index…"
    }
  ]
}
```

- `id`: lowercase letters, digits, `.`, `_`, `-`. It must be unique across every repo a server adds.
- `version`: numeric (`1`, `1.2`, `1.2.3`). Raising it makes the app show **Update**.
- `hosts`: the only sites the extension may request. `example.com` also allows subdomains; `*.example.com` allows only subdomains.
- `file` and `icon`: paths relative to `index.json`.
- `sha256`: the app refuses to install a file that doesn't match it. Run `npm run index` after every edit.

## Writing an extension

Each file is a plain script (no `import` or `export`) that calls `registerExtension` once:

```js
registerExtension({
  // Browse page. Return { items, hasNextPage }.
  async popular(page) {},

  // Search results, same shape as popular.
  async search(query, page) {},

  // Episodes for an item id. Movies return a single episode.
  async episodes(itemId) {},

  // Playable streams for an episode id.
  async streams(episodeId) {},
})
```

Return shapes:

```ts
type Item = { id: string; title: string; poster?: string; year?: number; description?: string; kind?: 'movie' | 'series' }
type Episode = { id: string; title: string; number?: number; season?: number }
type Stream = {
  url: string                 // direct https MP4 or HLS (.m3u8)
  type?: 'mp4' | 'hls'        // detected from the URL when omitted
  quality?: string            // shown in the stream picker when there are several
  subtitles?: Subtitle[]
}
type Subtitle = {
  url: string                 // SRT or WebVTT
  label: string
  language?: string
  // For files whose cue text lines are base64 AES-CBC ciphertext (timings in the clear).
  // Key (16/24/32 chars) and IV (16 chars) are UTF-8 strings. Each viewer decrypts locally.
  cipher?: { algorithm: 'aes-cbc'; key: string; iv: string }
}
```

### Sandbox

Extensions run in a Web Worker in the host's browser, with `fetch`, `XMLHttpRequest`, `WebSocket`, storage APIs, and `importScripts` removed. The globals you do get:

- `http.get(url, { headers })` and `http.post(url, body, { headers })` resolve to `{ status, ok, url, body, contentType, text(), json() }`. Requests go through the app's server, so CORS doesn't matter, but only hosts listed in `hosts` are allowed. Responses are capped at 4 MB, and only the `accept`, `accept-language`, `content-type`, `origin`, `referer`, `user-agent`, and `x-requested-with` headers are forwarded.
- `log(...args)` writes to the host's browser console.
- Standard non-network worker APIs such as `crypto.subtle`, `TextEncoder`, `URL`, and `URLSearchParams`.

Workers have no `DOMParser`, so parse HTML with regular expressions, or bundle a small parser into your file.

### Limitations

- Each viewer loads the stream URL in their own player. Streams that need cookies, a `Referer` header, or DRM won't play.
- Stream URLs must be reachable by every viewer, so short-lived tokens tied to one IP address won't work.

## Develop

```bash
npm test         # runs every extension against mocked responses
npm run index    # validate + update sha256 in index.json
```

## Content policy

Only add sources you have the right to stream to your server, such as public-domain, Creative Commons, or your own media. Discord prohibits sharing unauthorized copyrighted content.
