import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { autoReviewCleanupContext, drainCleanup } from '../lib/effect-cleanup.js'
import { apply as installCompatibility } from '../lib/auto-review-cleanup.js'

async function disposedListener(useCompatibility) {
  const root = new Context(), errors = [], calls = [], released = []
  const provider = await root.plugin(SessionProjectionRegistry); await provider.await()
  const fiber = await root.plugin({ inject: ['sessionProjections'], apply(ctx) {
    const scoped = useCompatibility ? autoReviewCleanupContext(ctx) : ctx
    scoped.effect(function* () {
      yield scoped.on('fixture/probe', () => {
        calls.push('called')
        try { scoped.sessionProjections.stateOf({}, 'absent') } catch (error) { errors.push(error.message) }
      })
      yield () => released.push('registration')
      yield async () => { throw Error('simulated provider shutdown race') }
    }, 'auto-review lifecycle')
  } }); await fiber.await()
  root.emit('fixture/probe'); assert.equal(calls.length, 1)
  await fiber.dispose(); assert.equal(fiber.state, 4)
  root.emit('fixture/probe')
  await provider.dispose()
  return { calls, errors, released }
}

test('Cordis 4.0.4 baseline reproduces a disposed callback reading inactive sessionProjections', async () => {
  const baseline = await disposedListener(false)
  assert.equal(baseline.calls.length, 2)
  assert.match(baseline.errors[0], /cannot get required service "sessionProjections" in inactive context/)
  assert.deepEqual(baseline.released, [])
})

test('scoped compatibility releases the hook and registrations despite the same teardown failure', async () => {
  const repaired = await disposedListener(true)
  assert.equal(repaired.calls.length, 1)
  assert.deepEqual(repaired.errors, [])
  assert.deepEqual(repaired.released, ['registration'])
})

test('cleanup preserves reverse order and reports all failures after every resource is released', async () => {
  const order=[]
  await assert.rejects(drainCleanup([()=>{order.push('first');throw Error('one')},async()=>{order.push('second');throw Error('two')},()=>order.push('third')]),error=>error instanceof AggregateError && error.errors.length===2)
  assert.deepEqual(order,['third','second','first'])
})

test('changed reviewer uses the complete official plugin unchanged, retaining denial and failures', async () => {
  for(const failure of [false,true]){
    const warnings=[],reason=Error('official reviewer failed')
    const upstream={name:'experimental-auto-review',inject:[],Config:{sentinel:'retained'},apply(ctx){
      assert.equal(this,upstream)
      if(failure)throw reason
      ctx.on('fixture/decision',()=>({kind:'deny',reason:'official denial'}))
    }}
    // The native Cordis installer owns upstream metadata and dependency scope.
    let installed,waited=false
    const pending=installCompatibility({get:()=>({import:async()=>upstream}),logger:{warn:line=>warnings.push(line)},async plugin(value){
      installed=value
      if(failure)throw reason
      return {async await(){waited=true}}
    }})
    if(failure)await assert.rejects(pending,error=>error===reason);else await pending
    assert.equal(installed,upstream);assert.equal(waited,!failure);assert.equal(warnings.length,1)
  }
})

test('native fallback installs a changed official reviewer with new dependencies and preserves denial',async()=>{
  const root=new Context(), upstream={name:'experimental-auto-review',inject:['futureReviewPolicy'],apply(ctx){ctx.on('fixture/decision',()=>ctx.get('futureReviewPolicy').decision)}}
  const services=await root.plugin({apply(ctx){ctx.provide('loader',{import:async()=>upstream});ctx.provide('logger',{warn(){}});ctx.provide('futureReviewPolicy',{decision:{kind:'deny',reason:'official denial'}})}})
  await services.await()
  const wrapper=await root.plugin({inject:['loader','logger'],async apply(ctx){await installCompatibility(ctx)}})
  await wrapper.await()
  assert.deepEqual(await root.serial('fixture/decision'),{kind:'deny',reason:'official denial'})
  await wrapper.dispose();assert.equal(await root.serial('fixture/decision'),undefined)
  await services.dispose()
})

test('missing official reviewer fails explicitly without installing or overriding permissions',async()=>{
  let installed=false
  await assert.rejects(installCompatibility({get:()=>({import:async()=>({})}),plugin(){installed=true}}),/No reviewer or permission override/)
  assert.equal(installed,false)
})

test('compatibility owns the audited upstream dependency set including modern workingDirectory', async () => {
  const original=await import('../node_modules/.pnpm/node_modules/@deepseek-ai/dsh-experimental-auto-review/lib/index.js')
  for(const inject of [original.inject,[...original.inject,'workingDirectory']]){
    let observed,waited=false
    await installCompatibility({
      get:()=>({import:async()=>({...original,inject})}),
      async inject(dependencies){observed=dependencies;return {async await(){waited=true}}}
    })
    assert.deepEqual(observed,inject);assert.equal(waited,true)
  }
})
