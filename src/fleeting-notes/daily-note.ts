/**
 * Stage 2: Build the daily note's Fleeting Notes section.
 *
 * Reads all unprocessed (status: raw) fleeting notes from the vault,
 * formats them per the daily note spec, and appends/updates the section
 * in today's daily note.
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { generateLLMProposal } from './agent-route.js';
import { loadRegistry } from './registry.js';
import type {
  FleetingNote,
  ProjectRegistryEntry,
  RoutingProposal,
} from './types.js';

const FLEETING_START = '<!-- fleeting-start -->';
const FLEETING_END = '<!-- fleeting-end -->';

/** Parse YAML-ish frontmatter from a markdown file (simple key: value). */
export function parseFrontmatter(
  content: string,
): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w_]*?):\s*"?(.+?)"?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

/** Collect all fleeting notes with status: raw from the vault. */
export function collectUnprocessedNotes(vaultPath: string): FleetingNote[] {
  const fleetingDir = path.join(vaultPath, 'Fleeting');
  const notes: FleetingNote[] = [];

  if (!fs.existsSync(fleetingDir)) return notes;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        const absPath = path.join(dir, entry.name);
        const content = fs.readFileSync(absPath, 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm || fm.status !== 'raw') continue;

        // Extract title from first # heading
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch
          ? titleMatch[1].trim()
          : entry.name.replace('.md', '');

        // Extract body (everything after the heading)
        const bodyMatch = content.match(/^#\s+.+\n+([\s\S]*)/m);
        const body = bodyMatch ? bodyMatch[1].trim() : '';

        const relPath = path.relative(vaultPath, absPath);
        // Strip date prefix (DD-) from filename to get the pure slug
        const rawName = entry.name.replace('.md', '');
        const slug = rawName.replace(/^\d{2}-/, '');
        notes.push({
          path: relPath,
          slug,
          title,
          body,
          source: (fm.source as FleetingNote['source']) || 'things',
          thingsUuid: fm.things_uuid,
          created: fm.created || '',
          status: 'raw',
          project: fm.project,
        });
      }
    }
  };

  walk(fleetingDir);

  // Only include notes created within the last 3 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent = notes.filter((n) => !n.created || n.created >= cutoffStr);

  // Sort by created date (oldest first)
  recent.sort((a, b) => a.created.localeCompare(b.created));
  return recent;
}

/**
 * Generate a routing proposal for a fleeting note.
 * Tries heuristic matching first. When heuristics can't match a project,
 * calls `claude -p` for an AI-generated proposal.
 */
export function generateProposal(
  note: FleetingNote,
  registry: ProjectRegistryEntry[],
): RoutingProposal {
  const heuristic = generateHeuristicProposal(note, registry);
  if (heuristic) return heuristic;

  // Heuristics didn't match — try LLM
  const llmResult = generateLLMProposal(note, registry);
  if (llmResult) {
    const projectLine = llmResult.project
      ? `Project ${llmResult.project}.`
      : 'No project match.';
    const typeLabel =
      llmResult.type === 'task'
        ? '#task'
        : llmResult.type === 'literature'
          ? 'Literature note'
          : llmResult.type === 'retire'
            ? 'Retire'
            : 'Permanent note';
    return {
      projectLine,
      text: `${projectLine} ${typeLabel} — ${llmResult.description}`,
    };
  }

  // LLM failed too — ultimate fallback
  return {
    projectLine: 'No project match.',
    text: 'No project match. Permanent note — unmatched idea, awaiting triage.',
  };
}

/**
 * Heuristic proposal generation. Returns null when it can't make
 * a confident match (no project, no clear conversion path).
 */
export function generateHeuristicProposal(
  note: FleetingNote,
  registry: ProjectRegistryEntry[],
): RoutingProposal | null {
  const text = `${note.title} ${note.body}`.toLowerCase();

  // Find matching project
  let matchedProject: ProjectRegistryEntry | null = null;
  if (note.project) {
    matchedProject =
      registry.find(
        (p) => p.name.toLowerCase() === note.project!.toLowerCase(),
      ) || null;
  }

  const projectLine = matchedProject
    ? `Project ${matchedProject.name}.`
    : 'No project match.';

  // Determine conversion path
  const hasUrl = /https?:\/\//.test(text);
  const isAction =
    /\b(reply|email|send|buy|check|submit|call|talk|ask|resubmit|schedule|book|fix|update|implement|create|start|finish)\b/.test(
      text,
    );
  const isStale = isOlderThanWeeks(note.created, 2);
  const isShort = !note.body && note.title.length < 15;
  const isTest = /\b(test|testing)\b/.test(text) && isShort;

  if (isTest) {
    return {
      projectLine,
      text: `${projectLine} Retire — test item with no actionable content.`,
    };
  }

  if (isStale && isShort) {
    return {
      projectLine,
      text: `${projectLine} Retire — stale item (${note.created}) with insufficient context.`,
    };
  }

  if (hasUrl) {
    const desc = matchedProject
      ? `literature note in ${matchedProject.name}`
      : 'literature note';
    return {
      projectLine,
      text: `${projectLine} Literature note + permanent note — ${desc}, fetch and preserve source text.`,
    };
  }

  if (isAction && matchedProject) {
    return {
      projectLine,
      text: `${projectLine} #task — action item for ${matchedProject.name}.`,
    };
  }

  if (isAction) {
    return {
      projectLine,
      text: `${projectLine} #task — actionable item, route to appropriate project.`,
    };
  }

  if (matchedProject) {
    return {
      projectLine,
      text: `${projectLine} Permanent note — insight or observation for ${matchedProject.name}.`,
    };
  }

  // No confident match — return null to trigger LLM
  return null;
}

