/**
 * Email ingestion: reads unread emails from a Gmail inbox via IMAP,
 * creates fleeting notes in the Obsidian vault.
 *
 * Uses imapflow for IMAP operations and mailparser for content extraction.
 * Designed to work with a dedicated agent Gmail account that receives
 * forwarded emails from the user's personal account.
 */

import fs from 'fs';
import path from 'path';

import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';

import { logger } from '../logger.js';
import { slugify, fleetingNotePath } from './ingest.js';
import { detectProject, loadRegistry } from './registry.js';
import type { FleetingNote, IngestResult } from './types.js';

export interface EmailConfig {
  user: string;
  password: string;
  allowedSenders: string[];
}

export interface ParsedEmail {
  messageId: string;
  from: string;
  subject: string;
  date: Date;
  textBody: string;
}

/** Format a Date as YYYY-MM-DD. */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Strip common forwarding prefixes from subject lines. */
export function cleanSubject(subject: string): string {
  // Repeatedly strip Fwd:/Fw:/Re: prefixes until none remain
  let prev = '';
  let result = subject;
  while (result !== prev) {
    prev = result;
    result = result.replace(/^(Fwd?|Re):\s*/i, '').trim();
  }
  return result;
}

/**
 * Extract the email address from a "Name <email>" string.
 * Returns lowercase email address.
 */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Strip HTML tags and decode common entities.
 * Used as a fallback when no plain text body is available.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Truncate email body to a reasonable length for a fleeting note.
 * Preserves whole lines up to the limit.
 */
export function truncateBody(body: string, maxChars: number = 2000): string {
  if (body.length <= maxChars) return body;
  const truncated = body.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > maxChars * 0.5 ? lastNewline : maxChars;
  return truncated.slice(0, cutPoint) + '\n\n*(truncated)*';
}

/** Build frontmatter + body for an email-sourced fleeting note. */
export function buildEmailNoteContent(
  email: ParsedEmail,
  project?: string,
): string {
  const created = formatDate(email.date);
  const title = cleanSubject(email.subject) || '(no subject)';
  const body = truncateBody(email.textBody);

  const lines = [
    '---',
    'source: email',
    `created: ${created}`,
    `email_from: ${email.from}`,
    `email_subject: "${email.subject.replace(/"/g, '\\"')}"`,
    `email_message_id: ${email.messageId}`,
    'status: raw',
    ...(project ? [`project: ${project}`] : []),
    '---',
    '',
    `# ${title}`,
  ];

  if (body) {
    lines.push('', body);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Parse a raw email buffer into a structured ParsedEmail.
 * Uses mailparser's simpleParser for MIME handling.
 */
export async function parseEmail(
  source: Buffer | string,
): Promise<ParsedEmail> {
  const parsed: ParsedMail = await simpleParser(source);

  const from =
    parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
  const subject = parsed.subject || '(no subject)';
  const date = parsed.date || new Date();
  const messageId = parsed.messageId || `no-id-${Date.now()}`;

  // Prefer plain text body, fall back to HTML stripping
  let textBody = parsed.text || '';
  if (!textBody && parsed.html) {
    textBody = stripHtml(parsed.html);
  }

  return { messageId, from, subject, date, textBody };
}

/** Find existing email message IDs in fleeting notes to prevent duplicates. */
export function findExistingEmailIds(vaultPath: string): Set<string> {
  const fleetingDir = path.join(vaultPath, 'Fleeting');
  const ids = new Set<string>();

  if (!fs.existsSync(fleetingDir)) return ids;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        try {
          const content = fs.readFileSync(
            path.join(dir, entry.name),
            'utf-8',
          );
          const match = content.match(/email_message_id:\s*(\S+)/);
          if (match) ids.add(match[1]);
        } catch {
          // skip unreadable files
        }
      }
    }
  };

  walk(fleetingDir);
  return ids;
}

/**
 * Connect to Gmail via IMAP, fetch unread emails, and create fleeting notes.
 *
 * @param vaultPath - Absolute path to the Obsidian vault
 * @param config - Gmail IMAP credentials and sender allowlist
 * @returns IngestResult with created/skipped/error counts
 */
export async function ingestEmails(
  vaultPath: string,
  config: EmailConfig,
): Promise<IngestResult> {
  const result: IngestResult = { created: [], skipped: [], errors: [] };

  if (!config.user || !config.password) {
    logger.debug('Gmail credentials not configured, skipping email ingestion');
    return result;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false, // suppress imapflow's verbose logging
  });

  try {
    await client.connect();
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Gmail IMAP');
    result.errors.push(`IMAP connection failed: ${err}`);
    return result;
  }

  try {
    // Open INBOX
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Find existing message IDs for dedup
      const existingIds = findExistingEmailIds(vaultPath);
      const registry = loadRegistry(vaultPath);

      // Search for unseen messages
      const uids = await client.search({ seen: false });
      if (!uids || uids.length === 0) {
        logger.debug('No unread emails in Gmail inbox');
        return result;
      }

      logger.info({ count: uids.length }, 'Found unread emails');

      for (const uid of uids) {
        try {
          // Fetch the full message
          const message = await client.fetchOne(uid, { source: true });
          if (!message?.source) {
            result.errors.push(`Empty message source for UID ${uid}`);
            continue;
          }

          const email = await parseEmail(message.source);

          // Check sender allowlist
          const senderAddr = extractEmailAddress(email.from);
          if (
            config.allowedSenders.length > 0 &&
            !config.allowedSenders.includes(senderAddr)
          ) {
            logger.debug(
              { from: senderAddr },
              'Email from non-allowed sender, skipping',
            );
            result.skipped.push(email.messageId);
            // Still mark as seen to avoid re-processing
            await client.messageFlagsAdd(uid, ['\\Seen']);
            continue;
          }

          // Deduplicate by message ID
          if (existingIds.has(email.messageId)) {
            result.skipped.push(email.messageId);
            await client.messageFlagsAdd(uid, ['\\Seen']);
            continue;
          }

          // Generate fleeting note
          const title = cleanSubject(email.subject) || '(no subject)';
          const slug = slugify(title);
          if (!slug) {
            result.skipped.push(email.messageId);
            await client.messageFlagsAdd(uid, ['\\Seen']);
            continue;
          }

          const notePath = fleetingNotePath(email.date, slug);
          const absPath = path.join(vaultPath, notePath);

          // Don't overwrite existing files
          if (fs.existsSync(absPath)) {
            result.skipped.push(email.messageId);
            await client.messageFlagsAdd(uid, ['\\Seen']);
            continue;
          }

          // Detect project
          const project = detectProject(
            registry,
            title,
            email.textBody || '',
          );

          // Write fleeting note
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          const content = buildEmailNoteContent(email, project?.name);
          fs.writeFileSync(absPath, content);

          const note: FleetingNote = {
            path: notePath,
            slug,
            title,
            body: email.textBody || '',
            source: 'email',
            emailMessageId: email.messageId,
            emailFrom: email.from,
            emailSubject: email.subject,
            created: formatDate(email.date),
            status: 'raw',
            project: project?.name,
          };
          result.created.push(note);
          existingIds.add(email.messageId);

          // Mark as seen
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch (err) {
          result.errors.push(`Error processing email UID ${uid}: ${err}`);
        }
      }
    } finally {
      lock.release();
    }

    if (result.created.length > 0) {
      logger.info(
        {
          created: result.created.length,
          skipped: result.skipped.length,
        },
        'Email ingestion complete',
      );
    }
  } finally {
    await client.logout();
  }

  return result;
}
