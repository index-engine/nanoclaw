import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearRegistryCache } from './registry.js';
import {
  appendToRoutedSection,
  buildPermanentNote,
  buildProjectNote,
  detectRoutingAction,
  executeRoute,
  parseDecisions,
  processDecisions,
  projectNotePath,
  updateFleetingNoteStatus,
} from './route.js';
import type { FleetingNote, ProjectRegistryEntry } from './types.js';

let tmpDir: string;
let vaultPath: string;

function makeNote(overrides: Partial<FleetingNote> = {}): FleetingNote {
  return {
    path: 'Fleeting/2026/03/07/test-note.md',
    slug: 'test-note',
    title: 'Test Note',
    body: '',
    source: 'things',
    thingsUuid: 'uuid-1',
    created: '2026-03-07',
    status: 'raw',
    ...overrides,
  };
}

function makeRegistry(): ProjectRegistryEntry[] {
  return [
    {
      name: 'Chores',
      aliases: ['chores', 'personal'],
      vault: '1. Projects/Chores/',
      status: 'active',
      routing: ['@chores', '@personal', 'insurance', 'pills'],
    },
    {
      name: 'NanoClaw',
      aliases: ['nanoclaw', 'claw'],
      vault: '1. Projects/AI Assistant/',
      status: 'active',
      routing: ['@nanoclaw', '@claw'],
    },
  ];
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

function createFleetingNote(
  vaultDir: string,
  relPath: string,
  content: string,
): void {
  const absPath = path.join(vaultDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-test-'));
  vaultPath = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultPath, { recursive: true });
  createRegistry(vaultPath);
  clearRegistryCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseDecisions', () => {
  it('parses accepted item', () => {
    const content = `
<!-- fleeting-start -->

## Fleeting Notes (appended 2026-03-07 ~14:00 UTC)

### Unprocessed (1 from things)

1. **Reply to Pedro** (2026-03-07) [[Fleeting/2026/03/07/reply-to-pedro|f-note]]
    **Notes:** About the workshop
    **Proposed:** Project Chores. #task — action item for Chores.
    **Response:**
    - [x] Process

### Routed

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('accept');
    expect(decisions[0].fleetingPath).toBe(
      'Fleeting/2026/03/07/reply-to-pedro.md',
    );
    expect(decisions[0].itemIndex).toBe(1);
  });

  it('parses retired item via Retire + Process checkboxes', () => {
    const content = `
<!-- fleeting-start -->

1. **Test Item** (2026-03-07) [[Fleeting/2026/03/07/test-item|f-note]]
    **Proposed:** Retire — test item.
    - [x] Retire
    **Response:**
    - [x] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('retire');
  });

  it('ignores Retire without Process', () => {
    const content = `
<!-- fleeting-start -->

1. **Test Item** (2026-03-07) [[Fleeting/2026/03/07/test-item|f-note]]
    **Proposed:** Retire — test item.
    - [x] Retire
    **Response:**
    - [ ] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(0);
  });

  it('parses response text', () => {
    const content = `
<!-- fleeting-start -->

1. **Note** (2026-03-07) [[Fleeting/2026/03/07/note|f-note]]
    **Proposed:** Permanent note.
    **Response:** This is my expanded thought on the topic.
    - [x] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('response');
    expect(decisions[0].responseText).toBe(
      'This is my expanded thought on the topic.',
    );
  });

  it('parses Process All — routes all items', () => {
    const content = `
<!-- fleeting-start -->

1. **Note One** (2026-03-07) [[Fleeting/2026/03/07/note-one|f-note]]
    **Proposed:** Permanent note.
    **Response:**
    - [ ] Process

2. **Note Two** (2026-03-07) [[Fleeting/2026/03/07/note-two|f-note]]
    **Proposed:** #task item.
    **Response:**
    - [ ] Process

- [x] Process All

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].action).toBe('accept');
    expect(decisions[1].action).toBe('accept');
  });

  it('skips items with no action', () => {
    const content = `
<!-- fleeting-start -->

1. **Note** (2026-03-07) [[Fleeting/2026/03/07/note|f-note]]
    **Proposed:** Permanent note.
    **Response:**
    - [ ] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(0);
  });

  it('parses multiple items', () => {
    const content = `
<!-- fleeting-start -->

1. **First** (2026-03-07) [[Fleeting/2026/03/07/first|f-note]]
    **Proposed:** #task item.
    **Response:**
    - [x] Process

2. **Second** (2026-03-07) [[Fleeting/2026/03/07/second|f-note]]
    **Proposed:** Retire — stale.
    - [x] Retire
    **Response:**
    - [x] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].action).toBe('accept');
    expect(decisions[1].action).toBe('retire');
  });

  it('parses multi-line response between <!-- r --> delimiters', () => {
    const content = `
<!-- fleeting-start -->

1. **Article** (2026-03-07) [[Fleeting/2026/03/07/article|f-note]]
    **Proposed:** Literature note.
    **Response:**
    <!-- r -->
    Here is the full article text.
    It spans multiple lines.

    Even with blank lines in between.
    <!-- /r -->
    - [x] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('response');
    expect(decisions[0].responseText).toContain(
      'Here is the full article text.',
    );
    expect(decisions[0].responseText).toContain(
      'Even with blank lines in between.',
    );
  });

  it('returns empty when no markers', () => {
    expect(parseDecisions('# Just a regular note')).toEqual([]);
  });

  it('extracts proposal text', () => {
    const content = `
<!-- fleeting-start -->

1. **Note** (2026-03-07) [[Fleeting/2026/03/07/note|f-note]]
    **Proposed:** Project Chores. #task — action item for Chores.
    **Response:**
    - [x] Process

<!-- fleeting-end -->`;

    const decisions = parseDecisions(content);
    expect(decisions[0].proposal?.text).toBe(
      'Project Chores. #task — action item for Chores.',
    );
  });
});

