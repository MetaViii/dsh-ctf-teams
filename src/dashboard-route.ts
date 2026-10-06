/**
 * The dashboard's HTTP surface: state (read), action (one user turn), export
 * (writeup / review-report download) and files (attachment picker).
 *
 * All four go through {@link authenticatedWebRoutes}, so challenge state and
 * session control stay inside the trusted browser session. Registration is
 * lazy: a headless profile mounts neither a Web server nor a workspace
 * registry, and under concurrent activation those providers may bind after
 * this plugin, so the routes try now and again on each service bind.
 * @module dsh-ctf-teams/dashboard-route
 */

import { basename, join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  authenticatedWebRoutes,
  sendJson,
  WEB_SERVER_KEYS,
  WORKSPACE_KEYS,
  type ConnectionFence,
  type RawWebServer,
  type WorkspaceEntry,
} from './web-routes.ts'
import {
  collectArchivedDashboardTeams,
  collectDashboardTeams,
  type DashboardPayload,
  type DashboardRoot,
} from './dashboard-snapshot.ts'
import {
  listWorkspaceFiles,
  parseActionBody,
  prepareRequest,
  renderTeamReport,
  type PreparedAction,
} from './dashboard-actions.ts'
import { archiveTeamDir, directoryUsage, listArchivedTeamIds, readTeam, removeTeamDir, withTeamLock } from './state.ts'
import type { TeamState } from './types.ts'

/** The exact path the dashboard tab polls. */
export const DASHBOARD_STATE_PATH = '/plugins/dsh-ctf-teams/state'
/** The panel's action endpoint: one click becomes one user turn. */
export const DASHBOARD_ACTION_PATH = '/plugins/dsh-ctf-teams/action'
/** Writeup / review-report download. */
export const DASHBOARD_EXPORT_PATH = '/plugins/dsh-ctf-teams/export'
/** Bounded workspace listing for the attachment picker. */
export const DASHBOARD_FILES_PATH = '/plugins/dsh-ctf-teams/files'

/** Route options resolved from the plugin config. */
export interface DashboardRouteOptions {
  /** State directory name under each workspace (`.ctf-teams`). */
  stateDir: string
  /** Configured team profile names, offered by the panel's start form. */
  profiles?: readonly string[]
}

/** Structural view of the workspace registry service. */
interface WorkspaceRegistry {
  list(): WorkspaceEntry[]
}

/** Structural view of the agent registry: only the two calls the panel needs. */
interface AgentRegistry {
  get(id: unknown): {
    session?: { header?: { cwd?: string } }
    followup?(message: unknown): unknown
  } | undefined
}

/** The request body limit for one panel action. */
const ACTION_BODY_LIMIT = 64 * 1024

function agentRegistry(ctx: Context): AgentRegistry | undefined {
  return (ctx as unknown as { agents?: AgentRegistry }).agents
}

function rootsFromRegistry(registry: WorkspaceRegistry): DashboardRoot[] {
  return registry.list()
    .filter((entry) => typeof entry.path === 'string' && entry.path !== '')
    .map((entry) => ({ path: entry.path, title: entry.title?.trim() || basename(entry.path) }))
}

/** The workspace a live session belongs to, or undefined for an unknown session. */
function workspaceOfSession(ctx: Context, sessionId: string): DashboardRoot | undefined {
  let cwd: string | undefined
  try {
    cwd = agentRegistry(ctx)?.get(sessionId)?.session?.header?.cwd
  } catch {
    return undefined
  }
  return cwd === undefined || cwd === '' ? undefined : { path: cwd, title: basename(cwd) }
}

/** Read a bounded JSON body; throws an Error carrying an HTTP status. */
async function readJsonBody(request: IncomingMessage, maxBytes = ACTION_BODY_LIMIT): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      if (error !== undefined) {
        // Discard the rest without buffering it.
        request.resume()
        reject(error)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onData = (chunk: Buffer | string): void => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > maxBytes) {
        finish(Object.assign(new Error('request body is too large'), { status: 413 }))
        return
      }
      chunks.push(part)
    }
    const onEnd = (): void => finish()
    const onError = (): void => finish(Object.assign(new Error('invalid request body'), { status: 400 }))
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
  })
  try {
    return raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 })
  }
}

function statusOf(error: unknown, fallback: number): number {
  const status = (error as { status?: unknown } | undefined)?.status
  return typeof status === 'number' ? status : fallback
}

/** `12 KB` / `1.4 MB` — what a delete actually freed. */
function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The session's team: the named one, else the team this session belongs to. */
export async function findSessionTeam(
  stateRoot: string,
  teamId: string | undefined,
  sessionId: string,
): Promise<TeamState | undefined> {
  if (teamId !== undefined && teamId !== '') return readTeam(stateRoot, teamId)
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  let memberTeam: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    let team: TeamState | undefined
    try {
      team = await readTeam(stateRoot, entry.name)
    } catch {
      continue
    }
    if (team === undefined) continue
    if (team.captainSessionId === sessionId) return team
    if (memberTeam === undefined && team.members.some((member) => member.id === sessionId)) memberTeam = team
  }
  return memberTeam
}

