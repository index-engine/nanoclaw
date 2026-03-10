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
import { interpretResponse } from './agent-route.js';
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
 * Looks for checked Process boxes, Process All, and Response fields.
 *
 * - `[x] Process` on an individual item → routes per proposal (or Response override)
 * - `[x] Process All` → routes all remaining items per their proposals
 * - Response text with "retire" → retires instead of routing
 */
export function parseDecisions(dailyNoteContent: string): UserDecision[] {
  const startIdx = dailyNoteContent.indexOf(FLEETING_START);
  const endIdx = dailyNoteContent.indexOf(FLEETING_END);
  if (startIdx === -1 || endIdx === -1) return [];

  const section = dailyNoteContent.slice(
    startIdx + FLEETING_START.length,
    endIdx,
  );

  const processAll = /- \[x\]\s*Process All/i.test(section);
  const decisions: UserDecision[] = [];

  // Split into numbered items: "1. **Title** (date) [[path|f-note]]"
  const itemPattern =
    /^(\d+)\.\s+\*\*(.+?)\*\*\s+\((\d{4}-\d{2}-\d{2})\)\s+\[\[(.+?)\|f-note\]\]/gm;
  let match;

  while ((match = itemPattern.exec(section)) !== null) {
    const itemIndex = parseInt(match[1], 10);
    const wikiPath = match[4];
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

    const processed = /- \[x\]\s*Process(?!\s*All)/i.test(block);
    const retired = /- \[x\]\s*Retire\b/i.test(block);

    // Extract Response text — multi-line between <!-- r --> delimiters or single-line
    let responseText: string | undefined;
    const multiLineResponse = block.match(
      /<!-- r -->\n([\s\S]*?)\n\s*<!-- \/r -->/,
    );
    if (multiLineResponse && multiLineResponse[1].trim()) {
      responseText = multiLineResponse[1].trim();
    } else {
      const singleLineMatch = block.match(/\*\*Response:\*\*[ \t]*(.+)/);
      responseText = singleLineMatch?.[1]?.trim() || undefined;
    }

    // Extract proposal text
    const proposalMatch = block.match(/\*\*Proposed:\*\*[ \t]*(.+)/);
    const proposalText = proposalMatch?.[1]?.trim();

    // Process (or Process All) is required for all actions
    if (!processed && !processAll) continue;

    // Priority: Retire > Response > accept proposal
    let action: UserDecision['action'] = 'accept';
    if (retired) {
      action = 'retire';
    } else if (responseText) {
      action = 'response';
    }

    decisions.push({
      itemIndex,
      fleetingPath,
      action,
      responseText: action === 'response' ? responseText : undefined,
      proposal: proposalText
        ? { projectLine: '', text: proposalText }
        : undefined,
    });
  }

  return decisions;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Build the vault-relative path for a project note.
 * Pattern: {projectVault}/notes/{year}/{month}-{MonthName}/{YYYY-MM-DD}-{slug}.md
 */
export function projectNotePath(
  projectVault: string,
  created: string,
  slug: string,
): string {
  const [year, month] = created.split('-');
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
  return path.join(
    projectVault,
    'notes',
    year,
    `${month}-${monthName}`,
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
 * Format per spec: - **{title}** → {description} — [[...|f-note]] → [[...|dest-note]]
 */
export function appendToRoutedSection(
  dailyNoteContent: string,
  fleetingPath: string,
  action: string,
  destinationPath?: string,
  title?: string,
  projectName?: string,
  routingType?: string,
): string {
  const fleetingLink = `[[${fleetingPath.replace('.md', '')}|f-note]]`;
  const titleBold = title ? `**${title}**` : `**${fleetingPath.replace('.md', '').split('/').pop()}**`;

  let entry: string;
  if (action === 'retire') {
    entry = `- ${titleBold} → retired — ${fleetingLink}`;
  } else {
    // Map routing type to spec labels
    const rType = routingType || 'permanent';
    const destLabel = rType === 'task' ? 'pr-note' : rType === 'literature' ? 'l-note' : 'pe-note';
    const typeDesc = rType === 'task' ? '#task' : rType === 'literature' ? 'literature note' : 'permanent';
    const description = projectName
      ? `${projectName} as ${typeDesc}`
      : typeDesc;
    const destLink = destinationPath
      ? ` → [[${destinationPath.replace('.md', '')}|${destLabel}]]`
      : '';
    entry = `- ${titleBold} → ${description} — ${fleetingLink}${destLink}`;
  }

  // Insert before <!-- fleeting-end -->
  const endIdx = dailyNoteContent.indexOf(FLEETING_END);
  if (endIdx === -1) return dailyNoteContent;

  return (
    dailyNoteContent.slice(0, endIdx) +
    entry +
    '\n' +
    dailyNoteContent.slice(endIdx)
  );
}

/**
 * Detect the routing action type from proposal text.
 */
export function detectRoutingAction(
  proposalText: string,
): 'task' | 'permanent' | 'literature' | 'retire' {
  const lower = proposalText.toLowerCase();
  if (lower.includes('retire')) return 'retire';
  if (lower.includes('#task') || lower.includes('todo')) return 'task';
  if (lower.includes('literature note')) return 'literature';
  return 'permanent'; // permanent note, spark idea, etc.
}

/**
 * Parse user Response text for routing overrides.
 * Looks for project names and routing keywords (todo, task, retire, permanent, etc.)
 * Response text like "Todo in chores please" → route as task to Chores project.
 */
export function parseResponseOverride(
  responseText: string,
  registry: ProjectRegistryEntry[],
): { routingAction?: 'task' | 'permanent' | 'literature' | 'retire'; project?: ProjectRegistryEntry } | undefined {
  const lower = responseText.toLowerCase();

  // Detect routing action from response — only match clear routing keywords
  let routingAction: 'task' | 'permanent' | 'literature' | 'retire' | undefined;
  if (lower.includes('retire')) routingAction = 'retire';
  else if (lower.includes('todo') || lower.includes('task')) routingAction = 'task';
  else if (lower.includes('literature')) routingAction = 'literature';
  else if (lower.includes('permanent note')) routingAction = 'permanent';

  // Detect project from response — match against registry names and aliases
  let project: ProjectRegistryEntry | undefined;
  for (const entry of registry) {
    const names = [entry.name, ...entry.aliases].map((n) => n.toLowerCase());
    if (names.some((n) => lower.includes(n))) {
      project = entry;
      break;
    }
  }

  if (!routingAction && !project) return undefined;
  return { routingAction, project };
}

/**
 * Execute routing for a single decision.
 * Creates destination files and updates fleeting note status.
 */
export async function executeRoute(
  vaultPath: string,
  decision: UserDecision,
  note: FleetingNote,
  registry: ProjectRegistryEntry[],
): Promise<{ destinationPath?: string; routingType?: string; error?: string; conversation?: boolean }> {
  if (decision.action === 'retire') {
    updateFleetingNoteStatus(vaultPath, decision.fleetingPath, 'retired');
    return { routingType: 'retire' };
  }

  // For response actions, always use LLM to interpret the user's text
  let responseOverride: { routingAction?: 'task' | 'permanent' | 'literature' | 'retire'; project?: ProjectRegistryEntry } | undefined;
  if (decision.action === 'response' && decision.responseText) {
    const llmResult = await interpretResponse(
      note,
      decision.responseText,
      decision.proposal?.text || '',
      registry,
      vaultPath,
    );

    if (llmResult.action === 'reply') {
      // LLM wants to converse — append to fleeting note Chat section
      appendToFleetingNoteChat(
        vaultPath,
        decision.fleetingPath,
        decision.responseText,
        llmResult.message || 'Processing...',
      );
      return { routingType: 'conversation', conversation: true };
    }

    // LLM decided to route
    if (llmResult.action === 'route') {
      const llmProject = llmResult.project
        ? registry.find((p) => p.name.toLowerCase() === llmResult.project!.toLowerCase())
        : undefined;
      responseOverride = {
        routingAction: llmResult.type as 'task' | 'permanent' | 'literature' | 'retire',
        project: llmProject,
      };
    }
  }

  // Accept or Response: create destination file
  const routingAction = responseOverride?.routingAction
    ?? (decision.proposal ? detectRoutingAction(decision.proposal.text) : 'permanent');

  const projectEntry = responseOverride?.project
    ?? (note.project
      ? registry.find(
          (p) => p.name.toLowerCase() === note.project!.toLowerCase(),
        )
      : undefined);
  // Only use project if it has a real vault path (not placeholder text)
  const project = projectEntry?.vault && !projectEntry.vault.includes('*')
    ? projectEntry
    : undefined;

  let destPath: string | undefined;
  const rType = routingAction;

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
    // Permanent note, literature note, or spark idea
    const noteDir = project?.vault || '1. Projects/Spark';
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

  return { destinationPath: destPath, routingType: rType };
}

/**
 * Append a user message and agent reply to a fleeting note's ## Chat section.
 */
export function appendToFleetingNoteChat(
  vaultPath: string,
  fleetingPath: string,
  userMessage: string,
  agentReply: string,
): void {
  const absPath = path.join(vaultPath, fleetingPath);
  if (!fs.existsSync(absPath)) return;

  let content = fs.readFileSync(absPath, 'utf-8');
  const today = new Date().toISOString().slice(0, 10);

  const chatEntry = [
    `**User (${today}):** ${userMessage}`,
    `**Agent (${today}):** ${agentReply}`,
  ].join('\n');

  if (content.includes('## Chat')) {
    // Append to existing Chat section
    content = content.trimEnd() + '\n' + chatEntry + '\n';
  } else {
    // Create new Chat section
    content = content.trimEnd() + '\n\n## Chat\n' + chatEntry + '\n';
  }

  fs.writeFileSync(absPath, content);
}

/**
 * Process all user decisions from the daily note.
 * Main entry point for Stage 3.
 */
export async function processDecisions(
  vaultPath: string,
  dailyNoteContent: string,
  notes: FleetingNote[],
): Promise<RoutingResult> {
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
      const { destinationPath, routingType, error, conversation } = await executeRoute(
        vaultPath,
        decision,
        note,
        registry,
      );
      if (error) {
        result.errors.push(error);
      } else if (conversation) {
        // Conversation items stay unprocessed — don't add to routed
        result.routed.push({
          fleetingPath: decision.fleetingPath,
          action: 'response',
          routingType: 'conversation',
          title: note.title,
          projectName: note.project,
        });
      } else {
        result.routed.push({
          fleetingPath: decision.fleetingPath,
          action: decision.action,
          routingType,
          destinationPath,
          title: note.title,
          projectName: note.project,
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
