/**
 * Email Poller for NanoClaw
 * Polls Gmail for new emails from a configured sender and routes them to the agent.
 * Uses googleapis for host-side polling; agents use Gmail MCP for replies.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { google } from 'googleapis';

import { EMAIL_CHANNEL } from './config.js';
import { resolveGroupFolderPath } from './group-folder.js';
import {
  isEmailProcessed,
  markEmailProcessed,
  markEmailResponded,
} from './db.js';
import { logger } from './logger.js';

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  date: string;
}

const GMAIL_CONFIG_DIR = path.join(
  process.env.HOME || os.homedir(),
  '.gmail-mcp',
);
const OAUTH_KEYS_PATH = path.join(GMAIL_CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(GMAIL_CONFIG_DIR, 'credentials.json');

function getGmailClient() {
  if (!fs.existsSync(OAUTH_KEYS_PATH) || !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('Gmail credentials not found. Run /add-gmail setup first.');
  }

  const keys = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));

  const clientId = keys.installed?.client_id || keys.web?.client_id;
  const clientSecret = keys.installed?.client_secret || keys.web?.client_secret;
  const redirectUri =
    (keys.installed?.redirect_uris || keys.web?.redirect_uris)?.[0] ||
    'http://localhost';

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );
  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    token_type: credentials.token_type,
    expiry_date: credentials.expiry_date,
  });

  // Auto-save refreshed tokens
  oauth2Client.on('tokens', (tokens) => {
    const existing = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const updated = { ...existing, ...tokens };
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(updated, null, 2));
    logger.debug('Gmail OAuth tokens refreshed');
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function decodeBase64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf-8');
}

function extractBody(payload: any): string {
  // Simple text body
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart: look for text/plain first, then text/html
  if (payload.parts) {
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === 'text/plain',
    );
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      // Strip HTML tags for a rough text version
      return decodeBase64Url(htmlPart.body.data)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

export async function checkForNewEmails(): Promise<EmailMessage[]> {
  const gmail = getGmailClient();
  const query = `from:${EMAIL_CHANNEL.triggerSender} is:unread`;

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 10,
  });

  const messageIds = listRes.data.messages || [];
  if (messageIds.length === 0) return [];

  const emails: EmailMessage[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;
    if (isEmailProcessed(msg.id)) continue;

    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const headers = full.data.payload?.headers || [];
    const from =
      headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
    const subject =
      headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
    const date =
      headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
    const body = extractBody(full.data.payload);

    emails.push({
      id: msg.id,
      threadId: full.data.threadId || msg.id,
      from,
      subject,
      body,
      date,
    });

    // Mark as read in Gmail so we don't re-fetch
    await gmail.users.messages.modify({
      userId: 'me',
      id: msg.id,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
  }

  return emails;
}

export function getEmailContextFolder(email: EmailMessage): string {
  switch (EMAIL_CHANNEL.contextMode) {
    case 'thread': {
      // Flat folder name: email-t-{threadId} (no slashes, alphanumeric + hyphens)
      const safe = email.threadId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
      return `email-t-${safe}`;
    }
    case 'sender': {
      const safe = email.from.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
      return `email-s-${safe}`;
    }
    case 'single':
      return 'email-inbox';
  }
}

export function formatEmailPrompt(email: EmailMessage): string {
  return `<email>
<from>${email.from}</from>
<subject>${email.subject}</subject>
<date>${email.date}</date>
<thread_id>${email.threadId}</thread_id>
<body>
${email.body}
</body>
</email>

You received this email. Read it and respond appropriately. Your text output will be sent as an email reply using Gmail MCP tools.

After composing your response, use the \`mcp__gmail__send_email\` tool to send the reply:
- Set "to" to the sender's email address
- Set "subject" to "Re: ${email.subject.replace(/"/g, '\\"')}"
- Set "threadId" to "${email.threadId}" to keep it in the same thread
- Set "body" to your response text`;
}

/**
 * Ensure the email group folder exists with a CLAUDE.md.
 */
export function ensureEmailGroupFolder(folder: string): void {
  const groupDir = resolveGroupFolderPath(folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(
      claudeMdPath,
      `# Email Channel

You are responding to emails. Your responses will be sent as email replies via Gmail MCP.

## Guidelines

- Be professional and clear
- Keep responses concise but complete
- If the email requires action you can't take, explain what the user should do
- Use the \`mcp__gmail__send_email\` tool to send your reply

## Context

Each email thread has its own conversation history.
`,
    );
  }
}
