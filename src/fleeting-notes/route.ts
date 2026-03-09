/**
 * Stage 3: Parse user decisions from the daily note and execute routing.
 *
 * Reads the fleeting notes section of today's daily note, parses which
 * items the user accepted/retired/responded to, and creates destination
 * files (project notes, permanent notes) while updating fleeting note
 * frontmatter.
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { parseFrontmatter } from './daily-note.js';
import { loadRegistry } from './registry.js';
import type {
  FleetingNote,
  ProjectRegistryEntry,
  RoutingResult,
  UserDecision,
} from './types.js';

const FLEETING_START = '<!-- fleeting-start -->';
const FLEETING_END = '<!-- fleeting-end -->';

/**
 * Parse user decisions from the daily note's fleeting notes section.
 * Looks for checked Accept/Retire boxes and Chat/Response fields.
 */
export function parseDecisions(dailyNoteContent: string): UserDecision[] {
  const startIdx = dailyNoteContent.indexOf(FLEETING_START);
  const endIdx = dailyNoteContent.indexOf(FLEETING_END);
  if (startIdx === -1 || endIdx === -1) return [];

  const section = dailyNoteContent.slice(
    startIdx + FLEETING_START.length,
    endIdx,
  );

  const decisions: UserDecision[] = [];

  // Split into numbered items: "1. **Title** (date) [[path|f-note]]"
  const itemPattern =
    /^(\d+)\.\s+\*\*(.+?)\*\*\s+\((\d{4}-\d{2}-\d{2})\)\s+\[\[(.+?)\|f-note\]\]/gm;
  let match;

  while ((match = itemPattern.exec(section)) !== null) {
    const itemIndex = parseInt(match[1], 10);
    const wikiPath = match[4]; // e.g. "Fleeting/2026/03/07/test-note"
    const fleetingPath = wikiPath + '.md';

    // Get the block of text for this item (until the next numbered item or end)
    const blockStart = match.index;
    const nextItemMatch = section
      .slice(match.index + match[0].length)
      .match(/^\d+\.\s+\*\*/m);
    const blockEnd = nextItemMatch
      ? match.index + match[0].length + nextItemMatch.index!
      : section.length;
    const block = section.slice(blockStart, blockEnd);

    // Check for Accept/Retire checkboxes
    const accepted = /- \[x\]\s*Accept/i.test(block);
    const retired = /- \[x\]\s*Retire/i.test(block);

    // Extract Chat and Response text (line-bounded, no cross-line matching)
    const chatMatch = block.match(/\*\*Chat:\*\*[ \t]*(.+)/);
    const responseMatch = block.match(/\*\*Response:\*\*[ \t]*(.+)/);
    const chatText = chatMatch?.[1]?.trim() || undefined;
    const responseText = responseMatch?.[1]?.trim() || undefined;

    // Extract proposal text
    const proposalMatch = block.match(/\*\*Proposed:\*\*[ \t]*(.+)/);
    const proposalText = proposalMatch?.[1]?.trim();

    let action: UserDecision['action'] = 'skip';
    if (accepted) action = 'accept';
    else if (retired) action = 'retire';
    else if (responseText) action = 'response';
    else if (chatText) action = 'chat';

    if (action !== 'skip') {
      decisions.push({
        itemIndex,
        fleetingPath,
        action,
        responseText,
        chatText,
        proposal: proposalText
          ? { projectLine: '', text: proposalText }
          : undefined,
      });
    }
  }

  return decisions;
}

/**
 * Build the vault-relative path for a project note.
 * Pattern: {projectVault}/notes/{year}/{month}/{YYYY-MM-DD}-{slug}.md
 */
export function projectNotePath(
  projectVault: string,
  created: string,
  slug: string,
): string {
  const [year, month] = created.split('-');
  return path.join(
    projectVault,
    'notes',
    year,
    month,
    `${created}-${slug}.md`,
  );
}

/** Build frontmatter + body for a project note (to-do). */
export function buildProjectNote(
  title: string,
  fleetingPath: string,
  created: string,
  projectName: string,
): string {
  const fleetingLink = `[[${fleetingPath.replace('.md', '')}|*]]`;
  return [
    '---',
    'source: fleeting',
    `created: ${created}`,
    `project: ${projectName.toLowerCase()}`,
    'type: project-note',
    '---',
    '',
    `# ${title}`,
    '',
    `- [ ] #task ${title} ${fleetingLink}`,
    '',
  ].join('\n');
}

/** Build frontmatter + body for a permanent note. */
export function buildPermanentNote(
  title: string,
  body: string,
  fleetingPath: string,
  created: string,
  projectName?: string,
): string {
  const fleetingLink = `[[${fleetingPath.replace('.md', '')}|*]]`;
  const lines = [
    '---',
    'source: fleeting',
    `created: ${created}`,
    ...(projectName ? [`project: ${projectName.toLowerCase()}`] : []),
    'type: permanent-note',
    '---',
    '',
    `# ${title}`,
    '',
    body || '*(awaiting user rewrite)*',
    '',
    `Source: ${fleetingLink}`,
    '',
  ];
  return lines.join('\n');
}