describe('projectNotePath', () => {
  it('generates correct path', () => {
    expect(
      projectNotePath('1. Projects/Chores/', '2026-03-07', 'reply-to-pedro'),
    ).toBe(
      '1. Projects/Chores/notes/2026/03-March/2026-03-07-reply-to-pedro.md',
    );
  });
});

describe('buildProjectNote', () => {
  it('creates project note with #task', () => {
    const content = buildProjectNote(
      'Reply to Pedro',
      'Fleeting/2026/03/07/reply-to-pedro.md',
      '2026-03-07',
      'Chores',
    );
    expect(content).toContain('# Reply to Pedro');
    expect(content).toContain(
      '- [ ] #task Reply to Pedro [[Fleeting/2026/03/07/reply-to-pedro|*]]',
    );
    expect(content).toContain('source: fleeting');
    expect(content).toContain('project: chores');
    expect(content).toContain('type: project-note');
  });
});

describe('buildPermanentNote', () => {
  it('creates permanent note with source link', () => {
    const content = buildPermanentNote(
      'AI Insight',
      'Models generalize well across domains.',
      'Fleeting/2026/03/07/ai-insight.md',
      '2026-03-07',
      'NanoClaw',
    );
    expect(content).toContain('# AI Insight');
    expect(content).toContain('Models generalize well across domains.');
    expect(content).toContain('Source: [[Fleeting/2026/03/07/ai-insight|*]]');
    expect(content).toContain('type: permanent-note');
    expect(content).toContain('project: nanoclaw');
  });

  it('shows placeholder when no body', () => {
    const content = buildPermanentNote(
      'Empty',
      '',
      'Fleeting/2026/03/07/empty.md',
      '2026-03-07',
    );
    expect(content).toContain('*(awaiting user rewrite)*');
  });

  it('omits project line when no project', () => {
    const content = buildPermanentNote(
      'Test',
      'Body',
      'Fleeting/2026/03/07/test.md',
      '2026-03-07',
    );
    expect(content).not.toContain('project:');
  });
});

describe('detectRoutingAction', () => {
  it('detects task', () => {
    expect(detectRoutingAction('#task — action item')).toBe('task');
  });

  it('detects retire', () => {
    expect(detectRoutingAction('Retire — stale item')).toBe('retire');
  });

  it('detects literature note', () => {
    expect(detectRoutingAction('Literature note + permanent note')).toBe(
      'literature',
    );
  });

  it('detects permanent note', () => {
    expect(detectRoutingAction('Permanent note — insight')).toBe('permanent');
  });

  it('treats former idea log as permanent', () => {
    expect(detectRoutingAction('Idea log entry')).toBe('permanent');
  });

  it('defaults to permanent', () => {
    expect(detectRoutingAction('unknown proposal')).toBe('permanent');
  });
});

