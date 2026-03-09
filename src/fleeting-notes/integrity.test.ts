import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkBrokenBold,
  checkBrokenLinks,
  checkDatePrefixes,
  checkQueryFilters,
  checkRawRemaining,
  runIntegrityChecks,
} from './integrity.js';

let tmpDir: string;
let vaultPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-test-'));
  vaultPath = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const absPath = path.join(vaultPath, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

describe('checkDatePrefixes', () => {
  it('passes for correctly prefixed files', () => {
    writeFile('notes/2026/03/2026-03-07-my-note.md', '# Note');
    const issues = checkDatePrefixes(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });

  it('flags files without date prefix', () => {
    writeFile('notes/2026/03/my-note.md', '# Note');
    const issues = checkDatePrefixes(vaultPath, ['notes']);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('missing-date-prefix');
    expect(issues[0].detail).toContain('my-note.md');
  });

  it('skips todos.md and registry.md', () => {
    writeFile('notes/todos.md', '# Todos');
    writeFile('notes/registry.md', '# Registry');
    const issues = checkDatePrefixes(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });

  it('skips underscore-prefixed files', () => {
    writeFile('notes/_template.md', '# Template');
    const issues = checkDatePrefixes(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });

  it('checks multiple directories', () => {
    writeFile('notes/2026/03/bad-note.md', '# Note');
    writeFile('literature/2026/03/bad-lit.md', '# Lit');
    const issues = checkDatePrefixes(vaultPath, ['notes', 'literature']);
    expect(issues).toHaveLength(2);
  });

  it('returns empty for nonexistent directory', () => {
    const issues = checkDatePrefixes(vaultPath, ['nonexistent']);
    expect(issues).toHaveLength(0);
  });
});

describe('checkQueryFilters', () => {
  it('passes for correct filter', () => {
    writeFile(
      'project/todos.md',
      "```tasks\nfilter by function task.description.includes('#task')\n```",
    );
    const issues = checkQueryFilters(vaultPath);
    expect(issues).toHaveLength(0);
  });

  it('flags task.tags.includes usage', () => {
    writeFile(
      'project/todos.md',
      "```tasks\nfilter by function task.tags.includes('#task')\n```",
    );
    const issues = checkQueryFilters(vaultPath);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('wrong-query-filter');
  });

  it('flags task.tags.find usage', () => {
    writeFile(
      'project/todos.md',
      "```tasks\nfilter by function task.tags.find(t => t === '#task')\n```",
    );
    const issues = checkQueryFilters(vaultPath);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('flags tasks block without description filter', () => {
    writeFile('project/todos.md', '```tasks\nnot done\n```');
    const issues = checkQueryFilters(vaultPath);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('missing');
  });

  it('only checks todos.md files', () => {
    writeFile('project/notes.md', '```tasks\nnot done\n```');
    const issues = checkQueryFilters(vaultPath);
    expect(issues).toHaveLength(0);
  });
});

describe('checkRawRemaining', () => {
  it('flags raw fleeting notes', () => {
    writeFile('Fleeting/2026/03/07/test.md', '---\nstatus: raw\n---\n# Test\n');
    const issues = checkRawRemaining(vaultPath);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('raw-remaining');
  });

  it('passes for completed notes', () => {
    writeFile(
      'Fleeting/2026/03/07/test.md',
      '---\nstatus: completed\n---\n# Test\n',
    );
    const issues = checkRawRemaining(vaultPath);
    expect(issues).toHaveLength(0);
  });

  it('passes for retired notes', () => {
    writeFile(
      'Fleeting/2026/03/07/test.md',
      '---\nstatus: retired\n---\n# Test\n',
    );
    const issues = checkRawRemaining(vaultPath);
    expect(issues).toHaveLength(0);
  });

  it('skips underscore-prefixed files', () => {
    writeFile(
      'Fleeting/2026/03/07/_session.md',
      '---\nstatus: raw\n---\n# Session\n',
    );
    const issues = checkRawRemaining(vaultPath);
    expect(issues).toHaveLength(0);
  });

  it('returns empty when no Fleeting directory', () => {
    const issues = checkRawRemaining(vaultPath);
    expect(issues).toHaveLength(0);
  });
});

describe('checkBrokenBold', () => {
  it('passes for matched bold markers', () => {
    writeFile('notes/2026/03/2026-03-07-note.md', '**bold** text **here**\n');
    const issues = checkBrokenBold(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });

  it('flags unmatched bold markers', () => {
    writeFile('notes/2026/03/2026-03-07-note.md', '**broken bold text\n');
    const issues = checkBrokenBold(vaultPath, ['notes']);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('broken-bold');
    expect(issues[0].detail).toContain('Line 1');
  });

  it('checks multiple lines independently', () => {
    writeFile(
      'notes/2026/03/2026-03-07-note.md',
      '**good** line\n**broken line\n**also good**\n',
    );
    const issues = checkBrokenBold(vaultPath, ['notes']);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('Line 2');
  });
});

describe('checkBrokenLinks', () => {
  it('passes for valid links', () => {
    writeFile(
      'notes/2026/03/2026-03-07-source.md',
      '[[notes/2026/03/2026-03-07-target|link]]',
    );
    writeFile('notes/2026/03/2026-03-07-target.md', '# Target');
    const issues = checkBrokenLinks(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });

  it('flags broken links', () => {
    writeFile(
      'notes/2026/03/2026-03-07-source.md',
      '[[nonexistent-note|link]]',
    );
    const issues = checkBrokenLinks(vaultPath, ['notes']);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('broken-link');
    expect(issues[0].detail).toContain('nonexistent-note');
  });

  it('handles links without aliases', () => {
    writeFile('notes/2026/03/2026-03-07-source.md', '[[nonexistent]]');
    const issues = checkBrokenLinks(vaultPath, ['notes']);
    expect(issues).toHaveLength(1);
  });

  it('allows PDF links', () => {
    writeFile('notes/2026/03/2026-03-07-source.md', '[[docs/paper|pdf]]');
    writeFile('docs/paper.pdf', 'fake pdf');
    const issues = checkBrokenLinks(vaultPath, ['notes']);
    expect(issues).toHaveLength(0);
  });
});

describe('runIntegrityChecks', () => {
  it('returns passing report when all checks pass', () => {
    writeFile(
      'Fleeting/2026/03/07/test.md',
      '---\nstatus: completed\n---\n# Test\n',
    );
    const report = runIntegrityChecks(vaultPath, { checkRaw: true });
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('aggregates issues from multiple checks', () => {
    writeFile('Fleeting/2026/03/07/test.md', '---\nstatus: raw\n---\n# Test\n');
    writeFile('notes/bad-name.md', '# Bad');
    const report = runIntegrityChecks(vaultPath, {
      noteDirs: ['notes'],
      checkRaw: true,
    });
    expect(report.passed).toBe(false);
    expect(report.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('skips raw check when disabled', () => {
    writeFile('Fleeting/2026/03/07/test.md', '---\nstatus: raw\n---\n# Test\n');
    const report = runIntegrityChecks(vaultPath, { checkRaw: false });
    expect(
      report.issues.filter((i) => i.type === 'raw-remaining'),
    ).toHaveLength(0);
  });
});
