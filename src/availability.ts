import type { MemberFault, TeamMember, TeamMessage } from './types.ts'

export interface FailureInput { code: string; message: string; status?: number; providerRetryAfterMs?: number }

/** Provider-neutral failure policy; only final turn failures enter this ledger. */
export function classifyFailure(failure: FailureInput): MemberFault['kind'] {
  if (/network block of this IP|firewall.*block.*IP|IP.*(?:blocked|阻断|封禁)|plan_missing|coding plan.*(?:required|missing)|没有.*(?:套餐|权限)/i.test(failure.message)) return 'configuration'
  if (['NO_ADAPTER', 'AUTH', 'MISSING_CREDENTIAL', 'MODEL_NOT_FOUND', 'INVALID_API_KEY', 'UNAUTHORIZED'].includes(failure.code)
    || failure.status === 401 || /\binvalid_api_key\b|\bauthentication_error\b|\b401\b.*(?:invalid|unauthorized|API.?Key)|API\s*Key\s*无效/i.test(failure.message)) return 'configuration'
  if (['RATE_LIMIT', 'QUOTA'].includes(failure.code) || failure.status === 429) return 'rate_limit'
  if (['NETWORK', 'TIMEOUT', 'TRANSPORT'].includes(failure.code) || (failure.status !== undefined && [502,503,504].includes(failure.status)) || /\b50[234]\b|MAINTENANCE_MODE|maintenance|no_healthy_account|temporarily unavailable/i.test(failure.message)) return 'transient'
  return 'task'
}

export function recordMemberFault(member: TeamMember, failure: FailureInput, now = Date.now(), retryDelayMs = 30_000): { fault: MemberFault; notify: boolean } {
  member.failureCounts ??= {}
  const count = (Object.hasOwn(member.failureCounts, failure.code) ? member.failureCounts[failure.code]! : 0) + 1
  Object.defineProperty(member.failureCounts, failure.code, { value: count, enumerable: true, configurable: true, writable: true })
  const kind = classifyFailure(failure)
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/.exec(failure.message)?.[0]
  const stated = iso ? Date.parse(iso) : undefined
  const retryAt = failure.providerRetryAfterMs !== undefined && Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0
    ? now + failure.providerRetryAfterMs
    : stated !== undefined && stated > now ? stated : kind === 'transient' ? now + retryDelayMs : undefined
  const fault: MemberFault = { code: failure.code, message: failure.message.slice(0, 2000), kind, count,
    firstAt: member.fault?.code === failure.code ? member.fault.firstAt : now, lastAt: now,
    ...retryAt === undefined || ['transient', 'rate_limit'].includes(kind) && count >= 2 ? {} : { retryAt },
  }
  member.fault = fault
  if (kind !== 'task' || count >= 3) member.status = 'faulted'
  return { fault, notify: count === 1 }
}

/** Fold old failure storms for display; acknowledge every underlying id only when shown. */
export function foldFailureInbox(messages: TeamMessage[]): Array<{ message: TeamMessage; ids: string[] }> {
  const groups: Array<{ message: TeamMessage; ids: string[] }> = []
  const failures = new Map<string, number>()
  for (const message of messages) {
    const code = /\(code ([A-Z_0-9]+)\)/.exec(message.content)?.[1]
    const key = code && /failure|failed/.test(message.content) ? `${message.from}\0${code}` : undefined
    const position = key ? failures.get(key) : undefined
    if (position === undefined) {
      if (key) failures.set(key, groups.length)
      groups.push({ message, ids: [message.id] })
    } else {
      const group = groups[position]!
      group.ids.push(message.id)
      group.message = { ...message, content: `${message.content}\n[${group.ids.length} repeated ${code} reports folded]` }
    }
  }
  return groups
}

/** Configuration failures require a route update; rate limits with unknown reset stay paused. */
export function memberAvailable(member: TeamMember, now = Date.now()): boolean {
  if (member.dispatchPaused) return false
  if (member.status === 'removed' || member.stopping) return false
  const fault = member.fault
  if (!fault) return member.status !== 'faulted'
  if (fault.kind === 'configuration' || fault.kind === 'task' && fault.count >= 3) return false
  if (fault.kind === 'rate_limit' || fault.kind === 'transient') return fault.retryAt !== undefined && fault.retryAt <= now
  return true
}

export function availabilityLabel(member: TeamMember): string {
  if (member.dispatchPaused) return 'dispatch paused; update_member(wake:true) to release'
  if (!member.fault) return member.status
  const f = member.fault
  return `${memberAvailable(member) ? 'retry ready' : 'faulted'} (${f.code} ×${f.count})${f.retryAt ? `; retry at ${new Date(f.retryAt).toISOString()}` : f.kind === 'configuration' ? '; update provider/model' : f.kind === 'rate_limit' ? '; reset time unknown' : ''}`
}

/** Advice is a diagnosis of a report, not a provider quota or inferred reset time. */
export function recoveryAdvice(member: TeamMember) {
  if(member.dispatchPaused)return {reason:'dispatch_paused',next_action:'update_member with wake:true only after the provider is ready',retry_at:null}
  const fault=member.fault
  if(!fault)return {reason:'available',next_action:'none',retry_at:null}
  const text=fault.message
  const reason=/network block of this IP|firewall.*block.*IP|IP.*(?:blocked|阻断|封禁)/i.test(text)?'ip_blocked'
    : /plan_missing|coding plan.*(?:required|missing)|没有.*(?:套餐|权限)/i.test(text)?'plan_missing'
    : /concurrency_limit_exceeded|在途|并发/i.test(text)?'concurrency_limited'
    : /rate_limit_exceeded|请求过于频繁|每分钟|60s/i.test(text)?'frequency_limited'
    : /maintenance|MAINTENANCE_MODE|\b50[234]\b/i.test(text)?'maintenance':fault.kind
  const next_action=reason==='ip_blocked'?'check provider network/egress; repairing the same route does not remove an IP block'
    : reason==='plan_missing'?'check account plan and model route; update_member after correction'
    : reason==='concurrency_limited'?'reduce parallel lanes; repair with wake:false until capacity is available'
    : ['frequency_limited','rate_limit'].includes(reason)?'wait for a provider reset; unknown reset is not a countdown; use wake:false when repairing'
    : fault.retryAt?'wait until retry_at; at most one automatic infrastructure retry'
    : 'inspect the route, then update_member(wake:false) or reassign_task to an available owner; no wake is guaranteed by allocation'
  return {reason,next_action,retry_at:fault.retryAt??null}
}
