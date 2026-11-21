// Internet Archive — public-domain feature films and TV.
// Runs inside the Watch Party extension sandbox: `http`, `log`, and
// `registerExtension` are provided; fetch/XHR are not available.

const BASE = 'https://archive.org'
const COLLECTIONS = 'collection:(feature_films OR classic_tv OR silent_films)'
const PAGE_SIZE = 40
const VIDEO_FORMATS = /mpeg4|h\.264|matroska|webm/i

async function searchItems(query, page) {
  const q = query ? `(${query}) AND mediatype:(movies) AND ${COLLECTIONS}` : `mediatype:(movies) AND ${COLLECTIONS}`
  const params = new URLSearchParams({
    q,
    rows: String(PAGE_SIZE),
    page: String(page),
    output: 'json',
  })
  for (const field of ['identifier', 'title', 'year', 'description']) params.append('fl[]', field)
  if (!query) params.append('sort[]', 'downloads desc')

  const res = await http.get(`${BASE}/advancedsearch.php?${params}`)
  if (!res.ok) throw new Error(`Archive search failed (${res.status})`)
  const data = res.json().response
  const items = data.docs.map((doc) => ({
    id: doc.identifier,
    title: String(Array.isArray(doc.title) ? doc.title[0] : doc.title || doc.identifier).slice(0, 300),
    poster: `${BASE}/services/img/${encodeURIComponent(doc.identifier)}`,
    year: Number.parseInt(doc.year, 10) || null,
    description: typeof doc.description === 'string' ? stripHtml(doc.description).slice(0, 4000) : null,
  }))
  return { items, hasNextPage: page * PAGE_SIZE < data.numFound }
}

async function metadata(identifier) {
  const res = await http.get(`${BASE}/metadata/${encodeURIComponent(identifier)}`)
  if (!res.ok) throw new Error(`Archive metadata failed (${res.status})`)
  return res.json()
}

/** "Movie.ia.mp4" and "Movie.mp4" are the same title in different encodes. */
function baseName(name) {
  return name.replace(/\.[^./]+$/, '').replace(/\.ia$/i, '').replace(/_512kb$/i, '')
}

function videoFiles(meta) {
  return (meta.files || []).filter((f) => VIDEO_FORMATS.test(f.format || '') && /\.(mp4|m4v|webm)$/i.test(f.name))
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function fileUrl(identifier, name) {
  return `${BASE}/download/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`
}

registerExtension({
  popular(page) {
    return searchItems('', page)
  },

  search(query, page) {
    return searchItems(query, page)
  },

  async episodes(identifier) {
    const meta = await metadata(identifier)
    const seen = new Map()
    for (const file of videoFiles(meta)) {
      const base = baseName(file.name)
      if (!seen.has(base)) seen.set(base, file)
    }
    const bases = [...seen.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return bases.map((base, i) => ({
      id: `${identifier}::${base}`,
      title: bases.length === 1 ? 'Play' : base.split('/').pop().replace(/[_-]+/g, ' '),
      number: bases.length === 1 ? null : i + 1,
    }))
  },

  async streams(episodeId) {
    const [identifier, base] = episodeId.split('::')
    const meta = await metadata(identifier)
    const files = videoFiles(meta)
      .filter((f) => baseName(f.name) === base)
      .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))

    const subtitles = (meta.files || [])
      .filter((f) => /\.(srt|vtt)$/i.test(f.name) && f.name.startsWith(base))
      .map((f) => ({ url: fileUrl(identifier, f.name), label: f.name.replace(/^.*\//, '').slice(0, 80) }))

    return files.map((f) => ({
      url: fileUrl(identifier, f.name),
      type: 'mp4',
      quality: `${f.format}${f.size ? ` · ${Math.round(Number(f.size) / 1e6)} MB` : ''}`.slice(0, 40),
      subtitles,
    }))
  },
})