describe('updateFleetingNoteStatus', () => {
  it('updates status to completed', () => {
    const relPath = 'Fleeting/2026/03/07/test-note.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Test\n',
    );

    updateFleetingNoteStatus(vaultPath, relPath, 'completed');

    const content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8');
    expect(content).toContain('status: completed');
    expect(content).not.toContain('status: raw');
  });

  it('updates status to retired', () => {
    const relPath = 'Fleeting/2026/03/07/test-note.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Test\n',
    );

    updateFleetingNoteStatus(vaultPath, relPath, 'retired');

    const content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8');
    expect(content).toContain('status: retired');
  });

  it('adds converted_to link', () => {
    const relPath = 'Fleeting/2026/03/07/test-note.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Test\n',
    );

    updateFleetingNoteStatus(
      vaultPath,
      relPath,
      'completed',
      '1. Projects/Chores/notes/2026/03/2026-03-07-test-note.md',
    );

    const content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8');
    expect(content).toContain(
      'converted_to: "[[1. Projects/Chores/notes/2026/03/2026-03-07-test-note]]"',
    );
  });

  it('handles missing file gracefully', () => {
    // Should not throw
    updateFleetingNoteStatus(vaultPath, 'nonexistent.md', 'completed');
  });
});

describe('appendToRoutedSection', () => {
  it('appends routed entry before end marker', () => {
    const content =
      '<!-- fleeting-start -->\n### Routed\n\n<!-- fleeting-end -->';
    const result = appendToRoutedSection(
      content,
      'Fleeting/2026/03/07/test.md',
      'accept',
      '1. Projects/Chores/notes/2026/03/2026-03-07-test.md',
      'Test Note',
      'Chores',
      'task',
    );

    expect(result).toContain(
      '- **Test Note** → Chores as #task — [[Fleeting/2026/03/07/test|f-note]] → [[1. Projects/Chores/notes/2026/03/2026-03-07-test|pr-note]]',
    );
  });

  it('handles entry without destination', () => {
    const content =
      '<!-- fleeting-start -->\n### Routed\n\n<!-- fleeting-end -->';
    const result = appendToRoutedSection(
      content,
      'Fleeting/2026/03/07/test.md',
      'retire',
      undefined,
      'Test Note',
    );

    expect(result).toContain(
      '- **Test Note** → retired — [[Fleeting/2026/03/07/test|f-note]]',
    );
  });
});

