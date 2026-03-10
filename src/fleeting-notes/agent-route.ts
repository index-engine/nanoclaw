/**
 * Agent-assisted routing via `claude -p` CLI.
 *
 * When a user's Response text doesn't match deterministic routing keywords,
 * this module calls `claude -p` to interpret the text and decide whether
 * to route the note or reply with a question.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import type { FleetingNote, ProjectRegistryEntry } from './types.js';

export interface LLMRouteResult {
  action: 'route' | 'reply';
  type?: string; // task, permanent, literature, retire
  project?: string;
  message?: string; // reply text or routing description
}

/**
 * Call `claude -p` to parse the outer JSON envelope and extract the inner text.
 */
function callClaude(prompt: string): string {
  const result = execSync(
    `claude -p --output-format json`,
    {
      input: prompt,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );

  const outer = JSON.parse(result.trim());
  return outer.result || outer.text || result.trim();
}

export interface LLMProposalResult {
  project: string | null;
  type: string; // task, permanent, literature, retire
  description: string;
}

/**
 * Generate a routing proposal using `claude -p` when heuristics fail.
 */
export function generateLLMProposal(
  note: FleetingNote,
  registry: ProjectRegistryEntry[],
): LLMProposalResult | null {
  const registryList = registry
    .map((p) => `- ${p.name} (aliases: ${p.aliases.join(', ')}) — routing: ${p.routing.join(', ')}`)
    .join('\n');

  const prompt = `You are a routing assistant for a personal knowledge management system. Given a fleeting note, propose which project it belongs to and what type of note it should become.

## Fleeting Note
**Title:** ${note.title}
**Body:** ${note.body || '(empty)'}
**Created:** ${note.created}

## Available Projects
${registryList}

## Conversion Paths
| Path | When to propose |
| #task (project note) | Action items, replies, to-dos, things to do |
| Permanent note | Insights, reflections, atomic thoughts worth keeping |
| Literature note + permanent note | Notes referencing external sources (URLs, articles) |
| Idea log entry | Raw ideas not yet actionable |
| Retire | Stale items, duplicates, test items, items with no context |

## Instructions
Return ONLY valid JSON (no markdown, no code fences):
{"project":"ProjectName or null","type":"task|permanent|literature|retire","description":"one-line description of why"}

Rules:
- Match the note to the most relevant project. Use project names, aliases, and routing keywords to decide.
- If no project fits, set project to null.
- Choose the conversion path that best fits the note content.
- For stale or context-free items, propose retire.
- Be concise in the description (under 80 chars).`;

  try {
    const text = callClaude(prompt);
    const jsonMatch = typeof text === 'string' ? text.match(/\{[\s\S]*?\}/) : null;
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as LLMProposalResult;
      logger.info(
        { project: parsed.project, type: parsed.type },
        'LLM proposal generated',
      );
      return parsed;
    }
    logger.warn({ result: text }, 'LLM proposal unparseable');
    return null;
  } catch (err) {
    logger.error({ err }, 'claude -p proposal call failed');
    return null;
  }
}

/**
 * Build the prompt for `claude -p` that asks the LLM to interpret
 * the user's Response text in context of the fleeting note.
 */
function buildResponsePrompt(
  note: FleetingNote,
  responseText: string,
  proposalText: string,
  registry: ProjectRegistryEntry[],
  chatHistory?: string,
): string {
  const registryList = registry
    .map((p) => `- ${p.name} (aliases: ${p.aliases.join(', ')}) — ${p.routing.join(', ')}`)
    .join('\n');

  return `You are a routing assistant for a personal knowledge management system. A user has a fleeting note and has written a response. Your job is to interpret their response and decide what to do.

## Fleeting Note
**Title:** ${note.title}
**Body:** ${note.body || '(empty)'}
**Created:** ${note.created}
**Current project:** ${note.project || 'none'}
**AI proposal:** ${proposalText}

## User's Response
${responseText}

${chatHistory ? `## Prior Conversation\n${chatHistory}\n` : ''}
## Available Projects
${registryList}

## Instructions
Decide ONE of:
1. **Route** — if the user's response is a routing instruction (explicit or implicit)
2. **Reply** — if the user is asking a question, needs clarification, or wants to discuss

Return ONLY valid JSON (no markdown, no code fences):
{"action":"route","type":"task|permanent|literature|retire","project":"ProjectName or null","message":"brief description"}
or
{"action":"reply","message":"your conversational reply to the user"}

Rules:
- "type" must be one of: task, permanent, literature, retire
- "project" should match a project name from the registry, or null if none fits
- For "reply", write a helpful, concise response (1-2 sentences)
- If the user seems to be giving a routing instruction but it's ambiguous, prefer routing with your best guess
- If the user is clearly asking a question or expressing uncertainty, reply`;
}

/**
 * Read the ## Chat section from a fleeting note file (if it exists).
 */
function readChatHistory(vaultPath: string, fleetingPath: string): string | undefined {
  const absPath = path.join(vaultPath, fleetingPath);
  if (!fs.existsSync(absPath)) return undefined;

  const content = fs.readFileSync(absPath, 'utf-8');
  const chatMatch = content.match(/## Chat\n([\s\S]*?)(?:\n##|\n---|\z)/);
  return chatMatch?.[1]?.trim() || undefined;
}

/**
 * Call `claude -p` to interpret a user's Response text.
 * Falls back to a safe default if the CLI call fails.
 */
export async function interpretResponse(
  note: FleetingNote,
  responseText: string,
  proposalText: string,
  registry: ProjectRegistryEntry[],
  vaultPath: string,
): Promise<LLMRouteResult> {
  const chatHistory = readChatHistory(vaultPath, note.path);
  const prompt = buildResponsePrompt(note, responseText, proposalText, registry, chatHistory);

  try {
    const text = callClaude(prompt);

    const jsonMatch = typeof text === 'string'
      ? text.match(/\{[\s\S]*?\}/)
      : null;
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as LLMRouteResult;
      if (parsed.action === 'route' || parsed.action === 'reply') {
        logger.info(
          { action: parsed.action, type: parsed.type, project: parsed.project },
          'LLM routing interpretation',
        );
        return parsed;
      }
    }

    // If we got text but couldn't parse structured JSON, treat as reply
    logger.warn({ result: text }, 'LLM returned unparseable response, treating as reply');
    return {
      action: 'reply',
      message: typeof text === 'string' ? text.slice(0, 200) : 'Could not interpret response.',
    };
  } catch (err) {
    logger.error({ err }, 'claude -p call failed, falling back to proposal');
    // Fallback: treat as a routing instruction using the proposal
    return {
      action: 'route',
      type: 'permanent',
      message: 'LLM unavailable, executed proposal as-is.',
    };
  }
}
