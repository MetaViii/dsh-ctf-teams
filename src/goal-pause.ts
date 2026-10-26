/** Optional exact-host capability: human panel/stop action only, never model inference. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface GoalView { id: string; revision: number; phase: string }
interface Goals { get(agent: Agent): GoalView | undefined; pause(agent: Agent, ref: {id:string;revision:number}): GoalView }
export function pauseCaptainGoal(ctx: Context, captain: Agent): { status: string; goal_id?: string } {
  try {
    const goals = (ctx as unknown as {get(name:string):unknown}).get('goals') as Goals | undefined
    if (!goals || typeof goals.get !== 'function' || typeof goals.pause !== 'function') return {status:'unavailable'}
    const current = goals.get(captain)
    if (!current) return {status:'none'}
    if (current.phase !== 'active') return {status:'already_inactive',goal_id:current.id}
    goals.pause(captain,{id:current.id,revision:current.revision})
    return {status:'paused',goal_id:current.id}
  } catch (error: unknown) {
    ctx.logger.warn(`ctf-teams: goal pause unavailable; team halt still applies: ${String(error).slice(0,200)}`)
    return {status:'failed'}
  }
}