function isOlderThanWeeks(dateStr: string, weeks: number): boolean {
  if (!dateStr) return false;
  const created = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  return created < cutoff;
}

/** Format a single daily note entry per the format spec. */
export function formatDailyNoteEntry(
  index: number,
  note: FleetingNote,
  proposal: RoutingProposal,
): string {
  const wikiLink = `[[${note.path.replace('.md', '')}|f-note]]`;

  const lines: string[] = [];
  lines.push(`${index}. **${note.title}** (${note.created}) ${wikiLink}`);

  // Notes (≤2 lines verbatim) vs Summary (>2 lines AI summary)
  const bodyText = note.body || '';
  if (bodyText) {
    const bodyLines = bodyText.split('\n').filter((l) => l.trim());
    if (bodyLines.length <= 2) {
      lines.push(`    **Notes:** ${bodyText.replace(/\n/g, ' ')}`);
    } else {
      // For rule-based Phase 1, use first 2 lines as summary
      const summary = bodyLines.slice(0, 2).join(' ');
      lines.push(`    **Summary:** ${summary}`);
    }
  }

  // Routing proposal
  lines.push(`    **Proposed:** ${proposal.text}`);

  // Action controls
  lines.push('    - [ ] Retire');
  lines.push('    **Response:**');
  lines.push('    <!-- r -->');
  lines.push('    <!-- /r -->');
  lines.push('    - [ ] Process');

  return lines.join('\n');
}

/** Build the full Fleeting Notes section for the daily note. */
export function buildDailyNoteSection(
  notes: FleetingNote[],
  registry: ProjectRegistryEntry[],
): string {
  const lines: string[] = [];
  lines.push(FLEETING_START);
  lines.push('');
  lines.push('## Fleeting Notes');
  lines.push('');

  if (notes.length === 0) {
    lines.push('### Unprocessed (0 — all processed)');
  } else {
    const source = [...new Set(notes.map((n) => n.source))].join(', ');
    lines.push(`### Unprocessed (${notes.length} from ${source})`);
    lines.push('');

    for (let i = 0; i < notes.length; i++) {
      const proposal = generateProposal(notes[i], registry);
      lines.push(formatDailyNoteEntry(i + 1, notes[i], proposal));
      lines.push('');
    }

    lines.push('- [ ] Process All');
    lines.push('');
  }

  lines.push('### Routed');
  lines.push('');
  lines.push(FLEETING_END);

  return lines.join('\n');
}

/**
 * Find today's daily note file in the vault.
 * Pattern: 0a. Daily Notes/{year}/{month}-{MonthName}/{date}-{DayName}.md
 */
export function findDailyNoteFile(
  vaultPath: string,
  date?: Date,
): string | null {
  const d = date || new Date();
  const year = String(d.getFullYear());
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = months[d.getMonth()];
  const dayNum = String(d.getDate()).padStart(2, '0');

  const monthDir = path.join(
    vaultPath,
    '0a. Daily Notes',
    year,
    `${monthNum}-${monthName}`,
  );

  if (!fs.existsSync(monthDir)) return null;

  const datePrefix = `${year}-${monthNum}-${dayNum}`;
  const files = fs.readdirSync(monthDir);
  const match = files.find(
    (f) => f.startsWith(datePrefix) && f.endsWith('.md'),
  );
  return match ? path.join(monthDir, match) : null;
}

/**
 * Create today's daily note if it doesn't exist yet.
 * Pattern: 0a. Daily Notes/{year}/{month}-{MonthName}/{YYYY-MM-DD}-{DayName}.md
 */
