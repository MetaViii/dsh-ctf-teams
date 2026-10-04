#!/usr/bin/env node
/**
 * Wrap `src/client/entry.js` in the Harness client-bundle envelope.
 *
 * A client bundle is one `window.__ModuleLoader__.load({ id, factory })` call
 * whose factory is a CommonJS body resolved against the browser platform table
 * (`react`, `react/jsx-runtime`, the client UI packages). The entry here is
 * already written in that dialect, so this script is the whole client build:
 * no bundler, no extra dependency, and the emitted artifact is byte-stable for
 * `--check`.
 *
 * Usage:
 *   node scripts/build-client.mjs --write   # emit lib/client.js
 *   node scripts/build-client.mjs --check   # fail when lib/client.js is stale
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ENTRY = join(root, 'src', 'client', 'entry.js')
const OUTPUT = join(root, 'lib', 'client.js')
const BANNER = '/* dsh-ctf-teams client bundle — generated from src/client/entry.js by scripts/build-client.mjs. Do not edit by hand. */'

/** Indent every non-empty line of the factory body by one tab. */
function indent(body) {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line === '' ? '' : `\t\t${line}`))
    .join('\n')
}

/**
 * Render the bundle for a package name and its client entry.
 * @param {string} name - published package name (the bundle id).
 * @param {string} body - the entry's source.
 * @returns {string} the complete bundle file.
 */
export function renderClientBundle(name, body) {
  return [
    BANNER,
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(name)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    indent(body),
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

const apply = process.argv.includes('--write')

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (typeof pkg.name !== 'string' || pkg.name === '') throw new Error('package.json has no name')
const entry = await readFile(ENTRY, 'utf8')
const rendered = renderClientBundle(pkg.name, entry)

if (apply) {
  await mkdir(dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, rendered, 'utf8')
  console.log(`client bundle written: lib/client.js (${rendered.length} bytes, id ${pkg.name})`)
} else {
  let existing
  try {
    existing = await readFile(OUTPUT, 'utf8')
  } catch {
    throw new Error('lib/client.js is missing; run pnpm build')
  }
  if (existing !== rendered) {
    throw new Error('lib/client.js does not match src/client/entry.js; run pnpm build and commit lib/')
  }
  console.log('client bundle matches src/client/entry.js')
}
