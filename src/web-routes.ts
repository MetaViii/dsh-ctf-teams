/**
 * The trust fence around this plugin's raw Web routes.
 *
 * The host `webServer` service registers handlers directly on the HTTP server,
 * which is *outside* the Connection service's browser-trust fence — a route
 * registered there answers any request the socket accepts, including one from
 * another local process. Challenge state (remotes, attachment names, extracted
 * flags) is exactly the kind of data that must not leak, so every route this
 * plugin owns goes through {@link authenticatedWebRoutes}: the Connection
 * service decides, per request, whether the caller is the trusted browser.
 *
 * Mirrors the upstream AgentTeams route gate (`dsh-agent-teams`), which is the
 * tested shape of this fence for the same Harness generations.
 * @module dsh-ctf-teams/web-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** One raw route as the host Web server accepts it. */
export interface RawWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

/** Structural view of the host Web server service (no host types imported). */
export interface RawWebServer {
  register(route: RawWebRoute): () => void
}

/** Structural view of the Connection service's per-request trust decision. */
export interface ConnectionFence {
  /** An HTTP status when the request must be refused, or undefined to allow it. */
  requestRejection(request: IncomingMessage): number | undefined
}

/** A Web server whose registered handlers are gated by the Connection fence. */
export interface AuthenticatedWebServer {
  register(route: RawWebRoute): () => void
}

/** JSON response helper: always explicitly uncacheable. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/**
 * Wrap the host Web server so every handler runs behind the Connection fence.
 * @param server - the raw host Web server service.
 * @param connection - reads the live Connection service, or undefined while absent.
 * @returns a registrable server that refuses untrusted callers before the handler runs.
 */
export function authenticatedWebRoutes(
  server: RawWebServer,
  connection: () => ConnectionFence | undefined,
): AuthenticatedWebServer {
  return {
    register(route: RawWebRoute): () => void {
      return server.register({
        ...route,
        async handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
          const gate = connection()
          // A missing or disposing Connection is an assembly failure, never an
          // invitation to expose workspace state.
          const rejection = gate === undefined ? 503 : gate.requestRejection(request)
          if (rejection !== undefined) {
            sendJson(response, rejection, {
              error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden',
            })
            return
          }
          await route.handler(request, response)
        },
      })
    },
  }
}

/** The host service keys that can carry a Web server. */
export const WEB_SERVER_KEYS: readonly string[] = ['webServer', 'httpServer']

/** The host service keys that can carry the workspace registry. */
export const WORKSPACE_KEYS: readonly string[] = ['workspaceRegistry', 'workspace']

/** One workspace as the registry lists it. */
export interface WorkspaceEntry {
  title?: string
  path: string
}