export function createDailyNoteIfMissing(
  vaultPath: string,
  date?: Date,
): string {
  const d = date || new Date();
  const year = String(d.getFullYear());
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = months[d.getMonth()];
  const dayNum = String(d.getDate()).padStart(2, '0');
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const dayName = days[d.getDay()];

  const monthDir = path.join(
    vaultPath,
    '0a. Daily Notes',
    year,
    `${monthNum}-${monthName}`,
  );
  fs.mkdirSync(monthDir, { recursive: true });

  const filePath = path.join(
    monthDir,
    `${year}-${monthNum}-${dayNum}-${dayName}.md`,
  );
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${year}-${monthNum}-${dayNum} ${dayName}\n`);
    logger.info({ path: filePath }, 'Created daily note');
  }
  return filePath;
}

/**
 * Update the daily note with the Fleeting Notes section.
 * Creates the daily note if it doesn't exist yet.
 * Uses HTML comment markers for idempotent replacement.
 */
export function updateDailyNote(vaultPath: string, section: string): boolean {
  let dailyNotePath = findDailyNoteFile(vaultPath);
  if (!dailyNotePath) {
    dailyNotePath = createDailyNoteIfMissing(vaultPath);
  }

  let content = fs.readFileSync(dailyNotePath, 'utf-8');

  // Replace existing section or append
  const startIdx = content.indexOf(FLEETING_START);
  const endIdx = content.indexOf(FLEETING_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    content =
      content.slice(0, startIdx) +
      section +
      content.slice(endIdx + FLEETING_END.length);
  } else {
    // Append with separator
    content = content.trimEnd() + '\n\n---\n\n' + section + '\n';
  }

  fs.writeFileSync(dailyNotePath, content);
  logger.info(
    { path: dailyNotePath },
    'Daily note updated with fleeting notes section',
  );
  return true;
}

/**
 * Append only new fleeting note entries to the existing daily note section.
 * Preserves all existing content (user edits, checked boxes, responses).
 * Returns the number of new entries appended.
 */
export function appendNewEntries(
  vaultPath: string,
  notes: FleetingNote[],
  registry: ProjectRegistryEntry[],
): number {
  let dailyNotePath = findDailyNoteFile(vaultPath);
  if (!dailyNotePath) {
    dailyNotePath = createDailyNoteIfMissing(vaultPath);
  }

  let content = fs.readFileSync(dailyNotePath, 'utf-8');
  const startIdx = content.indexOf(FLEETING_START);
  const endIdx = content.indexOf(FLEETING_END);

  // If no section exists yet, build the full section (first time)
  if (startIdx === -1 || endIdx === -1) {
    const section = buildDailyNoteSection(notes, registry);
    return updateDailyNote(vaultPath, section) ? notes.length : 0;
  }

  // Find which notes are already mentioned in the section
  const existingSection = content.slice(startIdx, endIdx);
  const newNotes = notes.filter(
    (n) => !existingSection.includes(n.path.replace('.md', '')),
  );

  if (newNotes.length === 0) return 0;

  // Find the highest existing item number
  const numberMatches = existingSection.match(/^\d+\./gm);
  let nextIndex = numberMatches
    ? Math.max(...numberMatches.map((m) => parseInt(m, 10))) + 1
    : 1;

  // Build entries for new notes only
  const newLines: string[] = [];
  for (const note of newNotes) {
    const proposal = generateProposal(note, registry);
    newLines.push(formatDailyNoteEntry(nextIndex, note, proposal));
    newLines.push('');
    nextIndex++;
  }
  const newBlock = newLines.join('\n');

  // Insert before "Process All" (checked or unchecked) or "### Routed", whichever comes first
  const section = content.slice(startIdx, endIdx);
  let insertPoint = section.indexOf('- [ ] Process All');
  if (insertPoint === -1) insertPoint = section.indexOf('- [x] Process All');
  if (insertPoint === -1) insertPoint = section.indexOf('### Routed');
  if (insertPoint === -1) {
    // Fallback: insert before fleeting-end
    insertPoint = section.length;
  }

  const absInsertPoint = startIdx + insertPoint;
  content =
    content.slice(0, absInsertPoint) +
    newBlock +
    '\n' +
    content.slice(absInsertPoint);

  // Update the "Unprocessed" count in the header
  const totalRaw = notes.length;
  const source = [...new Set(notes.map((n) => n.source))].join(', ');
  content = content.replace(
    /### Unprocessed \([^)]+\)/,
    `### Unprocessed (${totalRaw} from ${source})`,
  );

  // Uncheck Process All so new notes aren't auto-routed
  content = content.replace('- [x] Process All', '- [ ] Process All');

  fs.writeFileSync(dailyNotePath, content);
  logger.info(
    { appended: newNotes.length, path: dailyNotePath },
    'Appended new entries to daily note',
  );
  return newNotes.length;
}