/**
 * Install the dashboard routes. Safe to call in any profile: without a Web
 * server or workspace registry nothing registers and the plugin stays tool-only.
 * @param ctx - plugin context.
 * @param options - the resolved state directory and profile names.
 */
export function installDashboardRoute(ctx: Context, options: DashboardRouteOptions): void {
  const profiles = options.profiles ?? []
  let registered = false
  const register = (): void => {
    if (registered) return
    const rawWebServer = (ctx.get(WEB_SERVER_KEYS[0]!) ?? ctx.get(WEB_SERVER_KEYS[1]!)) as RawWebServer | undefined
    const registry = (ctx.get(WORKSPACE_KEYS[0]!) ?? ctx.get(WORKSPACE_KEYS[1]!)) as WorkspaceRegistry | undefined
    if (rawWebServer === undefined || typeof rawWebServer.register !== 'function') return
    if (registry === undefined || typeof registry.list !== 'function') return
    registered = true
    const webServer = authenticatedWebRoutes(rawWebServer, () => ctx.get('connection') as ConnectionFence | undefined)

    /** The workspace a request is scoped to: the session's, else undefined. */
    const scopeOf = (sessionId: string): DashboardRoot | undefined =>
      sessionId === '' ? undefined : workspaceOfSession(ctx, sessionId)

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DASHBOARD_STATE_PATH,
      handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
          response.end()
          return
        }
        try {
          const url = new URL(request.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('session')?.trim() ?? ''
          const archived = url.searchParams.get('archived') === '1'
          const scoped = scopeOf(sessionId)
          const roots = scoped === undefined ? rootsFromRegistry(registry) : [scoped]
          const teams = archived
            ? await collectArchivedDashboardTeams(ctx, roots, options.stateDir, { sessionId })
            : await collectDashboardTeams(ctx, roots, options.stateDir, { sessionId })
          const payload: DashboardPayload = {
            generatedAt: Date.now(),
            ...sessionId === '' ? {} : { sessionId },
            ...scoped === undefined ? {} : { workspace: scoped.path },
            archived,
            profiles: [...profiles],
            teams,
          }
          sendJson(response, 200, payload)
        } catch (error: unknown) {
          ctx.logger.warn(`ctf-teams: dashboard route failed: ${String(error)}`)
          if (!response.headersSent) sendJson(response, 500, { error: 'dashboard unavailable' })
          else response.end()
        }
      },
    }), 'ctf-teams: dashboard state route')

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DASHBOARD_ACTION_PATH,
      handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
          response.end()
          return
        }
        try {
          const parsed = parseActionBody(await readJsonBody(request))
          if (parsed.ok !== true) {
            sendJson(response, parsed.status, { error: parsed.error })
            return
          }
          const scoped = scopeOf(parsed.body.sessionId)
          const agent = agentRegistry(ctx)?.get(parsed.body.sessionId)
          if (scoped === undefined || agent === undefined || typeof agent.followup !== 'function') {
            sendJson(response, 409, { error: 'this session is not live in this host; the action needs a running agent' })
            return
          }
          const stateRoot = join(scoped.path, options.stateDir)
          const team = await findSessionTeam(stateRoot, parsed.body.teamId, parsed.body.sessionId)
          const planned = prepareRequest(parsed.body, { profiles, team })
          if (planned.ok !== true) {
            sendJson(response, planned.status, { error: planned.error })
            return
          }
          const isCaptain = team !== undefined && team.captainSessionId === parsed.body.sessionId
          const participates = team !== undefined && (isCaptain || team.members.some((member) => member.id === parsed.body.sessionId))

          // Housekeeping actions touch durable files and need no model turn.
          if (planned.request.kind === 'mutation') {
            const mutation = planned.request.mutation
            if (mutation.requires === 'captain' && !isCaptain) {
              sendJson(response, 403, { error: 'only the captain session may remove this team' })
              return
            }
            const teamId = parsed.body.teamId ?? team?.id
            let freed = 0
            let removed = 0
            if (mutation.action === 'delete-team') {
              if (teamId === undefined) {
                sendJson(response, 404, { error: 'no team to delete' })
                return
              }
              await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
                freed = (await directoryUsage(join(stateRoot, teamId))).bytes
                if (mutation.mode === 'purge') await removeTeamDir(stateRoot, teamId)
                else await archiveTeamDir(stateRoot, teamId)
                removed = 1
              })
            } else {
              await withTeamLock(`team:${stateRoot}:archive`, async () => {
                const archiveRoot = join(stateRoot, 'archive')
                for (const archivedId of await listArchivedTeamIds(stateRoot)) {
                  freed += (await directoryUsage(join(archiveRoot, archivedId))).bytes
                  await removeTeamDir(archiveRoot, archivedId)
                  removed += 1
                }
              })
            }
            sendJson(response, 200, {
              ok: true,
              action: mutation.action,
              label: mutation.label,
              removed,
              freedBytes: freed,
              message: mutation.action === 'purge-archive'
                ? `已清空归档：移除 ${removed} 个战队，释放 ${humanBytes(freed)}`
                : mutation.mode === 'purge'
                  ? `已彻底删除战队，释放 ${humanBytes(freed)}`
                  : `已把战队移到归档，释放 ${humanBytes(freed)}`,
            })
            return
          }

          const action: PreparedAction = planned.request.prepared
          // Authority is enforced against durable state, never the caller's claim.
          if (action.requires === 'captain') {
            if (!isCaptain) {
              sendJson(response, 403, { error: 'only the captain session may perform this action' })
              return
            }
          } else if (action.requires === 'participant') {
            if (!participates) {
              sendJson(response, 403, { error: 'this session does not participate in the team' })
              return
            }
          }
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: action.prompt }],
            source: { kind: 'user' },
          }))
          ctx.logger.debug(`ctf-teams: panel action ${action.action} queued for session ${parsed.body.sessionId}`)
          sendJson(response, 200, {
            ok: true,
            action: action.action,
            label: action.label,
            message: `已把「${action.label}」发给会话，下一条回复会处理它`,
          })
        } catch (error: unknown) {
          const status = statusOf(error, 500)
          ctx.logger.warn(`ctf-teams: panel action failed: ${String(error)}`)
          if (!response.headersSent) {
            sendJson(response, status, { error: status >= 500 ? 'action unavailable' : String((error as Error).message) })
          } else {
            response.end()
          }
        }
      },
    }), 'ctf-teams: dashboard action route')

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DASHBOARD_EXPORT_PATH,
      handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
          response.end()
          return
        }
        try {
          const url = new URL(request.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('session')?.trim() ?? ''
          const teamId = url.searchParams.get('teamId')?.trim() || undefined
          const kind = url.searchParams.get('kind') === 'report' ? 'report' : 'writeup'
          const scoped = scopeOf(sessionId)
          const workspace = scoped ?? rootsFromRegistry(registry)[0]
          if (workspace === undefined) {
            sendJson(response, 404, { error: 'no workspace is in scope for this session' })
            return
          }
          const safeTeam = (teamId ?? 'ctf-teams').replace(/[^A-Za-z0-9._-]/g, '_')
          const filename = `${safeTeam}-${kind === 'report' ? 'report.md' : 'WRITEUP.md'}`
          let document: string
          if (kind === 'report') {
            const teams = await collectDashboardTeams(ctx, [workspace], options.stateDir, { sessionId })
            const snapshot = teams.find((team) => team.teamId === teamId) ?? teams[0]
            if (snapshot === undefined) {
              sendJson(response, 404, { error: 'no team found in this workspace to report on' })
              return
            }
            document = renderTeamReport(snapshot, Date.now())
          } else {
            try {
              document = await readFile(join(workspace.path, 'WRITEUP.md'), 'utf8')
            } catch {
              sendJson(response, 404, { error: 'WRITEUP.md does not exist yet in this workspace' })
              return
            }
          }
          response.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="${filename}"`,
            'cache-control': 'no-store',
          })
          response.end(document)
        } catch (error: unknown) {
          ctx.logger.warn(`ctf-teams: export failed: ${String(error)}`)
          if (!response.headersSent) sendJson(response, 500, { error: 'export failed' })
          else response.end()
        }
      },
    }), 'ctf-teams: dashboard export route')

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DASHBOARD_FILES_PATH,
      handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
          response.end()
          return
        }
        try {
          const url = new URL(request.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('session')?.trim() ?? ''
          const workspace = scopeOf(sessionId) ?? rootsFromRegistry(registry)[0]
          if (workspace === undefined) {
            sendJson(response, 404, { error: 'no workspace is in scope for this session' })
            return
          }
          const files = await listWorkspaceFiles(workspace.path)
          sendJson(response, 200, { workspace: workspace.path, files })
        } catch (error: unknown) {
          ctx.logger.warn(`ctf-teams: file listing failed: ${String(error)}`)
          if (!response.headersSent) sendJson(response, 500, { error: 'file listing failed' })
          else response.end()
        }
      },
    }), 'ctf-teams: dashboard files route')
  }
  register()
  // Cordis publishes each service binding as `internal/service`; the Web
  // server and workspace registry may bind after this plugin under concurrent
  // activation, so the lazy registration retries on those names only.
  const events = ctx as unknown as {
    on(name: string, listener: (name: string) => void): () => void
  }
  events.on('internal/service', (name: string) => {
    if (WEB_SERVER_KEYS.includes(name) || WORKSPACE_KEYS.includes(name)) register()
  })
}
