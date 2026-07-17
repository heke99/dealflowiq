import { readdir } from 'node:fs/promises'
import process from 'node:process'

const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()
const versions = new Map()
const errors = []
for (const file of files) {
  const version = file.split('_', 1)[0]
  if (!/^\d{14}$/.test(version)) errors.push(`${file}: migration version must be a 14-digit timestamp`)
  if (versions.has(version)) errors.push(`${file}: duplicate version also used by ${versions.get(version)}`)
  versions.set(version, file)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Migration history OK: ${files.length} unique timestamped migrations.`)
