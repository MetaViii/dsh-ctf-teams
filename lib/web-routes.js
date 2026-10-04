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
/** JSON response helper: always explicitly uncacheable. */
export function sendJson(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
}
/**
 * Wrap the host Web server so every handler runs behind the Connection fence.
 * @param server - the raw host Web server service.
 * @param connection - reads the live Connection service, or undefined while absent.
 * @returns a registrable server that refuses untrusted callers before the handler runs.
 */
export function authenticatedWebRoutes(server, connection) {
    return {
        register(route) {
            return server.register({
                ...route,
                async handler(request, response) {
                    const gate = connection();
                    // A missing or disposing Connection is an assembly failure, never an
                    // invitation to expose workspace state.
                    const rejection = gate === undefined ? 503 : gate.requestRejection(request);
                    if (rejection !== undefined) {
                        sendJson(response, rejection, {
                            error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden',
                        });
                        return;
                    }
                    await route.handler(request, response);
                },
            });
        },
    };
}
/** The host service keys that can carry a Web server. */
export const WEB_SERVER_KEYS = ['webServer', 'httpServer'];
/** The host service keys that can carry the workspace registry. */
export const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'];