describe('executeRoute', () => {
  const registry = makeRegistry();

  it('retires a note', async () => {
    const relPath = 'Fleeting/2026/03/07/test-note.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Test\n',
    );

    const note = makeNote();
    const result = await executeRoute(
      vaultPath,
      {
        itemIndex: 1,
        fleetingPath: relPath,
        action: 'retire',
      },
      note,
      registry,
    );

    expect(result.error).toBeUndefined();
    const content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8');
    expect(content).toContain('status: retired');
  });

  it('creates project note for #task proposal', async () => {
    const relPath = 'Fleeting/2026/03/07/reply-to-pedro.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Reply to Pedro\n',
    );

    const note = makeNote({
      path: relPath,
      slug: 'reply-to-pedro',
      title: 'Reply to Pedro',
      project: 'Chores',
    });

    const result = await executeRoute(
      vaultPath,
      {
        itemIndex: 1,
        fleetingPath: relPath,
        action: 'accept',
        proposal: {
          projectLine: 'Project Chores.',
          text: 'Project Chores. #task — action item for Chores.',
        },
      },
      note,
      registry,
    );

    expect(result.destinationPath).toContain('reply-to-pedro.md');
    expect(result.destinationPath).toContain('1. Projects/Chores/');

    // Verify destination file
    const destContent = fs.readFileSync(
      path.join(vaultPath, result.destinationPath!),
      'utf-8',
    );
    expect(destContent).toContain('# Reply to Pedro');
    expect(destContent).toContain('#task');

    // Verify fleeting note updated
    const fleetingContent = fs.readFileSync(
      path.join(vaultPath, relPath),
      'utf-8',
    );
    expect(fleetingContent).toContain('status: completed');
    expect(fleetingContent).toContain('converted_to:');
  });

  it('creates permanent note for non-task proposal', async () => {
    const relPath = 'Fleeting/2026/03/07/ai-insight.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# AI Insight\n\nModels generalize well.\n',
    );

    const note = makeNote({
      path: relPath,
      slug: 'ai-insight',
      title: 'AI Insight',
      body: 'Models generalize well.',
      project: 'NanoClaw',
    });

    const result = await executeRoute(
      vaultPath,
      {
        itemIndex: 1,
        fleetingPath: relPath,
        action: 'accept',
        proposal: {
          projectLine: 'Project NanoClaw.',
          text: 'Project NanoClaw. Permanent note — insight for NanoClaw.',
        },
      },
      note,
      registry,
    );

    expect(result.destinationPath).toBeDefined();
    const destContent = fs.readFileSync(
      path.join(vaultPath, result.destinationPath!),
      'utf-8',
    );
    expect(destContent).toContain('# AI Insight');
    expect(destContent).toContain('Models generalize well.');
    expect(destContent).toContain('type: permanent-note');
  });

  it('falls back to proposal when LLM unavailable for response', async () => {
    const relPath = 'Fleeting/2026/03/07/thought.md';
    createFleetingNote(
      vaultPath,
      relPath,
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# A Thought\n',
    );

    const note = makeNote({
      path: relPath,
      slug: 'thought',
      title: 'A Thought',
    });

    // In test env, claude -p will fail, so LLM fallback returns {action:'route', type:'permanent'}
    const result = await executeRoute(
      vaultPath,
      {
        itemIndex: 1,
        fleetingPath: relPath,
        action: 'response',
        responseText: 'route this to spark please',
        proposal: {
          projectLine: 'No project match.',
          text: 'Permanent note.',
        },
      },
      note,
      registry,
    );

    // LLM fails in test → fallback routes as permanent
    expect(result.destinationPath).toBeDefined();
  });
});

describe('processDecisions', () => {
  it('processes multiple decisions end-to-end', async () => {
    // Create fleeting notes
    createFleetingNote(
      vaultPath,
      'Fleeting/2026/03/07/task-one.md',
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Task One\n',
    );
    createFleetingNote(
      vaultPath,
      'Fleeting/2026/03/07/stale-item.md',
      '---\nstatus: raw\ncreated: 2026-03-07\n---\n\n# Stale Item\n',
    );

    const notes: FleetingNote[] = [
      makeNote({
        path: 'Fleeting/2026/03/07/task-one.md',
        slug: 'task-one',
        title: 'Task One',
        project: 'Chores',
      }),
      makeNote({
        path: 'Fleeting/2026/03/07/stale-item.md',
        slug: 'stale-item',
        title: 'Stale Item',
      }),
    ];

    const dailyNoteContent = `
<!-- fleeting-start -->

1. **Task One** (2026-03-07) [[Fleeting/2026/03/07/task-one|f-note]]
    **Proposed:** Project Chores. #task — action item for Chores.
    **Response:**
    - [x] Process

2. **Stale Item** (2026-03-07) [[Fleeting/2026/03/07/stale-item|f-note]]
    **Proposed:** Retire — stale item.
    - [x] Retire
    **Response:**
    <!-- r -->
    <!-- /r -->
    - [x] Process

### Routed

<!-- fleeting-end -->`;

    const result = await processDecisions(vaultPath, dailyNoteContent, notes);
    expect(result.routed).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.routed[0].action).toBe('accept');
    expect(result.routed[0].destinationPath).toBeDefined();
    expect(result.routed[1].action).toBe('retire');
  });

  it('reports error for missing fleeting note', async () => {
    const dailyNoteContent = `
<!-- fleeting-start -->

1. **Missing** (2026-03-07) [[Fleeting/2026/03/07/missing|f-note]]
    **Proposed:** #task item.
    **Response:**
    - [x] Process

<!-- fleeting-end -->`;

    const result = await processDecisions(vaultPath, dailyNoteContent, []);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not found');
  });
});
