/** Finish every reverse-order teardown even when one rejects; report errors after release. */
export async function drainCleanup(disposers) {
    const failures = [];
    for (const dispose of [...disposers].reverse()) {
        try {
            await dispose();
        }
        catch (error) {
            failures.push(error);
        }
    }
    if (failures.length)
        throw new AggregateError(failures, 'Auto review cleanup failed after all owned registrations were released');
}
/** Scoped workaround for the audited Auto lifecycle; never monkey-patch Cordis globally. */
export function autoReviewCleanupContext(ctx) {
    const effect = ((setup, label) => {
        if (label !== 'auto-review lifecycle')
            return ctx.effect(setup, label);
        return ctx.effect(() => {
            const lifecycle = setup();
            if (!lifecycle || typeof lifecycle[Symbol.iterator] !== 'function')
                throw new Error('Unsupported Auto review lifecycle; expected audited synchronous disposer generator');
            const disposers = [...lifecycle];
            if (disposers.length !== 3 || disposers.some(dispose => typeof dispose !== 'function'))
                throw new Error('Unsupported Auto review lifecycle; expected three owned disposers');
            return () => drainCleanup(disposers);
        }, label);
    });
    return ctx.extend({ effect });
}
