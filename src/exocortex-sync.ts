/**
 * Exocortex git sync — commits and pushes changes on a daily interval.
 * Replaces the standalone launchd job with an in-process timer.
 */
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

function resolvePath(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function hasChanges(cwd: string): boolean {
  try {
    // Check for staged, unstaged, and untracked changes
    execFileSync('git', ['diff', '--quiet'], { cwd });
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd });
    const untracked = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd, encoding: 'utf-8' },
    ).trim();
    return untracked.length > 0;
  } catch {
    // git diff --quiet exits with 1 when there are changes
    return true;
  }
}

function syncExocortex(exocortexPath: string): void {
  const cwd = resolvePath(exocortexPath);

  if (!hasChanges(cwd)) {
    logger.debug('Exocortex sync: no changes');
    return;
  }

  try {
    execFileSync('git', ['add', '-A'], { cwd });
    const msg = `sync: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    execFileSync('git', ['commit', '-m', msg], { cwd });
    execFileSync('git', ['push', 'origin', 'main'], { cwd, timeout: 30000 });
    logger.info('Exocortex sync: committed and pushed');
  } catch (err) {
    logger.error({ err }, 'Exocortex sync failed');
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startExocortexSync(
  exocortexPath: string,
  intervalMs: number = ONE_DAY_MS,
): void {
  logger.info({ intervalMs, exocortexPath }, 'Starting exocortex sync loop');

  const run = () => syncExocortex(exocortexPath);
  run();
  setInterval(run, intervalMs);
}
