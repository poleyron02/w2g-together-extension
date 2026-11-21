/**
 * Validate index.json and pin each extension's sha256. Run after editing any extension:
 *
 *   npm run index
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(root, 'index.json')
const index = JSON.parse(await readFile(indexPath, 'utf8'))
const ids = new Set()

for (const ext of index.extensions ?? []) {
  if (ids.has(ext.id)) throw new Error(`Duplicate extension id "${ext.id}"`)
  ids.add(ext.id)
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(ext.id)) throw new Error(`Invalid id "${ext.id}"`)
  if (!/^\d+(\.\d+){0,3}$/.test(ext.version)) throw new Error(`${ext.id}: invalid version "${ext.version}"`)
  if (!Array.isArray(ext.hosts) || ext.hosts.length === 0) throw new Error(`${ext.id}: "hosts" is required`)

  const code = await readFile(path.join(root, ext.file))
  if (!code.includes('registerExtension(')) {
    throw new Error(`${ext.id}: ${ext.file} never calls registerExtension()`)
  }
  ext.sha256 = createHash('sha256').update(code).digest('hex')
  console.log(`${ext.id}@${ext.version} ${ext.sha256.slice(0, 12)}…`)
}

await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log('wrote index.json')
