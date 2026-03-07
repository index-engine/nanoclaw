# Fleeting Notes Processing Session Log

Session: 2026-03-07
Plan: [plan-2026-03-07T0912-recording-architecture.md](plans/plan-2026-03-07T0912-recording-architecture.md)
Raw transcript: `~/.claude/projects/-Users-nanoclaw-Documents-nanoclaw/a4bb68de-bf1d-4e8f-b990-7003398142e6.jsonl`

---

## Stage 1: Snapshot (2026-03-07 ~09:15 EST)

### Things Inbox
- **1 item** — empty title (UUID: 3XqjHcg7yzN7cjjFGgXdFa), status: incomplete
- `things_inbox.json`: empty array `[]` (sync pipeline has already consumed or nothing new)

### Things Today
- Large list of items (many tasks across projects)
- Not individually enumerated — focus is on inbox processing

### Exocortex Inbox (`~/Documents/ai_assistant/inbox.md`)
- **2 unrouted items** in "Unrouted — No project exists for these tags":
  1. `@ei` — "Need to reply to Adam" (from Things, 2026-03-04)
  2. `@consulting` — "AI in Europe" with LinkedIn link (from Things, 2026-03-04)
- **1 processed section** from 2026-03-06 (archived, read-only reference)

### Fleeting Notes (`~/Documents/ai_assistant/fleeting/`)
- **9 files**, all from 2026-03-03 to 2026-03-05
- All have been previously processed (status: `retired` or `incorporated` in frontmatter)
- Breakdown:
  | File | Status | Project | Content |
  |------|--------|---------|---------|
  | `2026-03-03-001-today-exam-ud-onto-claw.md` | retired | nanoclaw | Cryptic fragment |
  | `2026-03-03-002-nanoclaw-notes-in-context-of-what.md` | incorporated | nanoclaw | Agent needs context notes |
  | `2026-03-03-003-nanoclaw-is-should-have-an-agent.md` | incorporated | nanoclaw | Agent prepares prompts for projects |
  | `2026-03-03-004-nanoclaw-ingest-from-email-too-goal.md` | incorporated | nanoclaw | Email ingestion goal |
  | `2026-03-04-001-onto-test.md` | retired | onto | Test message |
  | `2026-03-05-001-test-capture-ingestion.md` | retired | general | Test message |
  | `2026-03-05-002-test-from-things-2026-02-23.md` | retired | general | Test message |
  | `2026-03-05-003-prepend-test-nanoclaw.md` | retired | nanoclaw | Test message |
  | `2026-03-05-004-nanoclaw-not.md` | retired | nanoclaw | Unclear fragment |

### Daily Note (`~/Documents/vvault/0a. Daily Notes/2026/03-March/2026-03-07-Saturday.md`)
- Exists with morning check-in filled in
- Main focus: therapy with Casey, F1 qualifying, nanoclaw work, systems thinking homework
- Other sections (constraint, how Index can help, methods, success criteria, notes) are empty

### Snapshot Summary

| Container | Count | State |
|-----------|-------|-------|
| Things Inbox | 1 item (empty title) | needs triage |
| Exocortex Inbox | 2 unrouted items | needs routing |
| Fleeting Notes | 9 files (all previously processed) | clean — no new work |
| Daily Note | partially filled | morning check-in done |

**Key observation:** The fleeting notes directory contains only previously-processed notes (all retired/incorporated from 2026-03-05). No new fleeting notes have arrived since then. The active work is in the exocortex inbox (2 unrouted items) and the Things inbox (1 empty item).

---

## Stage 2: Triage (2026-03-07 ~09:30 EST)

### Action 2a: Append Things snapshot to daily note (first attempt)

- **What:** Appended 5 latest Today items and 1 inbox item to the daily note
- **Issue 1 — Missing item:** "Pedro reply" (created 2026-03-07 08:13) was in Things Today but not in the first snapshot. Root cause: the `things today --json` call returned data sorted by `today_index`, and the python sort by `created` descending showed items from 2026-03-03 first because "Pedro reply" had just been added and the CLI data was stale or the sort missed it due to empty-title items being interleaved.
- **Issue 2 — Truncated notes:** "Nanoclaw describe evergreen notes" had a long notes field that was cut off at 60 chars. Full notes must always be shown.
- **Constraint discovered:** Daily notes must be append-only — never rewrite existing content, always include timestamp of append

