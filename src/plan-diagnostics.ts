import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const memberKeys = ['name', 'role', 'provider', 'model', 'reasoning_effort', 'executionPrompt']
const taskKeys = ['id', 'subject', 'description', 'assignee', 'dependencies','challenge_id','resource_key','preflight','preflight_finding_id','allow_duplicate_challenge']

/** Inspect actual presence, independently of the host validator's nested failures. */
export function diagnosePlan(plan: unknown): string | undefined {
  const missing: string[] = [], illegal: string[] = [], invalid: string[] = []
  if (!record(plan)) return 'invalid arguments: plan must be an object'
  const shape: Record<string, unknown> = { keys: Object.keys(plan) }
  for (const key of Object.keys(plan)) if (!['members', 'tasks'].includes(key)) illegal.push(`plan.${key}`)
  for (const [key, allowed, required] of [['members', memberKeys, ['name']], ['tasks', taskKeys, ['id', 'subject']]] as const) {
    if (!Object.hasOwn(plan, key)) { missing.push(`plan.${key}`); continue }
    const rows = plan[key]
    if (!Array.isArray(rows)) { invalid.push(`plan.${key} must be an array`); continue }
    shape[key] = { count: rows.length, rows: rows.slice(0, 8).map((row, index) => ({ index, keys: record(row) ? Object.keys(row) : '(non-object)' })) }
    rows.forEach((row: unknown, index: number) => {
      const path = `plan.${key}[${index}]`
      if (!record(row)) { invalid.push(`${path} must be an object`); return }
      for (const field of required) if (!Object.hasOwn(row, field)) missing.push(`${path}.${field}`)
      for (const field of Object.keys(row)) {
        if (!(allowed as readonly string[]).includes(field)) illegal.push(`${path}.${field}`)
        else if (field === 'allow_duplicate_challenge') { if(typeof row[field]!=='boolean')invalid.push(`${path}.${field} must be a boolean`) }
        else if (field === 'dependencies' || field === 'preflight') {
          if (!Array.isArray(row[field]) || row[field].some(value => typeof value !== 'string')) invalid.push(`${path}.${field} must be a string array`)
        } else if (typeof row[field] !== 'string') invalid.push(`${path}.${field} must be a string`)
      }
    })
  }
  if (missing.length + illegal.length + invalid.length === 0) return undefined
  const group = (title: string, entries: string[]) => entries.length ? `${title}: ${entries.slice(0, 12).join(', ')}${entries.length > 12 ? ` (+${entries.length - 12} more)` : ''}` : ''
  return ['invalid arguments', group('Missing fields', missing), group('Undeclared fields', illegal), group('Invalid fields', invalid),
    'Every task requires id and subject. Use plan={members:[{name:"worker",executionPrompt:"..."}],tasks:[{id:"recon",subject:"Inspect attachments",assignee:"worker"}]}. For a large plan, use create → add_member → create_task.',
    `Received plan structure: ${JSON.stringify(shape)}`].filter(Boolean).join('; ')
}

/** Preserve the published Schema; add diagnostics before the typed executor. */
export function withPlanDiagnostics(tool: ToolDefinition): ToolDefinition {
  return { ...tool, async execute(args, exec) {
    if (record(args) && args['plan'] !== undefined) {
      const diagnostic = diagnosePlan(args['plan'])
      if (diagnostic) throw new Error(diagnostic)
    }
    return tool.execute(args, exec)
  } }
}
