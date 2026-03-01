# History

Session log — what we worked on, what problems we solved, and how the system evolved.

---

## 2026-03-01 17:58–18:21 EST

Set up the Telegram capture group — a dedicated channel where every message is automatically captured to the exocortex without needing a trigger word. Built the full pipeline: registered the group in the database with `requires_trigger=0`, wrote a minimal CLAUDE.md for the capture agent, and configured the exocortex mount with write access.

Tested project routing end-to-end: messages tagged `@onto` land in `projects/onto/inbox.md`, `@nanoclaw` in `projects/nanoclaw/inbox.md`, untagged in the general `inbox.md`. Hit the Telegram bot privacy mode wall — bots can't see group messages by default, had to guide through BotFather settings.

Wired up Things 3 ingestion for the NanoClaw project. The sync pipeline picks up new tasks, writes them to `things_inbox.json`, the agent processes them into the right project inbox, and completed items move under the "Ingested" heading in Things. Dropped the sync interval from 1 hour to 10 minutes.

Changed inbox write order from append to prepend — newest entries now appear at the top of inbox files instead of buried at the bottom. Tested by running the full Things sync pipeline and verifying file position.

Added testing policy to CLAUDE.md: when changing agent behavior, don't just update instructions — run the actual pipeline and verify the side effects.
