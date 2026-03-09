import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmailNoteContent,
  cleanSubject,
  extractEmailAddress,
  findExistingEmailIds,
  ingestEmails,
  parseEmail,
  stripHtml,
  truncateBody,
  type EmailConfig,
  type ParsedEmail,
} from './email-ingest.js';
import { clearRegistryCache } from './registry.js';

// Mock imapflow
const mockFlagsAdd = vi.fn();
const mockFetchOne = vi.fn();
const mockSearch = vi.fn();
const mockGetMailboxLock = vi.fn();
const mockConnect = vi.fn();
const mockLogout = vi.fn();

vi.mock('imapflow', () => ({
  ImapFlow: class MockImapFlow {
    constructor() {
      return {
        connect: mockConnect,
        logout: mockLogout,
        getMailboxLock: mockGetMailboxLock.mockResolvedValue({
          release: vi.fn(),
        }),
        search: mockSearch,
        fetchOne: mockFetchOne,
        messageFlagsAdd: mockFlagsAdd,
      };
    }
  },
}));

let tmpDir: string;
let vaultPath: string;

function createRegistry(vaultDir: string): void {
  const registryDir = path.join(vaultDir, '1. Projects');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'registry.md'),
    `# Project Registry

## Chores
- **aliases:** chores, personal
- **vault:** \`1. Projects/Chores/\`
- **status:** active
- **routing:** @chores, @personal, insurance, pills

## NanoClaw
- **aliases:** nanoclaw, claw
- **vault:** \`1. Projects/AI Assistant/\`
- **status:** active
- **routing:** @nanoclaw, @claw
`,
  );
}

const defaultConfig: EmailConfig = {
  user: 'agent@gmail.com',
  password: 'xxxx xxxx xxxx xxxx',
  allowedSenders: ['user@gmail.com'],
};