### Action 2b: Fix daily note append (correction)

- **What:** Replaced the appended section with corrected data — full notes, Pedro reply included, inbox removed (Today is the sole source)
- **Constraints documented in proposal:**
  1. Daily notes are append-only
  2. No items may be missed — completeness is mandatory
  3. Full representation — never truncate notes or metadata
  4. Things Today is the sole input source (not inbox)
- **Objects changed:**
  - Daily note: corrected append block (Pedro reply added, full notes shown, inbox section removed)
  - Proposal: 3 new constraints added, Active Objects table updated (inbox removed as source)
- **Decision:** Going forward, ingestion only pulls from Things Today. Inbox items are not part of the automation pipeline.

### Action 2c: Research Obsidian linking best practices (~09:40 EST)

- **Question 1:** Should we create manual two-way links (A→B and B→A)?
  - **Answer: No.** Obsidian's backlinks panel automatically tracks reverse links. When daily note links to a fleeting note, the fleeting note's backlinks panel shows the daily note. Manual reverse links are redundant and create maintenance burden.
  - **Decision:** One-way links only. Link from referencing note to target. (Recorded in proposal)

- **Question 2:** Can wiki links show a short symbol instead of the filename?
  - **Answer: Yes.** `[[path/to/note|*]]` renders as clickable `*` in reading mode. Standard Obsidian pipe alias syntax.
  - **Decision:** Use `[[path|*]]` for fleeting note links in daily notes. (Recorded in proposal)

### Action 2d: Create fleeting notes and link from daily note (~09:45 EST)

- **What:** Created 5 fleeting note files in `Fleeting/2026/03/07/` (new year/month/day directory structure), then updated the daily note append block with `[[...|*]]` links to each.
- **Fleeting notes created:**
  | File | Things UUID | Source Title |
  |------|-------------|-------------|
  | `pedro-reply.md` | YSS1cKQnHBZuGHEdJYTmZm | Pedro reply |
  | `apply.md` | 2aWtQbFZ6R2Kdo25E7ffhT | Apply? |
  | `nanoclaw-describe-evergreen-notes.md` | BEs4SYMXqu4yvtfa6qyTw5 | Nanoclaw describe evergreen notes |
  | `venus-mars.md` | 6oiuuvnynQVTRQeWENhij3 | Venus mars |
  | `hannibal-on-ai.md` | LWB8gDYZhpWUB6u75NvFmG | Hannibal on Ai |
- **Frontmatter schema:** `source`, `created`, `things_uuid`, `status` (lifecycle: raw → triaged → routed → processed)
- **Storage convention:** `Fleeting/{year}/{month}/{day}/{slug}.md` — replaces old flat naming
- **Daily note updated:** each item now has `[[Fleeting/2026/03/07/slug|*]]` link after the title
- **Proposal updated:** Added Fleeting Notes Storage section, Project Registry section, 3 new linking constraints, updated Active Objects table

### Constraints and decisions documented in proposal (cumulative):
1. Daily notes are append-only
2. No items may be missed
3. Full representation (no truncation)
4. Things Today is the sole input source
5. One-way links only (backlinks panel handles reverse)
6. Route by linking (original note is source of truth)
7. Short link symbols (`[[path|*]]`)
8. Fleeting notes stored in `Fleeting/{year}/{month}/{day}/`
9. Project registry for routing rules
10. Original note file is always ground truth — never act on downstream copies without checking the source first

### Action 2e: Create project registry (~09:55 EST)

