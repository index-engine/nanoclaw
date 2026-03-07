# Plan: Recording the Fleeting Notes Processing Session

Created: 2026-03-07T09:12

## Context

We're doing a manual fleeting notes processing session. The primary goal is to **record the method** — not just do the work, but capture how the work is done so we can automate it later. Two concerns run in parallel throughout: **what we record** (the structured observations) and **how we record it** (where the data lives).

## Execution Steps

1. Copy this plan to `openspec/changes/fleeting-notes-automation/plans/plan-2026-03-07T0912-recording-architecture.md`
2. Create the directory structure under the OpenSpec change
3. Create `session-log.md` with initial template
4. Take snapshots of all container objects (Things inbox, exocortex inbox, fleeting dir, daily note)
5. Begin processing — record as we go

## Recording Architecture

### Layer 1: Raw Session Log (automatic)
- This Claude Code session is stored at: `~/.claude/projects/-Users-nanoclaw-Documents-nanoclaw/a4bb68de-bf1d-4e8f-b990-7003398142e6.jsonl`
- Contains every message, tool call, and output — the complete raw record
- We'll reference this session ID in the OpenSpec change files

### Layer 2: Structured Observations (the session-log.md file)
- **Location:** `openspec/changes/fleeting-notes-automation/session-log.md`
- Updated incrementally as we work — after each stage, I append what happened
- Records:
  - **Timestamps** for each stage
  - **Objects and their state transitions** (Things items, Obsidian notes, inbox entries)
  - **Decisions made** — what you chose to do and why
  - **Transformations** — how raw captures become structured notes
  - **Tools used** — which commands, what inputs, what outputs

### Layer 3: Method Specification (distilled after)
- **Location:** `openspec/changes/fleeting-notes-automation/specs/fleeting-notes-workflow/spec.md`
- Distilled from the session log into a reusable workflow definition
- This is the artifact that drives future automation

## What We Record Specifically

### Container Objects (aggregate state — tracked at inbox/directory level)
| Object | Source | States to Track |
|--------|--------|-----------------|
| **Things Inbox** (directory) | `things inbox` | has items → empty (goal state) |
| **Things Today** (directory) | `things today` | snapshot count and contents |
| **Exocortex inbox** | `~/Documents/ai_assistant/inbox.md` | has unrouted items → all routed (goal state) |
| **Fleeting notes dir** | `~/Documents/ai_assistant/fleeting/` | has unprocessed notes → all processed |

These are the "inboxes" whose state we want to drive from full → empty. We snapshot them at start and end.

### Item Objects (individual things with state transitions)
| Object | Source | States to Track |
|--------|--------|-----------------|
| **Things inbox item** | `things inbox` | captured → triaged → routed → processed/discarded |
| **Fleeting note** | `~/Documents/ai_assistant/fleeting/` | raw → reviewed → routed to permanent note / discarded |
| **Inbox entry** | `~/Documents/ai_assistant/inbox.md` | unrouted → routed → archived |
| **Obsidian daily note** | `~/Documents/vvault/0a. Daily Notes/2026/03-March/2026-03-07-Saturday.md` | empty sections → populated |
| **Permanent note** | `~/Documents/ai_assistant/notes/` or `~/Documents/vvault/Notes/` | doesn't exist → created / existing → updated |

### Stages (what happens in order)
1. **Snapshot** — capture current state of all sources (Things inbox, fleeting/, inbox.md, daily note)
2. **Triage** — review each item, decide: route, defer, discard
3. **Route** — move items to their destinations (project inboxes, permanent notes, daily note)
4. **Integrate** — merge routed items into existing notes or create new ones
5. **Clean up** — mark Things items done, archive processed inbox entries, update daily note

### At Each Stage, Record:
- State of each object before and after
- Decision made and reasoning
- Which tool/command was used
- Time spent (approximate)

## Key Files

| File | Role |
|------|------|
| `openspec/changes/fleeting-notes-automation/session-log.md` | Running log of this session |
| `openspec/changes/fleeting-notes-automation/proposal.md` | Already created — the "why" |
| `~/.claude/projects/.../ a4bb68de...jsonl` | Raw session transcript |
| `~/Documents/ai_assistant/inbox.md` | Exocortex inbox (items to triage) |
| `~/Documents/ai_assistant/fleeting/` | Raw fleeting notes |
| `~/Documents/vvault/0a. Daily Notes/2026/03-March/2026-03-07-Saturday.md` | Today's daily note |

## How It Works In Practice

1. Before we start processing, I snapshot everything (Things inbox, fleeting notes, inbox.md, daily note)
2. As you process each item, I record what you did in session-log.md
3. After each stage completes, I update session-log.md with a stage summary (objects changed, decisions, patterns)
4. At the end of the session, I distill the session log into the workflow spec
5. The OpenSpec design.md and tasks.md get written based on what we learned

## Persistence of Plans

Claude Code plan files (`~/.claude/plans/`) are ephemeral. To ensure this plan and any future plans created during the session are part of the permanent record:

- **Copy this plan** into `openspec/changes/fleeting-notes-automation/plans/` with a timestamp in the filename (e.g., `plan-2026-03-07T0912-recording-method.md`)
- **Reference it** from session-log.md so the log links back to the plan that governed recording
- Mid-session plan revisions become new timestamped files (not overwrites) so we can see how the plan evolved
- Each plan file starts with a `Created: <ISO timestamp>` header

This way the OpenSpec change directory is the single source of truth:
```
openspec/changes/fleeting-notes-automation/
  .openspec.yaml          # OpenSpec metadata
  proposal.md             # Why (already created)
  recording-plan.md       # This plan (copied from ~/.claude/plans/)
  session-log.md          # Running structured log (created at start)
  specs/                  # Distilled workflow spec (created at end)
  design.md               # How to automate (created at end)
  tasks.md                # Implementation tasks (created at end)
```

## Verification

- session-log.md should contain timestamped entries for every processing action
- Each object (Things item, fleeting note, inbox entry) should have a before/after state recorded
- The workflow spec should be derivable purely from the session log (no lost information)
- recording-plan.md exists in the OpenSpec change dir and matches the governing plan
