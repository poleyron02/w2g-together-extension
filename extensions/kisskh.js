// KissKH — Asian dramas and movies (kisskh.ovh and its mirrors).
// Runs inside the Watch Party extension sandbox: `http`, `log`, and
// `registerExtension` are provided; fetch/XHR are not available.
//
// The site signs episode and subtitle requests with a `kkey` token. It is
// AES-128-CBC over a pipe-joined string of the episode id and the web app's
// build constants below. When the site ships a new build, refresh these from
// its JS bundle (search for `appVer`, `viGuid`, `subGuid`, `platformVer`).

// Mirrors of the same backend (same ids and kkey). Each domain has its own
// Cloudflare settings, so one may accept the app server when another blocks it.
const MIRRORS = ['https://kisskh.ovh', 'https://kisskh.id', 'https://kisskh.la']
const PAGE_SIZE = 40
let preferredMirror = 0

const APP = {
  name: 'kisskh',
  version: '2.8.10',
  platformVersion: 4830201,
  videoGuid: '62f176f3bb1b5b8e70e39932ad34a0c7',
  subtitleGuid: 'VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp',
}

// First round key and IV of the site's hardcoded AES-128 schedule.
const KKEY_KEY = hexBytes('4f6bdaa39e2f8cb07f5e722d9edef314')
const KKEY_IV = hexBytes('01504af356e619cf2e42bba68c3f70f9')
const KKEY_SALT = 'mg3c3b04ba'

// Cue text is AES-CBC encrypted per line; the key depends on the file extension.
const SUBTITLE_CIPHERS = {
  txt: { algorithm: 'aes-cbc', key: '8056483646328763', iv: '6852612370185273' },
  txt1: { algorithm: 'aes-cbc', key: 'AmSmZVcH93UQUezi', iv: 'ReBKWW8cqdjPEnF6' },
  other: { algorithm: 'aes-cbc', key: 'sWODXX04QRTkHdlZ', iv: '8pwhapJeC4hrS9hO' },
}

// Requests are relayed from the app's server. Cloudflare in front of the site
// rejects cloud IPs that present Node's default user agent.
const BASE_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Java-style String.hashCode, matching the site's int32 overflow behaviour. */
function hashCode(value) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash << 5) - hash + value.charCodeAt(i)
  return hash
}

async function kkey(episodeId, guid) {
  const name = APP.name
  const parts = [
    '',
    episodeId,
    null,
    KKEY_SALT,
    APP.version,
    guid,
    APP.platformVersion,
    name.slice(0, 48),
    name.toLowerCase().slice(0, 48),
    name.slice(0, 48),
    name,
    name,
    name,
    '00',
    '',
  ]
  parts.splice(1, 0, hashCode(parts.join('|')))
  const key = await crypto.subtle.importKey('raw', KKEY_KEY, 'AES-CBC', false, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: KKEY_IV }, key, new TextEncoder().encode(parts.join('|')))
  return Array.from(new Uint8Array(cipher), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function isCloudflareBlock(res) {
  return /cloudflare|cf-ray|just a moment|attention required/i.test(res.text())
}

/** Try the last working mirror first, then the rest; a mirror is skipped when Cloudflare blocks it. */
async function getJson(path) {
  const order = MIRRORS.map((_, i) => (preferredMirror + i) % MIRRORS.length)
  const failures = []
  for (const index of order) {
    const base = MIRRORS[index]
    const host = new URL(base).hostname
    let res
    try {
      res = await http.get(`${base}/api/${path}`, { headers: { ...BASE_HEADERS, referer: `${base}/` } })
    } catch (err) {
      failures.push(`${host}: ${err instanceof Error ? err.message : err}`)
      continue
    }
    if (res.ok) {
      preferredMirror = index
      return res.json()
    }
    if (isCloudflareBlock(res)) {
      failures.push(`${host}: Cloudflare ${res.status}`)
      continue
    }
    if (res.status === 403 && /^(DramaList\/Episode|Sub)\//.test(path)) {
      throw new Error('KissKH rejected the request signature (403); the extension needs updated site constants')
    }
    throw new Error(`KissKH request failed (${res.status})`)
  }
  throw new Error(`Every KissKH mirror blocked the app server (${failures.join('; ')})`)
}

function toItem(entry) {
  return {
    id: String(entry.id),
    title: String(entry.title || entry.id).slice(0, 300),
    poster: entry.thumbnail || null,
    kind: entry.episodesCount === 1 ? 'movie' : 'series',
  }
}

function subtitleCipher(url) {
  const ext = url.split('.').pop().split(/[#?]/)[0].toLowerCase()
  if (ext === 'srt') return undefined
  return SUBTITLE_CIPHERS[ext] || SUBTITLE_CIPHERS.other
}

registerExtension({
  async popular(page) {
    const params = new URLSearchParams({
      page: String(page),
      type: '0',
      sub: '0',
      country: '0',
      status: '0',
      order: '1',
      pageSize: String(PAGE_SIZE),
    })
    const data = await getJson(`DramaList/List?${params}`)
    return {
      items: (data.data || []).map(toItem),
      hasNextPage: page * PAGE_SIZE < Number(data.totalCount || 0),
    }
  },

  async search(query, page) {
    // The search endpoint returns every match in one response.
    if (page > 1) return { items: [], hasNextPage: false }
    const data = await getJson(`DramaList/Search?q=${encodeURIComponent(query)}&type=0`)
    return { items: (Array.isArray(data) ? data : []).map(toItem), hasNextPage: false }
  },

  async episodes(dramaId) {
    const drama = await getJson(`DramaList/Drama/${encodeURIComponent(dramaId)}?isq=false`)
    const episodes = [...(drama.episodes || [])].sort((a, b) => a.number - b.number)
    const single = drama.type === 'Movie' || episodes.length === 1
    return episodes.map((ep) => ({
      id: String(ep.id),
      title: single ? 'Play' : `Episode ${ep.number}`,
      number: single ? null : ep.number,
    }))
  },

  async streams(episodeId) {
    const id = Number.parseInt(episodeId, 10)
    if (!Number.isFinite(id)) throw new Error('Invalid episode id')

    const [videoKey, subKey] = await Promise.all([kkey(id, APP.videoGuid), kkey(id, APP.subtitleGuid)])
    const [video, subs] = await Promise.all([
      getJson(`DramaList/Episode/${id}.png?err=false&ts=null&time=null&kkey=${videoKey}`),
      getJson(`Sub/${id}?kkey=${subKey}`).catch((err) => {
        log('kisskh: subtitles unavailable', String(err))
        return []
      }),
    ])

    const url = video && (video.Video || video.Video_tmp)
    if (!url) throw new Error('This episode has no playable stream')

    const subtitles = (Array.isArray(subs) ? subs : [])
      .filter((s) => s && typeof s.src === 'string' && /^https:\/\//.test(s.src))
      .sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)))
      .map((s) => {
        const cipher = subtitleCipher(s.src)
        return {
          url: s.src,
          label: String(s.label || s.land || 'Subtitle').slice(0, 80),
          language: s.land || null,
          ...(cipher ? { cipher } : {}),
        }
      })

    return [{ url, quality: 'KissKH', subtitles }]
  },
})
