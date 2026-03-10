# Daily Note Fleeting Notes Format

This file defines the format for fleeting notes sections in daily notes.

## Structure

```markdown
## Fleeting Notes

### Unprocessed ({count} from {source})

1. **{Item title}** ({YYYY-MM-DD}) [[Fleeting/{year}/{month}/{day}/{slug}|f-note]]
    **Notes:** {verbatim text, if short}
    **Proposed:** {AI routing proposal}
    **Chat:** {one-line summary of prior agent conversation, if any}
    - [ ] Retire
    **Response:**
    <!-- r -->
    <!-- /r -->
    - [ ] Process

- [ ] Process All

### Routed

- **{title}** → {description} — [[...|f-note]] → [[...|pr-note]]
```

## Rules

### Item format
- Numbered list (`1.`, `2.`, etc.)
- All sub-content (Notes, Summary, Proposed, checkboxes, Response) indented with **4 spaces**. This ensures consistent alignment for both single-digit (`1.`) and double-digit (`10.`) items. Never use 3-space indentation.
- Title in bold: `**{title}**`
- Date in parentheses: `({YYYY-MM-DD})`
- Link to fleeting note file using short symbol: `[[Fleeting/{year}/{month}/{day}/{slug}|*]]`
  - The `|*` alias renders as a clickable `*` in Obsidian reading mode — minimal but navigable
  - Every item MUST have a corresponding fleeting note file and a `[[...|*]]` link
- **Notes:** (bold) — verbatim text from the source, on the next line, indented. Used when the original is 2 lines or less.
- **Summary:** (bold) — AI-generated summary, kept to 2 lines max. Used when the original is longer than 2 lines. The fleeting note file (`[[...|*]]`) always has the full verbatim text.
- **Proposed:** (bold) — AI routing proposal on the next line, indented. Must be generated for every item at ingestion time (never left as "pending"). See **Routing proposal generation** below for the method.

### Routing proposal generation

Every unprocessed item MUST have a real routing proposal when it appears in the daily note. Proposals are generated at ingestion time using a two-tier system:

**Tier 1 — Heuristics (fast, deterministic):**
- `@tag` in title/body → match against project registry routing rules
- URL present → literature note
- Action verb + matched project → #task
- Test/stale + short → retire
- Matched project but no action → permanent note

**Tier 2 — LLM via `claude -p` (when heuristics fail):**
- Called when heuristics can't match a project or determine a conversion path
- Receives: note title, body, created date, full project registry (names, aliases, routing keywords)
- Returns: `{project, type, description}` as JSON
- The LLM sees all projects and can match based on semantic understanding (e.g. "Venus note" → Venus Mars project)
- Falls back to a generic "unmatched" proposal if the LLM call fails or times out (30s)

Implementation: `generateProposal()` in `daily-note.ts` → `generateHeuristicProposal()` → if null, `generateLLMProposal()` from `agent-route.ts`

