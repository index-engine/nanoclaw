## Why

Fleeting notes — quick captures from Things inbox, Telegram capture group, and daily observations — accumulate faster than they get processed. The current pipeline ingests them but doesn't structure, route, or action them. Processing happens manually in Obsidian, following a method that hasn't been documented or automated. By recording the manual workflow first, we can identify the stages, key documents, and decision points, then progressively automate them.

This is a "record first, automate later" change: today's session captures the method; future work implements it.

## What Changes

- Record the complete fleeting notes processing workflow as it happens (stages, decisions, artifacts produced)
- Document the two key objects: Things status and Obsidian daily note status
- Identify processing stages and the transformations between them (capture → triage → route → integrate)
- Produce a workflow specification that can drive future automation
- The plan itself evolves during the session — both "what we record" and "how we record it" are living concerns

## Capabilities

### New Capabilities
- `fleeting-notes-workflow`: Documents the manual fleeting notes processing method — stages, inputs, outputs, decision points, and key documents produced
- `session-recording`: Method for recording an interactive workflow session — what to capture, where to store observations, how to update the plan as understanding evolves

### Modified Capabilities
- `things-sync`: Will eventually be modified to support the automated workflow (not changed today, but informed by today's recording)
- `obsidian-sync`: Will eventually be modified to support automated note routing (not changed today, but informed by today's recording)

## Constraints

- **Daily notes are append-only** — never rewrite or modify existing content in a daily note. Only append to the end, and always note when and what was appended.
- Append blocks should include a timestamp and source identifier so the user can tell what added them and when.
- Processing stages (triage, route, integrate) may reference daily note content but must not alter it.
- **No items may be missed** — completeness is mandatory. Every item from a source must be represented. If an item is missing, investigate why before proceeding. Partial snapshots are failures.
- **Full representation** — notes, descriptions, and metadata must be shown in full. Never truncate content. If an item has notes attached, the full notes text must appear.
- **Things Today is the sole input source** — going forward, ingestion pulls only from Things Today. Inbox is not a processing source for the automation pipeline (items reach Today via Things' own scheduling).
- **One-way links only** — link from the referencing note (e.g. daily note) to the target (e.g. fleeting note). Do NOT manually create reverse links. Obsidian's backlinks panel handles the reverse direction automatically. (Decision: 2026-03-07)
- **Route by linking** — routing a note means creating an Obsidian `[[wiki link]]` from the note to its destination (project, area, etc.). The original note with its link is the source of truth — content may be duplicated at the destination for readability, but the original always remains.
- **Short link symbols** — when linking from daily notes or summaries to fleeting notes, use `[[path|*]]` syntax so the link renders as a minimal `*` rather than the full filename. Keeps the daily note readable.
- **Source of truth is the original note file** — the fleeting note file (e.g. `Fleeting/2026/03/07/pedro-reply.md`) is always the ground truth. Text duplicated elsewhere (daily notes, project pages, summaries) is for readability only. Before acting on a note — routing, editing, processing — always read the original file, never rely on downstream copies. Downstream representations may be stale, truncated, or reformatted.

## Fleeting Notes Storage

- **Path pattern:** `Fleeting/{year}/{month}/{day}/{slug}.md` (e.g. `Fleeting/2026/03/07/pedro-reply.md`)
- **Frontmatter:** `source`, `created`, `things_uuid`, `status` (raw → triaged → routed → processed)
- Old flat structure (`Fleeting/2026-03-03-001-*.md`) is legacy; new notes use the nested year/month/day structure.

## Project Registry

The project registry lives at `~/Documents/vvault/1. Projects/registry.md`. It is the source of truth for:
- What projects exist and are active
- Aliases (alternative names a project may be referred to by)
- Vault paths and evergreen file locations
- GitHub repos associated with each project
- Routing rules (which tags/keywords map to which projects)

Registered projects: Networking, NanoClaw, Venus Mars, AI Finance, AI Business and Society, Workshop, Innovation.

## Append Format (universal)

All appends — to daily notes, evergreen notes, or any other file — use the same structure:

```markdown
---

## {Section Title} (appended {YYYY-MM-DD} ~{HH:MM} {TZ})

- **{Item title}** ({YYYY-MM-DD}) [[Fleeting/{year}/{month}/{day}/{slug}|*]]
  **Notes:** {full notes text, if any}
  **Proposed:** {routing proposal, if applicable}
```

Rules:
- Start with `---` separator
- Section header includes a timestamp of when the append happened
- Each item shows title, date, and a `[[...|*]]` link to the source note
- Full notes text below the item (never truncated)
- If updating an existing append block, add a new timestamp to the header (e.g. `updated ~{HH:MM} {TZ}`) rather than removing the original
- This format is the same whether appending to daily notes, evergreen notes, or any other document — consistency enables downstream processing

## Evergreen Notes Format

Evergreen notes use date headers (`# YYYY_MM_DD_DayName`) with freeform content appended underneath. This format is suitable for both humans and AI:
- Date headers allow subsetting by date range
- Freeform content under each date is natural language (LLM-friendly)
- New content is always appended under a new date header — never modifies existing entries
- No additional markup needed for AI use; the date-structured format is already parseable

## Key Objects for Fleeting Notes Processing

| Object | Location | Role |
|--------|----------|------|
| Project Registry | `~/Documents/vvault/1. Projects/registry.md` | Source of truth for project names, aliases, vault paths, evergreen files, GitHub repos, and routing rules. Must be consulted before routing any note. |
| Daily Note | `~/Documents/vvault/0a. Daily Notes/{year}/{month}/{date}.md` | Append-only summary surface. Links to fleeting notes via `[[...\|*]]`. |
| Fleeting Notes | `~/Documents/vvault/Fleeting/{year}/{month}/{day}/{slug}.md` | Ground truth for captured items. Frontmatter tracks lifecycle status. |
| Evergreen Notes | Per-project (see registry) | Long-lived project notes. Append under date headers, never modify existing content. |

## Active Objects (session continuity)

These are the live objects and their last known states, so context survives across session clears:

| Object | Location | Last Known State |
|--------|----------|-----------------|
| Things Today | `things today` | 119 items total (sole input source) |
| Exocortex Inbox | `~/Documents/ai_assistant/inbox.md` | 2 unrouted items (@ei, @consulting) |
| Fleeting Notes (exocortex) | `~/Documents/ai_assistant/fleeting/` | 9 files, all retired/incorporated |
| Fleeting Notes (vault) | `~/Documents/vvault/Fleeting/2026/03/07/` | 5 new notes created from Things Today |
| Daily Note | `~/Documents/vvault/0a. Daily Notes/2026/03-March/2026-03-07-Saturday.md` | Morning check-in + snapshot with [[*]] links to fleeting notes |
| Session Log | `openspec/changes/fleeting-notes-automation/session-log.md` | Stage 1 complete, Stage 2 in progress |
| Claude Code Session | `a4bb68de-bf1d-4e8f-b990-7003398142e6` | Active |

## To-Do Architecture (Zettelkasten-aligned)

### Note Type Mapping

| Ahrens Category | System Category | Location |
|-----------------|----------------|----------|
| Fleeting note | Fleeting note | `Fleeting/{year}/{month}/{day}/{slug}.md` |
| Permanent note | Permanent note (insight) | `2. Areas/{topic}/{slug}.md` |
| Project note | To-do / project-scoped note | `{project}/notes/{year}/{month}/{day}/{slug}.md` |
| Literature note | Literature note (source material) | `2. Areas/{topic}/literature/{author-slug}.md` |

### Conversion Paths

Fleeting notes convert via two paths (or both, or discard):

1. **Fleeting -> permanent note** (insight worth keeping) — rewrite in own words, link to slip-box
   - **Constraint:** AI cannot create permanent notes alone. User must provide brain dump or confirm AI's proposed rewrite.
   - Permanent notes live in `2. Areas/{topic}/` — organized by topic, not project. They outlive any project.
2. **Fleeting -> permanent note + literature note** (insight from a source) — both are created:
   - Literature note: selective paraphrase at top (your reading), full source text below (preservation against link rot). Lives in `2. Areas/{topic}/literature/`.
   - Permanent note: your atomic insight, links to the literature note. Lives in `2. Areas/{topic}/`.
   - Fleeting note frontmatter gets both `converted_to:` and `literature_note:` links.
3. **Fleeting -> project note / to-do** (action item) — create project note in `{project}/notes/{year}/{month}/{day}/{slug}.md`, add `#task` to the project note (collected by `todos.md` query block)
4. **Fleeting -> retired** (no action needed) — mark `status: retired`, no destination created

Paths 1-3 mark the fleeting note as `status: completed` and add `converted_to:` frontmatter linking to the destination.

### Processing Constraint

AI **proposes** routing decisions but does not execute them automatically. The user reviews and confirms before any note is created, moved, or marked completed. This is a hard constraint until explicitly relaxed.

### Things Ingestion (future change)

- **Long-term:** Things Today is the sole ingestion source. No other Things views are used.
- **Completion model:** When a note is ingested and routed, it gets marked as **completed in Things** (not moved to an "ingested" list). This replaces the current NanoClaw ingestion setup that moves notes to an ingested state.
- Current `things-sync.ts` will need to be updated to use this model.

### Literature Notes

Literature notes preserve the original source material. Structure:
- **Body:** The actual full text of the source — not a paraphrase, not a summary. The real text, preserved against link rot.
- **Frontmatter:** `author`, `date`, `url`, `type: literature-note`
- **Constraint:** Literature notes must contain the verbatim source text. AI summarization is not acceptable — the point is preservation.
- **Constraint:** When WebFetch is used (which AI-summarizes content), the note must clearly state that the text is a WebFetch summary, not verbatim. E.g. `> Note: This text was retrieved via WebFetch and may be AI-summarized, not verbatim.`
- Future: an agent fetches the raw article text (not AI-processed) and creates the literature note automatically

### Permanent Notes

Permanent notes capture YOUR insight — atomic, in your own words, standing alone without context. They:
- Live in `2. Areas/{topic}/` (organized by topic, not project — they outlive projects)
- Body is **only your text** — no source links, no references, no citations in the body
- Connection to literature notes lives in frontmatter (`literature:` field) — machine-readable, body stays clean
- Link to other permanent notes (future: agent proposes connections based on semantic similarity)
- Are never tied to a completion state — they're part of the growing slip-box

### `#task` Global Filter

The Obsidian Tasks plugin's global filter is set to `#task`. Only `- [ ] #task ...` checkboxes are tracked as tasks. All legacy open checkboxes have been mass-completed (2026-03-07).

- Tasks plugin queries collect `#task` items across the vault
- Completing a task in a query view auto-updates the source file
- Config: `.obsidian/plugins/obsidian-tasks-plugin/data.json`

### Per-Project `todos.md`

Each active project gets a `todos.md` with:
- A Tasks plugin query block (auto-collects `#task` items from the project directory)
- Manually appended to-do items using the standard append format
- Links to project notes via `[[...|*]]`

### AI Pre-Processing (future)

When converting fleeting notes into project notes, an AI pre-processing step should:
- Check the relevant repo for what's already implemented
- Assess scope and feasibility
- Surface related existing work, specs, or proposals
- Turn raw captures into grounded, actionable project notes rather than aspirational to-dos
- For URL-bearing fleeting notes: fetch article text, draft a literature note with "My reading" section for user confirmation

### Routing Agent (future)

A dedicated agent that handles fleeting note routing. It:
- Has its own explicit goals file (what routing decisions to optimize for, how to prioritize)
- Proposes routing decisions (project note, permanent note, literature note, retire) — does not execute without user confirmation
- Reads the project registry, existing project notes, and permanent notes to inform proposals
- Could incorporate the AI pre-processing step (check repos, assess feasibility) as part of its routing proposal
- Operates on its own cadence (e.g. when new fleeting notes arrive)

### Connection Agent (future)

An agent that periodically scans permanent notes and proposes `[[links]]` between them based on semantic similarity. This builds the slip-box's web of connections — the core value of Zettelkasten. The agent proposes; the user confirms.

### Reconciliation (future)

When a `#task` is checked complete in a downstream file, periodically confirm with the user whether the source should also be updated.

### Daily Note Structure

The daily note's Fleeting Notes section shows movement:
- **Unprocessed** — items from Things Today still awaiting triage
- **Routed** — items that have been converted (project note, retired, etc.)

Items move from Unprocessed to Routed as they're processed, giving a visual sense of flow.

## Impact

- Mass-completed ~2,700 stale open checkboxes across the vault (2026-03-07)
- Configured Obsidian Tasks plugin with `#task` global filter
- Created Networking `todos.md` and project note structure
- End-to-end test: Pedro Reply fleeting note -> Networking project note -> todos.md
- Future impact: changes to things-sync.ts, obsidian-sync.ts for automated fleeting note conversion
- Tools used: `things` CLI, `obsidian-cli`, direct file reads of Obsidian vault and Things DB
