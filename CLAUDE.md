# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests (vitest)
./container/build.sh # Rebuild agent container
```

### Session History

When committing, also append a session entry to `HISTORY.md` with a timestamp range and a narrative summary of the session: what problems we solved, what we built, what decisions we made. Focus on the "why" and the journey, not just a changelog.

### Testing

When changing agent behavior — how messages are routed, how notes are ingested, how files are written — verify end-to-end by running the actual pipeline: trigger the sync or inject a message, then check that the expected side effects happened (correct file, correct location within the file, correct content). Don't just update instructions and call it done; prove it works.

Run `npm test` and ensure all tests pass before considering work complete.

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Exocortex

Personal knowledge base at `~/Documents/ai_assistant` (separate repo: `index-engine/ai_assistant`). See `exocortex/README.md` for details.

- `projects/nanoclaw/` — architecture discussions, decisions, TODOs
- `ingest/` — Things 3 sync pipeline (inbox, config, sync state)
- `archive/` — legacy strategic assistant files (read-only reference)
- `jobs.md` — registry of all scheduled jobs; any new job MUST be added there

Two NanoClaw processes write to the exocortex (see `src/index.ts`):
- **Things sync** (`src/things-sync.ts`) — reads Things 3 DB, writes new items to `ingest/things_inbox.json` every hour
- **Exocortex git sync** (`src/exocortex-sync.ts`) — commits and pushes changes daily

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
