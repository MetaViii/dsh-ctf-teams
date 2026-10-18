export interface TextCandidate {
  text: string
  substitutions: number
  base64?: { valid: boolean; hex?: string; ascii?: string; bytes?: number; preview_truncated?: boolean }
}

/** Enumerate by edit distance, with explicit finite limits; never guesses the accepted flag. */
export function textCandidates(input: { text: string; max_candidates?: number; decode_base64?: boolean; preview_bytes?: number }): { candidates: TextCandidate[]; total_variants: string; truncated: boolean; notice: string } {
  const limit = input.max_candidates ?? 32, preview = input.preview_bytes ?? 64
  if (!input.text || input.text.length > 512) throw new Error('text must contain 1..512 characters')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new Error('max_candidates must be an integer from 1 to 128')
  if (!Number.isSafeInteger(preview) || preview < 1 || preview > 256) throw new Error('preview_bytes must be an integer from 1 to 256')
  const groups = ['0O', '1Il', '5S', '2Z', '@?']
  const original = [...input.text]
  const choices = original.map(char => [...(groups.find(group => group.includes(char)) ?? char)])
  const total = choices.reduce((product, chars) => product * BigInt(chars.length), 1n)
  const queue: TextCandidate[] = [{ text: input.text, substitutions: 0 }]
  const seen = new Set([input.text])
  for (let cursor = 0; cursor < queue.length && queue.length < limit; cursor++) {
    const current = queue[cursor]!, chars = [...current.text]
    for (let index = 0; index < chars.length && queue.length < limit; index++) {
      for (const replacement of choices[index]!) {
        if (queue.length >= limit) break
        const changed = [...chars]; changed[index] = replacement
        const text = changed.join('')
        if (seen.has(text)) continue
        seen.add(text)
        queue.push({ text, substitutions: changed.filter((char, i) => char !== original[i]).length })
      }
    }
  }
  if (input.decode_base64) for (const candidate of queue) {
    const normalized = candidate.text.replace(/[\t\r\n ]/g, '')
    const valid = /^[A-Za-z0-9+/]*={0,2}$/.test(normalized) && normalized.length > 0 && normalized.length % 4 !== 1
      && (!normalized.includes('=') || normalized.length % 4 === 0)
    const bytes = valid ? Buffer.from(normalized, 'base64') : undefined
    if (!bytes || bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) candidate.base64 = { valid: false }
    else {
      const head = bytes.subarray(0, preview)
      candidate.base64 = { valid: true, hex: head.toString('hex'), ascii: [...head].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`).join(''), bytes: bytes.length, preview_truncated: bytes.length > head.length }
    }
  }
  return { candidates: queue, total_variants: String(total), truncated: BigInt(queue.length) < total, notice: 'Unverified text candidates. Original retained first. Enumeration is bounded; no platform submissions or automatic flag verdicts.' }
}
