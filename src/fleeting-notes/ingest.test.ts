import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFleetingNoteContent,
  convertDollarTags,
  findExistingUuids,
  fleetingNotePath,
  ingestThingsToday,
  readThingsToday,
  slugify,
} from './ingest.js';
import { clearRegistryCache } from './registry.js';

// Mock the things CLI completion
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, cb: (err: Error | null) => void) => cb(null)),
}));

let tmpDir: string;
let vaultPath: string;
let thingsDbPath: string;

function createThingsDb(items: Array<Record<string, unknown>>): string {
  const dbPath = path.join(tmpDir, 'things.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE TMTask (
      uuid TEXT PRIMARY KEY,
      title TEXT,
      notes TEXT,
      creationDate REAL,
      type INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      trashed INTEGER DEFAULT 0,
      todayIndex INTEGER,
      start INTEGER DEFAULT 0,
      project TEXT,
      heading TEXT
    )
  `);
  const insertWithToday = db.prepare(
    'INSERT INTO TMTask (uuid, title, notes, creationDate, type, status, trashed, todayIndex, start) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1)',
  );
  const insertWithoutToday = db.prepare(
    'INSERT INTO TMTask (uuid, title, notes, creationDate, type, status, trashed) VALUES (?, ?, ?, ?, 0, 0, 0)',
  );
  for (const item of items) {
    if (item.todayIndex === null || item.todayIndex === undefined) {
      insertWithoutToday.run(
        item.uuid,
        item.title,
        item.notes || null,
        item.creationDate,
      );
    } else {
      insertWithToday.run(
        item.uuid,
        item.title,
        item.notes || null,
        item.creationDate,
        item.todayIndex,
      );
    }
  }
  db.close();
  return dbPath;
}

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleeting-test-'));
  vaultPath = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultPath, { recursive: true });
  createRegistry(vaultPath);
  clearRegistryCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('slugify', () => {
  it('converts title to lowercase slug', () => {
    expect(slugify('Reply to Pedro')).toBe('reply-to-pedro');
  });

  it('strips special characters', () => {
    expect(slugify('Apply?')).toBe('apply');
  });

  it('handles multiple spaces', () => {
    expect(slugify('buy   the  printer  toner')).toBe(
      'buy-the-printer-toner',
    );
  });

  it('truncates at 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  it('handles unicode by stripping non-ascii', () => {
    expect(slugify('café meeting')).toBe('caf-meeting');
  });

  it('returns empty for empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('fleetingNotePath', () => {
  it('generates correct path structure', () => {
    const date = new Date(2026, 2, 7); // March 7, 2026
    expect(fleetingNotePath(date, 'pedro-reply')).toBe(
      'Fleeting/2026/03-March/07-pedro-reply.md',
    );
  });

  it('pads month and day', () => {
    const date = new Date(2026, 0, 5); // Jan 5
    expect(fleetingNotePath(date, 'test')).toBe(
      'Fleeting/2026/01-January/05-test.md',
    );
  });
});

describe('convertDollarTags', () => {
  it('converts $tag to #tag', () => {
    expect(convertDollarTags('Buy milk $task')).toBe('Buy milk #task');
  });

  it('converts multiple tags', () => {
    expect(convertDollarTags('$task $spark idea')).toBe('#task #spark idea');
  });

  it('leaves text without $ unchanged', () => {
    expect(convertDollarTags('No tags here')).toBe('No tags here');
  });

  it('does not convert $ not followed by word char', () => {
    expect(convertDollarTags('Price is $5.00')).toBe('Price is $5.00');
  });
});

describe('buildFleetingNoteContent', () => {
  it('builds correct frontmatter and heading', () => {
    const content = buildFleetingNoteContent(
      'Reply to Pedro',
      '',
      '2026-03-07',
      'abc-123',
    );
    expect(content).toContain('source: things');
    expect(content).toContain('created: 2026-03-07');
    expect(content).toContain('things_uuid: abc-123');
    expect(content).toContain('status: raw');
    expect(content).toContain('# Reply to Pedro');
  });

  it('includes body when present', () => {
    const content = buildFleetingNoteContent(
      'Test',
      'Some notes here',
      '2026-03-07',
      'abc',
    );
    expect(content).toContain('Some notes here');
  });

  it('strips trailing whitespace from title', () => {
    const content = buildFleetingNoteContent(
      'Title with spaces   ',
      '',
      '2026-03-07',
      'abc',
    );
    expect(content).toContain('# Title with spaces');
    expect(content).not.toContain('# Title with spaces   ');
  });
});

describe('readThingsToday', () => {
  it('reads items from Things Today', () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Task 1',
        notes: 'notes',
        creationDate: 1741334400, // 2025-03-07 approx
        todayIndex: 0,
      },
      {
        uuid: 'u2',
        title: 'Task 2',
        notes: null,
        creationDate: 1741334400,
        todayIndex: 1,
      },
    ]);
    const items = readThingsToday(thingsDbPath);
    expect(items).toHaveLength(2);
    expect(items[0].uuid).toBe('u1');
    expect(items[0].title).toBe('Task 1');
    expect(items[0].notes).toBe('notes');
  });

  it('excludes items not in Today (todayIndex IS NULL)', () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'In Today',
        creationDate: 1741334400,
        todayIndex: 0,
      },
      {
        uuid: 'u2',
        title: 'Not in Today',
        creationDate: 1741334400,
        todayIndex: null,
      },
    ]);
    const items = readThingsToday(thingsDbPath);
    expect(items).toHaveLength(1);
    expect(items[0].uuid).toBe('u1');
  });

  it('returns empty array for nonexistent DB', () => {
    const items = readThingsToday('/nonexistent/path.sqlite');
    expect(items).toEqual([]);
  });
});

describe('findExistingUuids', () => {
  it('finds UUIDs from fleeting note frontmatter', () => {
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '07');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, 'test.md'),
      '---\nthings_uuid: abc-123\nstatus: raw\n---\n# Test\n',
    );
    const uuids = findExistingUuids(vaultPath);
    expect(uuids.has('abc-123')).toBe(true);
  });

  it('returns empty set when no Fleeting directory', () => {
    const uuids = findExistingUuids(vaultPath);
    expect(uuids.size).toBe(0);
  });

  it('skips routing session files (underscore prefix)', () => {
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '07');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, '_routing-session-001.md'),
      '---\ntype: routing-session\n---\n',
    );
    const uuids = findExistingUuids(vaultPath);
    expect(uuids.size).toBe(0);
  });
});

describe('ingestThingsToday', () => {
  it('creates fleeting notes from Things Today items', async () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Reply to Pedro',
        notes: 'About the workshop',
        creationDate: 1772604800, // 2026-03-02 approx
        todayIndex: 0,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created).toHaveLength(1);
    expect(result.created[0].title).toBe('Reply to Pedro');
    expect(result.created[0].slug).toBe('reply-to-pedro');
    expect(result.created[0].source).toBe('things');

    // Verify file exists
    const notePath = path.join(vaultPath, result.created[0].path);
    expect(fs.existsSync(notePath)).toBe(true);

    // Verify content
    const content = fs.readFileSync(notePath, 'utf-8');
    expect(content).toContain('things_uuid: u1');
    expect(content).toContain('status: raw');
    expect(content).toContain('# Reply to Pedro');
    expect(content).toContain('About the workshop');
  });

  it('deduplicates by Things UUID', async () => {
    // Create existing note with UUID u1
    const noteDir = path.join(vaultPath, 'Fleeting', '2026', '03', '02');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(
      path.join(noteDir, 'existing.md'),
      '---\nthings_uuid: u1\nstatus: raw\n---\n# Existing\n',
    );

    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Reply to Pedro',
        creationDate: 1772604800,
        todayIndex: 0,
      },
      {
        uuid: 'u2',
        title: 'New item',
        creationDate: 1772604800,
        todayIndex: 1,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created).toHaveLength(1);
    expect(result.created[0].title).toBe('New item');
    expect(result.skipped).toContain('u1');
  });

  it('skips items with empty titles', async () => {
    thingsDbPath = createThingsDb([
      { uuid: 'u1', title: '', creationDate: 1772604800, todayIndex: 0 },
      { uuid: 'u2', title: '   ', creationDate: 1772604800, todayIndex: 1 },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it('detects project from @tag in title', async () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: '@nanoclaw fix the sync',
        creationDate: 1772604800,
        todayIndex: 0,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created[0].project).toBe('NanoClaw');
  });

  it('detects project from keyword in title', async () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Resubmit insurance claim',
        creationDate: 1772604800,
        todayIndex: 0,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created[0].project).toBe('Chores');
  });

  it('handles items with no project match', async () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Random thought',
        creationDate: 1772604800,
        todayIndex: 0,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created[0].project).toBeUndefined();
  });

  it('uses Unix timestamps directly (not Core Data epoch)', async () => {
    // 2026-03-07 00:00:00 UTC = 1772604800
    thingsDbPath = createThingsDb([
      {
        uuid: 'u1',
        title: 'Test date',
        creationDate: 1772604800,
        todayIndex: 0,
      },
    ]);

    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    // Should be 2026-03-02 (local time), NOT 2053 (which would be Core Data epoch bug)
    const year = parseInt(result.created[0].created.slice(0, 4));
    expect(year).toBeGreaterThan(2025);
    expect(year).toBeLessThan(2030);
  });

  it('returns empty result when Things Today is empty', async () => {
    thingsDbPath = createThingsDb([]);
    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      'test-token',
    );
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
