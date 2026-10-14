import type { TeamState, TeamTask } from './types.ts'

const checks: Record<string, string> = {
  environment_free: 'environment_free', 'whoami.active_environments==0': 'environment_free',
  challenge_unsolved: 'challenge_unsolved', 'get.is_solved==false': 'challenge_unsolved',
  access_ready: 'access_ready', 'env.access_ready==true': 'access_ready',
  target_running: 'target_running', offline_verified: 'offline_verified',
}

export function validatePreflight(values: readonly string[]): void {
  for (const value of values) if (!checks[value]) throw new Error(`unknown preflight "${value}"; supported checks: environment_free, challenge_unsolved, access_ready, target_running, offline_verified`)
}

/** Pure admission over fresh read-only platform facts; unknown never means passed. */
export function taskBlockReason(team: TeamState, task: TeamTask, now = Date.now()): string | undefined {
  if (task.resourceKey) {
    const holder = team.tasks.find(other => other.id !== task.id && other.resourceKey === task.resourceKey && ['claimed', 'in_progress'].includes(other.status))
    if (holder) return `resource ${task.resourceKey} held by ${holder.assignee ?? 'unassigned'} (${holder.id}); wait for explicit handoff`
  }
  for (const raw of task.preflight ?? []) {
    const check = checks[raw]
    if (check === 'offline_verified') {
      const finding = team.findings?.find(f => f.id === task.preflightFindingId)
      if (finding?.verifications?.at(-1)?.result !== 'confirmed') return 'offline preflight needs a captain-confirmed finding with reproducible self-test output'
      continue
    }
    const snapshot = team.platformSnapshot
    if (!snapshot || now - snapshot.checkedAt > 60_000) return 'platform preflight missing/stale; run ctf_teams_platform_check (read-only)'
    if (check !== 'environment_free' && snapshot.challengeId !== task.challengeId) return 'platform preflight belongs to another challenge; refresh this task challenge'
    if (check === 'environment_free' && snapshot.activeEnvironments !== 0) return `environment slot not free (active=${snapshot.activeEnvironments ?? 'unknown'})`
    if (check === 'challenge_unsolved' && snapshot.isSolved !== false) return `challenge already solved or status unknown (${snapshot.isSolved ?? 'unknown'})`
    if (check === 'access_ready' && snapshot.accessReady !== true) return 'environment access is not confirmed ready'
    if (check === 'target_running' && snapshot.targetRunning !== true) return 'target is not confirmed running'
  }
  return undefined
}

export function dispatchState(team: TeamState, task: TeamTask): { dispatch_state: string; dispatch_reason?: string } {
  if (['claimed', 'in_progress', 'completed'].includes(task.status)) return { dispatch_state: 'dispatched' }
  const owner = team.members.find(m => m.name === task.assignee)
  const reason = team.phase === 'staged' ? 'plan awaiting approval' : team.halted ? 'team halted'
    : task.blockedReason ?? taskBlockReason(team, task) ?? (owner?.fault ? `${owner.fault.code} ×${owner.fault.count}; repair route or wait for reset` : undefined)
    ?? (task.dependencies.some(id => team.tasks.find(t => t.id === id)?.status !== 'completed') ? 'unfinished dependencies' : 'owner busy, pending mailbox, or delivery not yet accepted; allocation is not proof of wakeup')
  return { dispatch_state: 'waiting', dispatch_reason: reason }
}
