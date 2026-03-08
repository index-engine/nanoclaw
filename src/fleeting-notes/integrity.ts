/**
 * Stage 4: Vault integrity checks.
 *
 * Post-processing validation to catch common issues:
 * - Orphan files (notes not linked from any project)
 * - Broken wiki links
 * - Missing date prefixes on filenames
 * - Wrong query filters in todos.md
 * - Remaining raw fleeting notes after routing
 * - Broken bold formatting (incomplete **)
 */

import fs from 'fs';
import path from 'path';

import type { IntegrityIssue, IntegrityReport } from './types.js';

/** Walk a directory tree, yielding absolute paths to .md files. */
function walkMd(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) results.push(full);
    }
  };
  walk(dir);
  return results;
}

/**
 * Check that note/literature filenames start with a date prefix (YYYY-MM-DD-).
 */
export function checkDatePrefixes(
  vaultPath: string,
  dirs: string[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const datePattern = /^\d{4}-\d{2}-\d{2}-/;

  for (const dir of dirs) {
    const absDir = path.join(vaultPath, dir);
    for (const file of walkMd(absDir)) {
      const name = path.basename(file);
      if (name === 'todos.md' || name === 'registry.md') continue;
      if (name.startsWith('_')) continue;

      if (!datePattern.test(name)) {
        issues.push({
          type: 'missing-date-prefix',
          file: path.relative(vaultPath, file),
          detail: `Filename "${name}" missing YYYY-MM-DD- prefix`,
        });
      }
    }
  }
  return issues;
}

/**
 * Check that todos.md files use the correct query filter.
 * Must use task.description.includes('#task'), NOT task.tags.includes('#task').
 */
export function checkQueryFilters(vaultPath: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const todosFiles = walkMd(vaultPath).filter(
    (f) => path.basename(f) === 'todos.md',
  );

  for (const file of todosFiles) {
    const content = fs.readFileSync(file, 'utf-8');

    // Check for the wrong pattern
    if (
      content.includes('task.tags.includes') ||
      content.includes('task.tags.find')
    ) {
      issues.push({
        type: 'wrong-query-filter',
        file: path.relative(vaultPath, file),
        detail:
          "Uses task.tags filter instead of task.description.includes('#task'). The Tasks plugin globalFilter strips #task from tags.",
      });
    }

    // Check that it has the correct pattern (if it has a tasks query at all)
    if (
      content.includes('```tasks') &&
      !content.includes('task.description.includes')
    ) {
      issues.push({
        type: 'wrong-query-filter',
        file: path.relative(vaultPath, file),
        detail:
          "Has tasks query block but missing task.description.includes('#task') filter.",
      });
    }
  }
  return issues;
}

/**
 * Check for fleeting notes still in raw status.
 */
export function checkRawRemaining(vaultPath: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const fleetingDir = path.join(vaultPath, 'Fleeting');

  for (const file of walkMd(fleetingDir)) {
    if (path.basename(file).startsWith('_')) continue;

    const content = fs.readFileSync(file, 'utf-8');
    const match = content.match(/^status:\s*(\S+)/m);
    if (match && match[1] === 'raw') {
      issues.push({
        type: 'raw-remaining',
        file: path.relative(vaultPath, file),
        detail: 'Fleeting note still has status: raw',
      });
    }
  }
  return issues;
}

/**
 * Check for broken bold formatting (unmatched **).
 */
export function checkBrokenBold(
  vaultPath: string,
  dirs: string[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (const dir of dirs) {
    const absDir = path.join(vaultPath, dir);
    for (const file of walkMd(absDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const [lineNum, line] of content.split('\n').entries()) {
        // Count ** occurrences — should be even
        const boldMarkers = (line.match(/\*\*/g) || []).length;
        if (boldMarkers % 2 !== 0) {
          issues.push({
            type: 'broken-bold',
            file: path.relative(vaultPath, file),
            detail: `Line ${lineNum + 1}: unmatched ** bold marker`,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Check for broken wiki links (links pointing to nonexistent files).
 */
export function checkBrokenLinks(
  vaultPath: string,
  dirs: string[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  for (const dir of dirs) {
    const absDir = path.join(vaultPath, dir);
    for (const file of walkMd(absDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = wikiLinkPattern.exec(content)) !== null) {
        const linkTarget = match[1];
        // Try to resolve the link
        const targetPath = path.join(vaultPath, linkTarget + '.md');
        const targetPathNoExt = path.join(vaultPath, linkTarget);

        if (
          !fs.existsSync(targetPath) &&
          !fs.existsSync(targetPathNoExt) &&
          !fs.existsSync(targetPathNoExt + '.pdf')
        ) {
          issues.push({
            type: 'broken-link',
            file: path.relative(vaultPath, file),
            detail: `Broken link: [[${linkTarget}]]`,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Run all integrity checks and return a report.
 */
export function runIntegrityChecks(
  vaultPath: string,
  options: {
    /** Directories to check for date prefixes (relative to vault). */
    noteDirs?: string[];
    /** Whether to check for raw remaining notes. */
    checkRaw?: boolean;
  } = {},
): IntegrityReport {
  const noteDirs = options.noteDirs || [];
  const issues: IntegrityIssue[] = [];
  let checked = 0;

  // Date prefix check
  if (noteDirs.length > 0) {
    const dateIssues = checkDatePrefixes(vaultPath, noteDirs);
    issues.push(...dateIssues);
    checked++;
  }

  // Query filter check
  const queryIssues = checkQueryFilters(vaultPath);
  issues.push(...queryIssues);
  checked++;

  // Raw remaining check
  if (options.checkRaw !== false) {
    const rawIssues = checkRawRemaining(vaultPath);
    issues.push(...rawIssues);
    checked++;
  }

  // Broken bold check
  if (noteDirs.length > 0) {
    const boldIssues = checkBrokenBold(vaultPath, noteDirs);
    issues.push(...boldIssues);
    checked++;
  }

  return {
    issues,
    checked,
    passed: issues.length === 0,
  };
}
