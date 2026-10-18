/** Optional host entry: retain upstream review policy; patch only the audited teardown. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { autoReviewCleanupContext } from './effect-cleanup.ts'

export const name = 'ctf-auto-review-cleanup-compat'
export const inject = ['loader']
const auditedApplyHash = '59ea8b4eb4b785006e2a3f3dd7d248071f7c53e9c7b91334b220ce4df2e8bb52'
const legacyDependencies = ['approval', 'llm', 'permissionPresets', 'sessions', 'tools']

export async function apply(ctx: Context): Promise<void> {
  const upstream = await ctx.get('loader').import('@deepseek-ai/dsh-experimental-auto-review') as { name?: string; inject?: string[]; apply?: (context: Context) => unknown }
  const dependencies = upstream.inject
  if (upstream.name !== 'experimental-auto-review' || typeof upstream.apply !== 'function') {
    throw new Error('Harness auto-review exports are unavailable; restore the official auto-review entry. No reviewer or permission override was installed.')
  }
  const audited = Array.isArray(dependencies) && legacyDependencies.every(key => dependencies.includes(key))
    && createHash('sha256').update(upstream.apply.toString()).digest('hex') === auditedApplyHash
  if (!audited) {
    // A host upgrade may fix or replace this lifecycle. Let Cordis install the
    // complete official plugin (including its own Config and inject metadata).
    // Never suppress installation failures or turn a failed review into allow.
    ctx.logger.warn('CTF compatibility: auto-review implementation changed; using the unmodified official reviewer. The historical teardown workaround is not applied.')
    const child = await ctx.plugin(upstream as Parameters<Context['plugin']>[0])
    await child.await()
    return
  }
  const applyUpstream = upstream.apply
  // Own the upstream's complete dependency set: rc.1 also reads workingDirectory
  // while classifying a call. The child is released with this wrapper.
  const child = await ctx.inject(dependencies!, async scope => {
    await applyUpstream(autoReviewCleanupContext(scope))
  })
  await child.await()
}