```gherkin
Feature: AI routing proposal generation

  Scenario: Generating a routing proposal for a fleeting note
    Given a fleeting note with title and optional notes/body
    And the project registry is available
    When the agent creates the daily note entry
    Then the **Proposed:** field MUST contain a concrete routing proposal
    And the proposal MUST NOT be deferred (e.g. "pending", "TBD")

  Scenario: Heuristic matching succeeds
    Given a fleeting note with content matching a routing rule or keyword pattern
    When the heuristic proposal generator runs
    Then it returns a proposal immediately (no LLM call)
    And the proposal includes the matched project and conversion path

  Scenario: Heuristic matching fails — LLM fallback
    Given a fleeting note with no @tags, no URL, no action verbs, and no matched project
    When the heuristic proposal generator returns null
    Then `claude -p` is called with the note content and full project registry
    And the LLM returns a project match and conversion path
    And the proposal is built from the LLM response

  Scenario: LLM call fails — ultimate fallback
    Given the LLM call times out or returns unparseable output
    When the proposal generator handles the error
    Then a generic "No project match. Permanent note — unmatched idea, awaiting triage." proposal is used
    And the note still appears in the daily note (never dropped)

  Scenario: Matching to a registered project
    Given a fleeting note with content
    When the agent generates a routing proposal (heuristic or LLM)
    Then the agent MUST consult the project registry (aliases, routing tags, descriptions)
    And if a project matches, state it explicitly: "Project {name}."
    And if no project matches, state: "No project match."

  Scenario: Proposing a conversion path
    Given a fleeting note matched (or not) to a project
    When the agent writes the proposal
    Then the proposal MUST include one of the conversion paths:
      | Path | When to propose |
      | #task (project note) | Action items, replies, to-dos, things to do |
      | Permanent note | Insights, reflections, atomic thoughts worth keeping |
      | Literature note + permanent note | Notes referencing external sources (URLs, articles) |
      | Idea log entry | Raw ideas not yet actionable |
      | Draft | Long-form creative content needing its own directory |
      | Retire | Stale items, duplicates, test items, items with no context |
    And if the item is clearly stale (date plan from weeks ago, completed chore), pre-check Retire

  Scenario: Ambiguous items
    Given a fleeting note where the routing is unclear
    When the agent writes the proposal
    Then the agent MUST still propose a best guess with reasoning
    And offer alternatives (e.g. "Retire if context is lost, or route to X if still relevant")
    And NEVER leave the proposal blank or deferred
```

**Proposal quality guidelines:**
- Start with the project name: "Project Networking." or "No project match."
- State the conversion path: "#task —", "Permanent note —", "Idea log entry —", "Retire —"
- Add a brief description of what would be created
- For stale items (created weeks ago with no context), pre-check `[x] Retire` as a suggestion
- For items with URLs, propose literature note unless context suggests otherwise
- For items that are clearly people-related actions (reply, talk to, invite), propose Networking #task

### Per-item action controls

Each item has a Retire checkbox, a unified Response field, and a Process button:

```markdown
    - [ ] Retire
    **Response:**
    <!-- r -->
    {user text here — routing instructions, questions, or conversation}
    <!-- /r -->
    - [ ] Process
```

- **Retire** — marks intent to retire. Requires Process to confirm.
- **Response** — unified free-text field between `<!-- r -->` / `<!-- /r -->` HTML comment delimiters. Supports multi-line content. The agent interprets the text to decide what to do (see Agent response interpretation below).
- **Process** — confirms and executes. Required for all actions except none.
- **Process All** — bulk confirm for all remaining items, placed after all numbered items.

Priority when Process is clicked:
1. If Retire is checked → retire (ignore Response)
2. If Response has text → agent interprets it (see below)
3. If Response is empty → execute proposal as-is

### Agent response interpretation

When the user writes in the Response field and clicks Process, the agent reads the text and decides:

```gherkin
Feature: Unified Response field with LLM interpretation

  Scenario: Response text with Process checked
    Given a Response field containing any text
    When the user clicks Process
    Then the agent ALWAYS sends the text to `claude -p` for interpretation
    And no deterministic keyword matching is attempted
    And the LLM returns either a routing decision or a conversational reply

  Scenario: LLM decides to route
    Given the LLM determines the Response is a routing instruction
    Examples: "todo in Chores", "permanent note", "retire", "send to workshop"
    When it returns a routing decision
    Then the agent executes the routing
    And the item moves to Routed

  Scenario: LLM decides to reply (conversation needed)
    Given the LLM determines the Response is a question or needs clarification
    Examples: "is this related to the workshop?", "not sure about this"
    When it returns a conversational reply
    Then the agent appends the exchange to the fleeting note's ## Chat section
    Then the agent updates the daily note **Chat:** line with a one-line summary
    And the agent unchecks Process (note stays unprocessed)
    And the fleeting note status remains "raw"
    And the note continues to appear in Unprocessed until explicitly routed

  Scenario: LLM call fails
    Given the `claude -p` call times out or returns unparseable output
    When the agent handles the error
    Then the agent falls back to executing the proposal as-is
    And the item is routed as permanent note (safe default)

  Scenario: No response, no Retire — execute proposal
    Given an empty Response field and Retire unchecked
    When Process is clicked
    Then the agent executes the proposal as-is (accept)
    And no LLM call is made

  Scenario: Process All with mixed items
    Given Process All is checked
    When the agent processes all items
    Then each item is handled per its own Response/Retire state
    And items with Response text get LLM interpretation
    And items without Response get proposal executed
```