/** Update a fleeting note's frontmatter status and add converted_to link. */
export function updateFleetingNoteStatus(
  vaultPath: string,
  fleetingPath: string,
  status: 'completed' | 'retired',
  convertedTo?: string,
): void {
  const absPath = path.join(vaultPath, fleetingPath);
  if (!fs.existsSync(absPath)) {
    logger.warn({ path: fleetingPath }, 'Fleeting note not found for update');
    return;
  }

  let content = fs.readFileSync(absPath, 'utf-8');

  // Update status
  content = content.replace(/^status:\s*\S+/m, `status: ${status}`);

  // Add converted_to if provided
  if (convertedTo) {
    const convertedLine = `converted_to: "[[${convertedTo.replace('.md', '')}]]"`;
    // Insert before the closing ---
    content = content.replace(/^(---\n[\s\S]*?)(^---)/m, `$1${convertedLine}\n$2`);
  }

  fs.writeFileSync(absPath, content);
}

/**
 * Append a routed entry to the daily note's Routed section.
 */
export function appendToRoutedSection(
  dailyNoteContent: string,
  fleetingPath: string,
  action: string,
  destinationPath?: string,
): string {
  const fleetingLink = `[[${fleetingPath.replace('.md', '')}|f-note]]`;
  const destLink = destinationPath
    ? ` → [[${destinationPath.replace('.md', '')}]]`
    : '';
  const entry = `- ${action}: ${fleetingLink}${destLink}`;

  // Insert before <!-- fleeting-end -->
  const endIdx = dailyNoteContent.indexOf(FLEETING_END);
  if (endIdx === -1) return dailyNoteContent;

  return (
    dailyNoteContent.slice(0, endIdx) +
    entry +
    '\n\n' +
    dailyNoteContent.slice(endIdx)
  );
}

/**
 * Detect the routing action type from proposal text.
 */
export function detectRoutingAction(
  proposalText: string,
): 'task' | 'permanent' | 'literature' | 'retire' | 'idea-log' {
  const lower = proposalText.toLowerCase();
  if (lower.includes('retire')) return 'retire';
  if (lower.includes('#task')) return 'task';
  if (lower.includes('literature note')) return 'literature';
  if (lower.includes('permanent note')) return 'permanent';
  if (lower.includes('idea log')) return 'idea-log';
  return 'permanent'; // default
}

/**
 * Execute routing for a single decision.
 * Creates destination files and updates fleeting note status.
 */
export function executeRoute(
  vaultPath: string,
  decision: UserDecision,
  note: FleetingNote,
  registry: ProjectRegistryEntry[],
): { destinationPath?: string; error?: string } {
  if (decision.action === 'retire') {
    updateFleetingNoteStatus(vaultPath, decision.fleetingPath, 'retired');
    return {};
  }

  if (decision.action === 'chat') {
    // Chat doesn't create files — it's a question for the AI
    return {};
  }

  if (decision.action === 'response') {
    // Response is a user-provided answer — use it as the note body
    // Fall through to accept logic with response text
  }

  // Accept or Response: create destination file
  const routingAction = decision.proposal
    ? detectRoutingAction(decision.proposal.text)
    : 'permanent';

  const project = note.project
    ? registry.find(
        (p) => p.name.toLowerCase() === note.project!.toLowerCase(),
      )
    : undefined;

  let destPath: string | undefined;

  if (routingAction === 'task' && project) {
    destPath = projectNotePath(project.vault, note.created, note.slug);
    const absPath = path.join(vaultPath, destPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const content = buildProjectNote(
      note.title,
      decision.fleetingPath,
      note.created,
      project.name,
    );
    fs.writeFileSync(absPath, content);
    updateFleetingNoteStatus(
      vaultPath,
      decision.fleetingPath,
      'completed',
      destPath,
    );
  } else if (routingAction === 'retire') {
    updateFleetingNoteStatus(vaultPath, decision.fleetingPath, 'retired');
  } else {
    // Permanent note, literature note, or idea log
    const noteDir = project?.vault || 'Notes';
    destPath = projectNotePath(noteDir, note.created, note.slug);
    const absPath = path.join(vaultPath, destPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const body = decision.responseText || note.body || '';
    const content = buildPermanentNote(
      note.title,
      body,
      decision.fleetingPath,
      note.created,
      project?.name,
    );
    fs.writeFileSync(absPath, content);
    updateFleetingNoteStatus(
      vaultPath,
      decision.fleetingPath,
      'completed',
      destPath,
    );
  }

  return { destinationPath: destPath };
}

/**
 * Process all user decisions from the daily note.
 * Main entry point for Stage 3.
 */
export function processDecisions(
  vaultPath: string,
  dailyNoteContent: string,
  notes: FleetingNote[],
): RoutingResult {
  const result: RoutingResult = { routed: [], errors: [] };
  const registry = loadRegistry(vaultPath);
  const decisions = parseDecisions(dailyNoteContent);

  for (const decision of decisions) {
    const note = notes.find((n) => n.path === decision.fleetingPath);
    if (!note) {
      result.errors.push(
        `Fleeting note not found: ${decision.fleetingPath}`,
      );
      continue;
    }

    try {
      const { destinationPath, error } = executeRoute(
        vaultPath,
        decision,
        note,
        registry,
      );
      if (error) {
        result.errors.push(error);
      } else {
        result.routed.push({
          fleetingPath: decision.fleetingPath,
          action: decision.action,
          destinationPath,
        });
      }
    } catch (err) {
      result.errors.push(
        `Error routing ${decision.fleetingPath}: ${err}`,
      );
    }
  }

  if (result.routed.length > 0) {
    logger.info(
      { routed: result.routed.length, errors: result.errors.length },
      'Routing decisions processed',
    );
  }

  return result;
}
