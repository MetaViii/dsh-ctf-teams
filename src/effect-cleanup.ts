import type { Context, Effect } from '@deepseek-ai/cordis'

/** Finish every reverse-order teardown even when one rejects; report errors after release. */
export async function drainCleanup(disposers: readonly (() => unknown)[]): Promise<void> {
  const failures: unknown[] = []
  for (const dispose of [...disposers].reverse()) {
    try { await dispose() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Auto review cleanup failed after all owned registrations were released')
}

/** Scoped workaround for the audited Auto lifecycle; never monkey-patch Cordis globally. */
export function autoReviewCleanupContext(ctx: Context): Context {
  const effect = ((setup: () => unknown, label?: string) => {
    if (label !== 'auto-review lifecycle') return ctx.effect(setup as () => Effect, label)
    return ctx.effect(() => {
      const lifecycle = setup()
      if (!lifecycle || typeof (lifecycle as Iterable<unknown>)[Symbol.iterator] !== 'function') throw new Error('Unsupported Auto review lifecycle; expected audited synchronous disposer generator')
      const disposers = [...lifecycle as Iterable<() => unknown>]
      if (disposers.length !== 3 || disposers.some(dispose => typeof dispose !== 'function')) throw new Error('Unsupported Auto review lifecycle; expected three owned disposers')
      return () => drainCleanup(disposers)
    }, label)
  }) as Context['effect']
  return ctx.extend({ effect })
}