### LLM response interpretation

When the user writes in the Response field and clicks Process, the text is **always** sent to the LLM (`claude -p`) for interpretation. There is no deterministic keyword matching — the LLM handles all response text, whether it's a clear routing instruction ("todo in chores") or an ambiguous question ("is this related to the workshop?").

**Rationale:** Keyword matching was too greedy (e.g. the word "note" in casual text triggered permanent note routing). The LLM provides better judgment for all cases, and the 30s overhead is acceptable since routing is user-initiated.

### LLM prompt context

`claude -p` is called with:

- Fleeting note title and body
- Current proposal text
- User's Response text
- Prior chat history (from fleeting note ## Chat section)
- Project registry (names, aliases, descriptions)
- Instruction: return JSON `{ "action": "route"|"reply", "type": "task"|"permanent"|..., "project": "...", "message": "..." }`

### Chat section in fleeting notes

The fleeting note file stores the full conversation history:

```markdown
---
status: raw
created: 2026-03-09
project: AI Finance
---

# @onto Kalman filters...

## Chat
**User (2026-03-09):** is this related to the workshop?
**Agent (2026-03-09):** Based on the @onto tag and content, this fits AI Finance as a permanent note. Route there?
```

The daily note shows only a one-line summary:
```markdown
    **Chat:** AI Finance confirmed. Route as permanent? [[...|f-note]]
```

The **Chat:** line only appears after the first agent reply. It's not present initially.

### Processing flow

When the agent processes decisions:
1. Reads each item's state: Retire checkbox, Response text, Process checkbox
2. Applies deterministic routing or calls LLM as needed
3. For routed items: creates destination files, updates fleeting note frontmatter
4. Moves items from Unprocessed to Routed
5. Unchecks Process and clears Response for routed items
6. For conversation items: appends to fleeting note Chat section, updates daily note Chat line, unchecks Process

### Sections
- **Unprocessed** — items awaiting triage. Header includes count and source.
- **Routed** — items that have been processed. Single-line format:

```markdown
- **{title}** → {description} — [[...|f-note]] → [[...|pr-note]] → [[...|todos]]
```

Each entry has:
  - Title in bold + arrow `→` + description (project name, routing type)
  - Em dash `—` separator
  - Link chain showing the full path from source to destination, using short labels:
    - `f-note` = fleeting note (source)
    - `pr-note` = project note
    - `pe-note` = permanent note
    - `l-note` = literature note
    - `todos` = project todos.md
  - Links use `→` between steps, `+` when multiple destinations (e.g. permanent + literature)
  - For retired items: only the `f-note` link (no destination)

Examples:
```markdown
- **Pedro reply** → Networking as #task — [[...|f-note]] → [[...|pr-note]] → [[...|todos]]
- **Hannibal on Ai** → AI Safety as permanent + literature note — [[...|f-note]] → [[...|pe-note]] + [[...|l-note]]
- **Apply?** → retired — [[...|f-note]]
```

### Movement
- Items move from Unprocessed to Routed as they are processed
- When an item is routed, it is removed from Unprocessed and appended to Routed
- The Unprocessed count is updated
- This gives a visual sense of flow in the daily note

### Carryover
- Unprocessed items carry forward to the next day's daily note until they are routed
- Each day's Fleeting Notes section shows BOTH:
  - New fleeting notes added that day (from Things Today or other sources)
  - Previously unprocessed fleeting notes from prior days that still haven't been routed
- The source of truth for what's unprocessed is the fleeting note frontmatter (`status: raw`)
- Items do not disappear just because a new day starts — they repeat until acted on

### Fleeting note link requirement
- Every item in the daily note MUST link to a fleeting note file via `[[Fleeting/{year}/{month}/{day}/{slug}|*]]`
- The fleeting note file is the ground truth for the item
- If no fleeting note file exists yet, one must be created before the item appears in the daily note

### Fleeting note content completeness

Constraints use Gherkin format where appropriate.

```gherkin
Feature: Fleeting note ingestion from Things

  Scenario: Ingesting a Things item with both title and notes
    Given a Things item with a non-empty "title" field
    And the Things item has a non-empty "notes" field
    When the item is ingested as a fleeting note
    Then the fleeting note heading MUST contain the full title verbatim
    And the fleeting note body MUST contain the full notes text verbatim
    And neither title nor notes may be truncated or omitted

  Scenario: Ingesting a Things item with title only
    Given a Things item with a non-empty "title" field
    And the Things item has an empty "notes" field
    When the item is ingested as a fleeting note
    Then the fleeting note heading MUST contain the full title verbatim
    And the body may be empty

  Scenario: Daily note summary references fleeting note content
    Given a fleeting note with body content
    When creating the daily note entry
    Then the Notes/Summary field MUST reflect the full content (title + body)
    And the fleeting note link provides access to the complete verbatim text
```

Implementation note: Things CLI `--format json` output includes a `notes` field. Always use JSON format when ingesting to capture both `title` and `notes`. The default table view omits notes.

### Things lifecycle

When a Things item is ingested as a fleeting note in Obsidian, it must be marked as completed in Things. The three places fleeting notes exist:

1. **Things** — the capture source (where the note originates)
2. **Obsidian fleeting note file** — the ground truth (`Fleeting/{year}/{month}/{day}/{slug}.md`)
3. **Obsidian daily note** — the visible summary surface

```gherkin
Feature: Things item completion on ingestion

  Scenario: Things item is ingested as a fleeting note
    Given a Things item in Today (or being processed from Ingested)
    When the item is ingested and a fleeting note file is created in the vault
    Then the Things item MUST be marked as completed
    And the fleeting note file is now the source of truth for the item
    And the Things item serves only as an origin record

  Scenario: Things item already has a fleeting note
    Given a Things item whose UUID matches an existing fleeting note
    And the fleeting note has status "raw", "completed", or "retired"
    When the sync runs
    Then the Things item MUST be marked as completed if it is not already
    And no duplicate fleeting note is created
```

Implementation note: `things update --id <UUID> --completed` requires a Things auth token. Run `things auth` or set `THINGS_AUTH_TOKEN` environment variable. See Things > Settings > General > Things URLs.

### Integrity checks (post-processing)

After processing a batch of routing decisions, run these checks:

```gherkin
Feature: Fleeting notes pipeline integrity

  Scenario: No orphan completed notes
    Given all fleeting notes have been processed
    When an integrity check runs
    Then every note with `status: completed` MUST have a `converted_to:` field
    And the file referenced by `converted_to:` MUST exist on disk
    And the destination note MUST have a `fleeting:` field pointing back

  Scenario: No raw notes remain after batch processing
    Given a batch of routing decisions has been executed
    When the batch is fully processed
    Then zero fleeting notes should have `status: raw`
    And the daily note Unprocessed count should be 0

  Scenario: Case-consistent paths
    Given a destination note is created
    When the directory path is constructed
    Then directory names MUST use lowercase (e.g. `notes/`, not `Notes/`)
    And this MUST match the wiki link path exactly
    And case mismatches will break on case-sensitive filesystems (Linux containers)
```

**Known issue (2026-03-07):** 8 orphan notes found with `status: completed` but missing `converted_to:`. Root cause: batch processing in earlier sessions marked status without adding the link field. Fixed retroactively. The checks above prevent recurrence.

### Append behavior
- Start new sections with `---` separator
- Section headers include a timestamp of when the append happened
- If updating an existing section, add `updated ~{HH:MM} {TZ}` to the header
- Never rewrite or delete existing content — only append and move between sections
