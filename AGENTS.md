# Project maintenance skills

Before using a DSH plugin lifecycle skill in this repository, read `skills/README.md` for its source, version, and project-specific applicability. Prefer the project copy when a global skill has the same name.

Vendored skills are community guidance. Historical version examples are not the current support policy; verify exact Harness tags, npm artifacts, the resolved dependency graph, and AgentTeams behavior. Preserve upstream skill files; record local integration rules separately.

User instructions and authorization take precedence over skill defaults. Do not repeat confirmation for work the user has already authorized.

# Local delivery

The maintainer requires each completed plugin iteration to update the local DSH installation as well as the source. Install the same tested artifact, first back up profile configuration and existing session/team data, then verify the installed files, preset and startup. Preserve permissions, model routes, other plugins and all existing work. Coordinate a full DSH exit if it is running; never replace files in a live runtime. Updating CTFTeams does not authorize an unrelated DSH Desktop upgrade or resuming a halted team. Record any remaining GUI validation separately.

# Browser automation

For interactive browser automation, use the `ego-browser` skill from Ego Lite. Do not use `agent-browser` or another browser-control skill unless the user explicitly requests it or Ego Lite is unavailable.
