# Daily Note Fleeting Notes Format

This file defines the format for fleeting notes sections in daily notes.

## Structure

```markdown
## Fleeting Notes (appended {YYYY-MM-DD} ~{HH:MM} {TZ})

### Unprocessed ({count} from {source})

1. **{Item title}** ({YYYY-MM-DD}) [[Fleeting/{year}/{month}/{day}/{slug}|*]]
   **Notes:** {verbatim text, if short}
   **Summary:** {AI summary in 2 lines, if long}
   **Proposed:** {AI routing proposal, if applicable}

{human response area — blank space for routing decisions}

### Routed

- **{Item title}** → {description} — [[...|f-note]] → [[...|pr-note]] → [[...|todos]]
```

## Rules

### Item format
- Numbered list (`1.`, `2.`, etc.)
- Title in bold: `**{title}**`
- Date in parentheses: `({YYYY-MM-DD})`
- Link to fleeting note file using short symbol: `[[Fleeting/{year}/{month}/{day}/{slug}|*]]`
  - The `|*` alias renders as a clickable `*` in Obsidian reading mode — minimal but navigable
  - Every item MUST have a corresponding fleeting note file and a `[[...|*]]` link
- **Notes:** (bold) — verbatim text from the source, on the next line, indented. Used when the original is 2 lines or less.
- **Summary:** (bold) — AI-generated summary, kept to 2 lines max. Used when the original is longer than 2 lines. The fleeting note file (`[[...|*]]`) always has the full verbatim text.
- **Proposed:** (bold) — AI routing proposal on the next line, indented. Only present when AI has proposed routing. Must include:
  - The proposed routing action (project note, permanent note, retire, etc.)
  - The related project from the project registry (e.g. `Project NanoClaw`). If no project matches, state that explicitly.

### Human response area

After the numbered list, leave blank space for the human to write routing decisions. This is where the user confirms, rejects, or modifies the AI's proposals.

The human response is recorded in two places:
- **Daily note** — the visible narrative record of what was decided (stays in the human response area or gets captured in the Routed entry)
- **Fleeting note frontmatter** — the machine-readable outcome (`status`, `converted_to`, `project`)

When the agent processes the human response, it:
1. Reads the human's instructions from the response area
2. Creates a **routing session note** at `Fleeting/{year}/{month}/{day}/_routing-session-{NNN}.md`
   - Contains the human response verbatim
   - Table of all routing decisions: item, decision, destination, rationale
   - Links to all affected fleeting notes and their destinations
3. Executes the routing (creates project/permanent/literature notes, updates fleeting note frontmatter)
4. Adds `routing_session:` to each fleeting note's frontmatter, linking back to the session note
5. Moves items from Unprocessed to Routed
6. Removes the **Response:** text from the daily note (it now lives in the routing session note)
7. Replaces it with a `[[...|*]]` link to the routing session note
8. The Routed entry + routing session note serve as the permanent record of the decisions

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

### Append behavior
- Start new sections with `---` separator
- Section headers include a timestamp of when the append happened
- If updating an existing section, add `updated ~{HH:MM} {TZ}` to the header
- Never rewrite or delete existing content — only append and move between sections