- **What:** Surveyed the full Obsidian vault structure (`1. Projects/`, `2. Areas/`) and existing evergreen files, then created `Projects/registry.md` as the machine+human readable project registry.
- **Vault survey findings:**
  | Project | Vault Location | Has Evergreen | GitHub |
  |---------|---------------|---------------|--------|
  | Networking | `1. Projects/Networking/` | no | none |
  | NanoClaw | `1. Projects/AI Assistant/` | yes | `index-engine/nanoclaw`, `index-engine/ai_assistant` |
  | Venus Mars | `1. Projects/Venus and Mars/` | yes | `vmeursault/venus_mars` |
  | AI Finance | `1. Projects/AI Finance/` | per-subdirectory | `vmeursault/intentional_ai_measurement` |
  | AI Business & Society | `2. Areas/02. Teaching/AI, Business, and Society/` | yes (directory of topic files) | `vmeursault/ai_business_society` |
  | Workshop | *(not yet created)* | no | `sam-braun/new-work-order-workshop-2026` |
  | Innovation | `1. Projects/Innovation/` | yes | `vmeursault/inno` |
- **Registry format:** each project is an `##` section with `**key:**` fields (aliases, vault, evergreen, github, status, routing). Trivially parseable by both humans and machines.
- **Evergreen format decision:** existing date-header format (`# YYYY_MM_DD_DayName`) is already suitable for AI — no changes needed. Date headers allow subsetting; freeform content is LLM-friendly. Always append, never modify existing entries.
- **Proposal updated:** Project Registry and Evergreen Notes Format sections rewritten.

---

## Stage 3: To-Do Architecture + Clean Slate (2026-03-07 ~afternoon)

### Session context
Continuing from Stage 2 (same change, new Claude Code session). Plan: implement to-do architecture with Zettelkasten alignment, mass-complete stale checkboxes, and process "Pedro Reply" as end-to-end test.

### Action 3a: Zettelkasten alignment analysis

Mapped the system's note types to Ahrens' categories:
- Fleeting notes = temporary captures (process within 1-2 days)
- Permanent notes = insights rewritten in user's own words (AI can propose, user must confirm)
- Project notes = action items / to-dos (live in project directory, die with the project)
- Key insight: to-dos are project notes, not permanent notes. "Reply to Pedro" belongs in `Networking/notes/`, not the slip-box.

### Action 3b: Mass-complete stale checkboxes

- Replaced `- [ ]` with `- [x]` across entire vault (excluding `Templates/`)
- ~2,700 checkboxes across 355 files completed
- Result: only Templates/ retains open checkboxes (54 in 2 template files — intentional)

### Action 3c: Configure Obsidian Tasks plugin

- Created `.obsidian/plugins/obsidian-tasks-plugin/data.json` with `globalFilter: "#task"`
- Only `#task`-tagged checkboxes are now tracked as tasks
- Clean separation: casual checkboxes vs. real tasks

### Action 3d: Process "Pedro Reply" (end-to-end test)

1. Read fleeting note `Fleeting/2026/03/07/pedro-reply.md` (ground truth)
2. Created project note: `1. Projects/Networking/notes/reply-to-pedro.md`
   - Frontmatter: `source: fleeting`, `created: 2026-03-07`, `project: networking`, `type: project-note`
   - Body: `- [ ] #task Reply to Pedro [[Fleeting/2026/03/07/pedro-reply|*]]`
3. Created `1. Projects/Networking/todos.md` with Tasks query block + manual task entry
4. Updated fleeting note: `status: completed`, `converted_to: [[1. Projects/Networking/notes/reply-to-pedro]]`, `project: networking`
5. Appended routing record to daily note

### Decisions documented in proposal (cumulative from Stage 2):
11. `#task` global filter for Obsidian Tasks plugin
12. Per-project `todos.md` with Tasks query blocks
13. Project notes live in `{project}/notes/` directory
14. AI cannot create permanent notes alone — user must confirm
15. Reconciliation (future): confirm source updates when downstream tasks complete

---

## Stage 4: Integrate

*(pending — future automation of the conversion pipeline)*

---

## Stage 5: Clean Up

*(pending)*

---

## Session Observations

- The vault had far fewer stale checkboxes than the initial 2,712 estimate (actual: ~2,700 across 355 files with some duplication in counting)
- Templates/ correctly excluded from mass-complete — preserves template checkboxes
- The `#task` filter elegantly solves the "checkbox overload" problem without requiring migration of existing content
- End-to-end test (Pedro Reply) validates the full fleeting -> project note -> todos.md pipeline
