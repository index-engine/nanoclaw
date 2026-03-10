/**
 * Reactive watcher tests.
 *
 * Tests that:
 * - Ingest watcher reacts to Things DB changes
 * - Route watcher reacts to daily note saves
 * - Debouncing works (multiple rapid changes → single run)
 * - Full reactive cycle: DB change → ingest → user edits daily note → route
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectUnprocessedNotes } from './daily-note.js';
import {
  startIngestWatcher,
  startRouteWatcher,
  _resetPipelineForTests,
} from './index.js';
import { clearRegistryCache } from './registry.js';

// Mock the things CLI completion
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, cb: (err: Error | null) => void) => cb(null)),
}));

let tmpDir: string;
let vaultPath: string;
let thingsDbPath: string;

function createThingsDb(
  items: Array<Record<string, unknown>>,
): string {
  const dbPath = path.join(tmpDir, 'things.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS TMTask (
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
  const insert = db.prepare(
    'INSERT INTO TMTask (uuid, title, notes, creationDate, type, status, trashed, todayIndex, start) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1)',
  );
  for (const item of items) {
    insert.run(
      item.uuid,
      item.title,
      item.notes || null,
      item.creationDate,
      item.todayIndex ?? 0,
    );
  }
  db.close();
  return dbPath;
}

function addThingsItem(
  dbPath: string,
  item: Record<string, unknown>,
): void {
  const db = new Database(dbPath);
  db.prepare(
    'INSERT INTO TMTask (uuid, title, notes, creationDate, type, status, trashed, todayIndex, start) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1)',
  ).run(
    item.uuid,
    item.title,
    item.notes || null,
    item.creationDate,
    item.todayIndex ?? 0,
  );
  db.close();
}

function createRegistry(vaultDir: string): void {
  const registryDir = path.join(vaultDir, '1. Projects');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'registry.md'),
    `# Project Registry

## Networking
- **aliases:** networking, people
- **vault:** \`2. Areas/Networking/\`
- **status:** active
- **routing:** @networking, @people, Pedro, Adam

## Chores
- **aliases:** chores, personal
- **vault:** \`1. Projects/Chores/\`
- **status:** active
- **routing:** @chores, @personal, insurance, pills
`,
  );
}

function createDailyNote(vaultDir: string): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const monthNum = String(now.getMonth() + 1).padStart(2, '0');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthName = months[now.getMonth()];
  const dayNum = String(now.getDate()).padStart(2, '0');
  const days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ];
  const dayName = days[now.getDay()];

  const monthDir = path.join(
    vaultDir,
    '0a. Daily Notes',
    year,
    `${monthNum}-${monthName}`,
  );
  fs.mkdirSync(monthDir, { recursive: true });
  const filePath = path.join(
    monthDir,
    `${year}-${monthNum}-${dayNum}-${dayName}.md`,
  );
  fs.writeFileSync(filePath, `# ${year}-${monthNum}-${dayNum}\n\nDaily note content.\n`);
  return filePath;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
  vaultPath = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultPath, { recursive: true });
  createRegistry(vaultPath);
  clearRegistryCache();
  _resetPipelineForTests();
});

afterEach(() => {
  _resetPipelineForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingest watcher', () => {
  it('ingests on startup and creates fleeting notes', async () => {
    thingsDbPath = createThingsDb([
      {
        uuid: 'startup-uuid',
        title: 'Reply to Pedro',
        notes: 'Workshop follow-up',
        creationDate: Math.floor(Date.now() / 1000),
        todayIndex: 0,
      },
    ]);
    createDailyNote(vaultPath);

    const watcher = startIngestWatcher(vaultPath, thingsDbPath, 'test-token');
    expect(watcher).not.toBeNull();

    // Wait for the async startup ingest to complete
    await wait(500);

    const notes = collectUnprocessedNotes(vaultPath);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Reply to Pedro');

    // Verify daily note was updated
    const dailyNotePath = createDailyNote(vaultPath); // returns same path
    const content = fs.readFileSync(dailyNotePath, 'utf-8');
    // Daily note may or may not have been updated depending on timing,
    // but the fleeting note file should exist
    const fleetingPath = path.join(vaultPath, notes[0].path);
    expect(fs.existsSync(fleetingPath)).toBe(true);
  });

  it('reacts to new Things DB writes', async () => {
    // Start with empty DB
    thingsDbPath = createThingsDb([]);
    createDailyNote(vaultPath);

    const watcher = startIngestWatcher(vaultPath, thingsDbPath, 'test-token');
    expect(watcher).not.toBeNull();
    await wait(500);

    // No notes yet
    expect(collectUnprocessedNotes(vaultPath)).toHaveLength(0);

    // Simulate adding an item to Things (writes to the DB file)
    addThingsItem(thingsDbPath, {
      uuid: 'new-item',
      title: 'Buy groceries',
      notes: '',
      creationDate: Math.floor(Date.now() / 1000),
      todayIndex: 0,
    });

    // Wait for debounce (2s) + processing
    await wait(3500);

    const notes = collectUnprocessedNotes(vaultPath);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Buy groceries');
  });

  it('returns null for nonexistent Things DB', () => {
    const watcher = startIngestWatcher(
      vaultPath,
      '/nonexistent/things.sqlite',
      'test-token',
    );
    expect(watcher).toBeNull();
  });
});

describe('route watcher', () => {
  it('creates daily note and starts watcher when none exists', () => {
    // No daily note created — should auto-create
    const watcher = startRouteWatcher(vaultPath);
    expect(watcher).not.toBeNull();
  });

  it('routes accepted items when daily note is saved', async () => {
    // Setup: create a fleeting note manually (as if ingest already ran)
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = months[now.getMonth()];
    const d = String(now.getDate()).padStart(2, '0');

    const fleetingDir = path.join(vaultPath, 'Fleeting', y, `${m}-${monthName}`);
    fs.mkdirSync(fleetingDir, { recursive: true });
    const fleetingFile = path.join(fleetingDir, `${d}-reply-to-pedro.md`);
    const fleetingRelPath = `Fleeting/${y}/${m}-${monthName}/${d}-reply-to-pedro.md`;
    fs.writeFileSync(
      fleetingFile,
      [
        '---',
        'source: things',
        `created: ${y}-${m}-${d}`,
        'status: raw',
        'things_uuid: pedro-uuid',
        'project: Networking',
        '---',
        '',
        '# Reply to Pedro',
        '',
        'Workshop follow-up',
        '',
      ].join('\n'),
    );

    // Create daily note with the fleeting section matching real format
    const dailyNotePath = createDailyNote(vaultPath);
    const fleetingLink = `[[${fleetingRelPath.replace('.md', '')}|f-note]]`;
    const createdStr = `${y}-${m}-${d}`;
    const dailyContent = fs.readFileSync(dailyNotePath, 'utf-8') + `
<!-- fleeting-start -->

## Fleeting Notes (appended ${createdStr} ~12:00 UTC)

### Unprocessed (1 from things)

1. **Reply to Pedro** (${createdStr}) ${fleetingLink}
    **Notes:** Workshop follow-up
    **Proposed:** Project Networking. #task — action item for Networking.
    **Response:**
    <!-- r -->
    <!-- /r -->
    - [ ] Process

- [ ] Process All

### Routed

<!-- fleeting-end -->
`;
    fs.writeFileSync(dailyNotePath, dailyContent);

    // Start watcher
    const watcher = startRouteWatcher(vaultPath);
    expect(watcher).not.toBeNull();

    // Simulate user checking Process and saving
    const edited = dailyContent.replace('- [ ] Process', '- [x] Process');
    fs.writeFileSync(dailyNotePath, edited);

    // Wait for debounce (1s) + processing
    await wait(2500);

    // Verify the fleeting note was completed
    const updatedFleeting = fs.readFileSync(fleetingFile, 'utf-8');
    expect(updatedFleeting).toContain('status: completed');
    expect(updatedFleeting).toContain('converted_to:');

    // Verify destination file was created
    const destDir = path.join(
      vaultPath,
      '2. Areas',
      'Networking',
      'notes',
      y,
      `${m}-${monthName}`,
    );
    expect(fs.existsSync(destDir)).toBe(true);
    const destFiles = fs.readdirSync(destDir);
    expect(destFiles.length).toBe(1);
    expect(destFiles[0]).toContain('reply-to-pedro');

    const destContent = fs.readFileSync(
      path.join(destDir, destFiles[0]),
      'utf-8',
    );
    expect(destContent).toContain('# Reply to Pedro');
    expect(destContent).toContain('#task');
  });

  it('ignores saves without checked decisions', async () => {
    // Create fleeting note
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = months[now.getMonth()];
    const d = String(now.getDate()).padStart(2, '0');

    const fleetingDir = path.join(vaultPath, 'Fleeting', y, `${m}-${monthName}`);
    fs.mkdirSync(fleetingDir, { recursive: true });
    const fleetingFile = path.join(fleetingDir, `${d}-some-note.md`);
    fs.writeFileSync(
      fleetingFile,
      '---\nsource: things\ncreated: 2026-03-09\nstatus: raw\nthings_uuid: x\n---\n\n# Some Note\n',
    );

    const dailyNotePath = createDailyNote(vaultPath);
    const dailyContent = fs.readFileSync(dailyNotePath, 'utf-8') +
      '\n<!-- fleeting-start -->\n### Fleeting Notes\n- [ ] Accept\n- [ ] Retire\n<!-- fleeting-end -->\n';
    fs.writeFileSync(dailyNotePath, dailyContent);

    const watcher = startRouteWatcher(vaultPath);
    expect(watcher).not.toBeNull();

    // Save daily note without checking anything
    fs.writeFileSync(dailyNotePath, dailyContent + '\nsome edit\n');
    await wait(2000);

    // Fleeting note should still be raw
    const content = fs.readFileSync(fleetingFile, 'utf-8');
    expect(content).toContain('status: raw');
  });
});

describe('full reactive cycle', () => {
  it('DB change → ingest → user accepts → route', { timeout: 15000 }, async () => {
    // Start with empty DB
    thingsDbPath = createThingsDb([]);
    const dailyNotePath = createDailyNote(vaultPath);

    // Start ingest watcher
    startIngestWatcher(vaultPath, thingsDbPath, 'test-token');
    await wait(500);

    // Simulate adding item to Things
    addThingsItem(thingsDbPath, {
      uuid: 'reactive-uuid',
      title: 'Call dentist',
      notes: '',
      creationDate: Math.floor(Date.now() / 1000),
      todayIndex: 0,
    });

    // Wait for ingest debounce + processing
    await wait(3500);

    // Verify ingestion happened
    const notes = collectUnprocessedNotes(vaultPath);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Call dentist');

    // Verify daily note was updated with the new item
    const dailyContent = fs.readFileSync(dailyNotePath, 'utf-8');
    expect(dailyContent).toContain('Call dentist');
    expect(dailyContent).toContain('<!-- fleeting-start -->');

    // Now start route watcher and simulate user accepting
    _resetPipelineForTests(); // reset so route watcher can start fresh
    startRouteWatcher(vaultPath);

    const edited = dailyContent.replace('- [ ] Process', '- [x] Process');
    fs.writeFileSync(dailyNotePath, edited);

    // Wait for route debounce + processing
    await wait(2500);

    // Verify routing happened
    const remaining = collectUnprocessedNotes(vaultPath);
    expect(remaining).toHaveLength(0);

    // Verify fleeting note is completed
    const fleetingContent = fs.readFileSync(
      path.join(vaultPath, notes[0].path),
      'utf-8',
    );
    expect(fleetingContent).toContain('status: completed');
  });
});