function buildRawEmail(opts: {
  from?: string;
  subject?: string;
  body?: string;
  messageId?: string;
  date?: string;
}): string {
  const from = opts.from || 'Test User <user@gmail.com>';
  const subject = opts.subject || 'Test Subject';
  const body = opts.body || 'Email body content.';
  const messageId = opts.messageId || '<test-123@mail.gmail.com>';
  const date = opts.date || 'Sat, 07 Mar 2026 10:00:00 +0000';

  return [
    `From: ${from}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
  vaultPath = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultPath, { recursive: true });
  createRegistry(vaultPath);
  clearRegistryCache();
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockLogout.mockResolvedValue(undefined);
  mockFlagsAdd.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cleanSubject', () => {
  it('strips Fwd: prefix', () => {
    expect(cleanSubject('Fwd: Important email')).toBe('Important email');
  });

  it('strips Re: prefix', () => {
    expect(cleanSubject('Re: Follow up')).toBe('Follow up');
  });

  it('strips nested Fwd: Re: prefixes', () => {
    expect(cleanSubject('Fwd: Re: Fwd: Topic')).toBe('Topic');
  });

  it('handles Fw: variant', () => {
    expect(cleanSubject('Fw: Forwarded mail')).toBe('Forwarded mail');
  });

  it('preserves clean subjects', () => {
    expect(cleanSubject('Normal subject')).toBe('Normal subject');
  });

  it('handles empty subject', () => {
    expect(cleanSubject('')).toBe('');
  });
});

describe('extractEmailAddress', () => {
  it('extracts from angle bracket format', () => {
    expect(extractEmailAddress('John Doe <john@example.com>')).toBe(
      'john@example.com',
    );
  });

  it('handles bare email', () => {
    expect(extractEmailAddress('john@example.com')).toBe('john@example.com');
  });

  it('lowercases the result', () => {
    expect(extractEmailAddress('User <USER@Gmail.COM>')).toBe(
      'user@gmail.com',
    );
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('converts br to newlines', () => {
    expect(stripHtml('line1<br>line2<br/>line3')).toBe('line1\nline2\nline3');
  });

  it('converts p closing to double newline', () => {
    expect(stripHtml('<p>para1</p><p>para2</p>')).toBe('para1\n\npara2');
  });

  it('decodes common entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe("& < > \" '");
  });

  it('collapses excessive newlines', () => {
    expect(stripHtml('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('truncateBody', () => {
  it('returns short body unchanged', () => {
    expect(truncateBody('short', 100)).toBe('short');
  });

  it('truncates at line boundary', () => {
    const body = 'line1\nline2\nline3\nline4';
    const result = truncateBody(body, 15);
    expect(result).toContain('*(truncated)*');
    expect(result.length).toBeLessThan(body.length + 20);
  });

  it('uses default max of 2000', () => {
    const short = 'a'.repeat(1999);
    expect(truncateBody(short)).toBe(short);

    const long = 'a'.repeat(2001);
    expect(truncateBody(long)).toContain('*(truncated)*');
  });
});

describe('buildEmailNoteContent', () => {
  const email: ParsedEmail = {
    messageId: '<test-123@mail.gmail.com>',
    from: 'user@gmail.com',
    subject: 'Fwd: Important topic',
    date: new Date(2026, 2, 7),
    textBody: 'This is the email body.',
  };

  it('builds correct frontmatter', () => {
    const content = buildEmailNoteContent(email);
    expect(content).toContain('source: email');
    expect(content).toContain('created: 2026-03-07');
    expect(content).toContain('email_from: user@gmail.com');
    expect(content).toContain('email_subject: "Fwd: Important topic"');
    expect(content).toContain(
      'email_message_id: <test-123@mail.gmail.com>',
    );
    expect(content).toContain('status: raw');
  });

  it('uses cleaned subject as title', () => {
    const content = buildEmailNoteContent(email);
    expect(content).toContain('# Important topic');
    expect(content).not.toContain('# Fwd:');
  });

  it('includes body', () => {
    const content = buildEmailNoteContent(email);
    expect(content).toContain('This is the email body.');
  });

  it('includes project when provided', () => {
    const content = buildEmailNoteContent(email, 'NanoClaw');
    expect(content).toContain('project: NanoClaw');
  });

  it('omits project when not provided', () => {
    const content = buildEmailNoteContent(email);
    expect(content).not.toContain('project:');
  });

  it('handles no subject', () => {
    const noSubject = { ...email, subject: '' };
    const content = buildEmailNoteContent(noSubject);
    expect(content).toContain('# (no subject)');
  });

  it('escapes quotes in subject', () => {
    const quotedSubject = { ...email, subject: 'He said "hello"' };
    const content = buildEmailNoteContent(quotedSubject);
    expect(content).toContain('email_subject: "He said \\"hello\\""');
  });
});

describe('parseEmail', () => {
  it('parses plain text email', async () => {
    const raw = buildRawEmail({
      from: 'John <john@example.com>',
      subject: 'Test Subject',
      body: 'Hello world',
      messageId: '<abc@mail>',
    });

    const result = await parseEmail(Buffer.from(raw));
    expect(result.from).toBe('john@example.com');
    expect(result.subject).toBe('Test Subject');
    expect(result.textBody).toContain('Hello world');
    expect(result.messageId).toBe('<abc@mail>');
  });

  it('handles HTML-only email by stripping tags', async () => {
    const raw = [
      'From: user@gmail.com',
      'Subject: HTML Email',
      'Message-ID: <html-1@mail>',
      'Date: Sat, 07 Mar 2026 10:00:00 +0000',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>Hello <b>world</b></p></body></html>',
    ].join('\r\n');

    const result = await parseEmail(Buffer.from(raw));
    expect(result.textBody).toContain('Hello world');
    expect(result.textBody).not.toContain('<');
  });

  it('generates fallback message ID when missing', async () => {
    const raw = [
      'From: user@gmail.com',
      'Subject: No ID',
      'Date: Sat, 07 Mar 2026 10:00:00 +0000',
      'Content-Type: text/plain',
      '',
      'Body text',
    ].join('\r\n');

    const result = await parseEmail(Buffer.from(raw));
    expect(result.messageId).toMatch(/^no-id-\d+$/);
  });
});

describe('findExistingEmailIds', () => {
  it('finds message IDs from email fleeting notes', () => {
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '07');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, 'test-email.md'),
      '---\nsource: email\nemail_message_id: <abc@mail>\nstatus: raw\n---\n# Test\n',
    );

    const ids = findExistingEmailIds(vaultPath);
    expect(ids.has('<abc@mail>')).toBe(true);
  });

  it('returns empty set when no Fleeting directory', () => {
    const ids = findExistingEmailIds(vaultPath);
    expect(ids.size).toBe(0);
  });

  it('does not pick up things_uuid as email ID', () => {
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '07');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, 'things-note.md'),
      '---\nsource: things\nthings_uuid: uuid-1\nstatus: raw\n---\n# Things Note\n',
    );

    const ids = findExistingEmailIds(vaultPath);
    expect(ids.size).toBe(0);
  });
});

describe('ingestEmails', () => {
  it('creates fleeting note from unread email', async () => {
    const raw = buildRawEmail({
      from: 'Test User <user@gmail.com>',
      subject: 'Resubmit insurance claim',
      body: 'Details about the insurance.',
      messageId: '<ins-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, defaultConfig);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].source).toBe('email');
    expect(result.created[0].title).toBe('Resubmit insurance claim');
    expect(result.created[0].emailMessageId).toBe('<ins-1@mail>');
    expect(result.created[0].project).toBe('Chores');

    // Verify file was written
    const absPath = path.join(vaultPath, result.created[0].path);
    expect(fs.existsSync(absPath)).toBe(true);
    const content = fs.readFileSync(absPath, 'utf-8');
    expect(content).toContain('source: email');
    expect(content).toContain('email_message_id: <ins-1@mail>');
    expect(content).toContain('# Resubmit insurance claim');

    // Verify marked as seen
    expect(mockFlagsAdd).toHaveBeenCalledWith(1, ['\\Seen']);
  });

  it('skips emails from non-allowed senders', async () => {
    const raw = buildRawEmail({
      from: 'Spammer <spam@evil.com>',
      subject: 'Buy now!',
      messageId: '<spam-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, defaultConfig);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toContain('<spam-1@mail>');
    // Should still mark as seen
    expect(mockFlagsAdd).toHaveBeenCalled();
  });

  it('deduplicates by message ID', async () => {
    // Create existing note with same message ID
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '07');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, 'existing.md'),
      '---\nsource: email\nemail_message_id: <dup-1@mail>\nstatus: raw\n---\n# Existing\n',
    );

    const raw = buildRawEmail({
      from: 'User <user@gmail.com>',
      subject: 'Duplicate email',
      messageId: '<dup-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, defaultConfig);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toContain('<dup-1@mail>');
  });

  it('handles no unread emails', async () => {
    mockSearch.mockResolvedValue([]);

    const result = await ingestEmails(vaultPath, defaultConfig);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('handles IMAP connection failure', async () => {
    mockConnect.mockRejectedValue(new Error('Connection refused'));

    const result = await ingestEmails(vaultPath, defaultConfig);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Connection refused');
  });

  it('skips when no credentials configured', async () => {
    const result = await ingestEmails(vaultPath, {
      user: '',
      password: '',
      allowedSenders: [],
    });
    expect(result.created).toHaveLength(0);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('processes multiple emails', async () => {
    const raw1 = buildRawEmail({
      from: 'User <user@gmail.com>',
      subject: 'Email one',
      messageId: '<one@mail>',
    });
    const raw2 = buildRawEmail({
      from: 'User <user@gmail.com>',
      subject: 'Email two',
      messageId: '<two@mail>',
    });

    mockSearch.mockResolvedValue([1, 2]);
    mockFetchOne
      .mockResolvedValueOnce({ source: Buffer.from(raw1) })
      .mockResolvedValueOnce({ source: Buffer.from(raw2) });

    const result = await ingestEmails(vaultPath, defaultConfig);
    expect(result.created).toHaveLength(2);
  });

  it('allows all senders when allowlist is empty', async () => {
    const raw = buildRawEmail({
      from: 'Anyone <anyone@anywhere.com>',
      subject: 'Open inbox',
      messageId: '<open-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, {
      ...defaultConfig,
      allowedSenders: [],
    });

    expect(result.created).toHaveLength(1);
  });

  it('strips Fwd: from title in created note', async () => {
    const raw = buildRawEmail({
      from: 'User <user@gmail.com>',
      subject: 'Fwd: Re: Original topic',
      messageId: '<fwd-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, defaultConfig);
    expect(result.created[0].title).toBe('Original topic');
  });

  it('detects project from email content', async () => {
    const raw = buildRawEmail({
      from: 'User <user@gmail.com>',
      subject: '@nanoclaw sync bug report',
      messageId: '<proj-1@mail>',
    });

    mockSearch.mockResolvedValue([1]);
    mockFetchOne.mockResolvedValue({ source: Buffer.from(raw) });

    const result = await ingestEmails(vaultPath, defaultConfig);
    expect(result.created[0].project).toBe('NanoClaw');
  });
});
