/**
 * Fleeting Notes — Reactive Orchestrator
 *
 * Two independent watchers:
 *
 * 1. **Ingest watcher**: watches Things 3 SQLite DB for changes,
 *    ingests new Today items into fleeting notes, updates daily note.
 *    Debounced to avoid rapid-fire on multi-write SQLite transactions.
 *
 * 2. **Route watcher**: watches today's daily note for saves,
 *    parses user decisions (Accept/Retire/Response), routes notes
 *    to their destination projects.
 *
 * Both can also be triggered manually. `runPipeline()` remains
 * available for tests and one-shot invocations.
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import {
  appendNewEntries,
  buildDailyNoteSection,
  collectUnprocessedNotes,
  createDailyNoteIfMissing,
  findDailyNoteFile,
  updateDailyNote,
} from './daily-note.js';
import { ingestThingsToday } from './ingest.js';
import { runIntegrityChecks } from './integrity.js';
import { loadRegistry } from './registry.js';
import { appendToRoutedSection, processDecisions } from './route.js';
import type { IngestResult, IntegrityReport } from './types.js';

export interface PipelineResult {
  ingest: IngestResult;
  unprocessedCount: number;
  dailyNoteUpdated: boolean;
  integrity: IntegrityReport;
}

/**
 * Run the full fleeting notes pipeline once (for tests and one-shot use).
 */
export async function runPipeline(
  vaultPath: string,
  thingsDbPath: string,
  thingsAuthToken: string,
  options: {
    skipIngest?: boolean;
    runIntegrity?: boolean;
    integrityDirs?: string[];
  } = {},
): Promise<PipelineResult> {
  let ingestResult: IngestResult = { created: [], skipped: [], errors: [] };
  if (!options.skipIngest) {
    ingestResult = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      thingsAuthToken,
    );
    if (ingestResult.created.length > 0) {
      logger.info(
        {
          created: ingestResult.created.length,
          skipped: ingestResult.skipped.length,
        },
        'Fleeting notes ingested from Things Today',
      );
    }
  }

  const registry = loadRegistry(vaultPath);
  const unprocessed = collectUnprocessedNotes(vaultPath);
  const section = buildDailyNoteSection(unprocessed, registry);
  const dailyNoteUpdated = updateDailyNote(vaultPath, section);

  if (dailyNoteUpdated) {
    logger.info(
      { unprocessed: unprocessed.length },
      'Daily note updated with fleeting notes section',
    );
  }

  let integrityReport: IntegrityReport = {
    issues: [],
    checked: 0,
    passed: true,
  };
  if (options.runIntegrity) {
    integrityReport = runIntegrityChecks(vaultPath, {
      noteDirs: options.integrityDirs,
      checkRaw: false,
    });
    if (!integrityReport.passed) {
      logger.warn(
        { issueCount: integrityReport.issues.length },
        'Integrity issues found',
      );
    }
  }

  return {
    ingest: ingestResult,
    unprocessedCount: unprocessed.length,
    dailyNoteUpdated,
    integrity: integrityReport,
  };
}

// ─── Ingest watcher ──────────────────────────────────────────────

let ingestWatcher: fs.FSWatcher | null = null;
let ingestPollTimer: ReturnType<typeof setInterval> | null = null;
let ingestDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const INGEST_DEBOUNCE_MS = 2000;
const INGEST_POLL_MS = 30_000; // poll every 30s as fallback

async function runIngest(
  vaultPath: string,
  thingsDbPath: string,
  thingsAuthToken: string,
): Promise<void> {
  try {
    const result = await ingestThingsToday(
      vaultPath,
      thingsDbPath,
      thingsAuthToken,
    );
    if (result.created.length > 0) {
      logger.info(
        { created: result.created.length, skipped: result.skipped.length },
        'Ingest watcher: new fleeting notes from Things',
      );
      // Append only the new items — never overwrite existing content
      const registry = loadRegistry(vaultPath);
      const unprocessed = collectUnprocessedNotes(vaultPath);
      const appended = appendNewEntries(vaultPath, unprocessed, registry);
      if (appended > 0) {
        logger.info(
          { appended, total: unprocessed.length },
          'Ingest watcher: new entries appended to daily note',
        );
      }
    }
  } catch (err) {
    logger.error({ err }, 'Ingest watcher: pipeline error');
  }
}

/**
 * Start watching the Things 3 SQLite DB for changes.
 * On change, ingests new Today items and updates the daily note.
 */
export function startIngestWatcher(
  vaultPath: string,
  thingsDbPath: string,
  thingsAuthToken: string,
): fs.FSWatcher | null {
  if (ingestWatcher) {
    logger.debug('Ingest watcher already running');
    return ingestWatcher;
  }

  if (!fs.existsSync(thingsDbPath)) {
    logger.warn({ thingsDbPath }, 'Things DB not found, ingest watcher not started');
    return null;
  }

  // Watch directory for changes + poll as fallback (macOS sandbox blocks
  // fs.watch on Group Containers directories used by Things 3)
  const watchDir = path.dirname(thingsDbPath);
  const dbBasename = path.basename(thingsDbPath);
  logger.info({ thingsDbPath, watchDir }, 'Starting ingest watcher on Things DB');

  // Run once on startup to catch anything missed
  runIngest(vaultPath, thingsDbPath, thingsAuthToken);

  ingestWatcher = fs.watch(watchDir, (_eventType, filename) => {
    // Only react to DB file changes (main file, WAL, SHM)
    if (!filename || !filename.startsWith(dbBasename)) return;
    // Debounce: SQLite writes trigger multiple change events per transaction
    if (ingestDebounceTimer) clearTimeout(ingestDebounceTimer);
    ingestDebounceTimer = setTimeout(() => {
      runIngest(vaultPath, thingsDbPath, thingsAuthToken);
    }, INGEST_DEBOUNCE_MS);
  });

  ingestWatcher.on('error', (err) => {
    logger.error({ err }, 'Ingest watcher: fs.watch error');
  });

  // Poll as fallback — fs.watch may not fire on sandboxed directories
  ingestPollTimer = setInterval(() => {
    runIngest(vaultPath, thingsDbPath, thingsAuthToken);
  }, INGEST_POLL_MS);

  return ingestWatcher;
}

// ─── Route watcher ───────────────────────────────────────────────

let routeWatcher: fs.FSWatcher | null = null;
let routeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const ROUTE_DEBOUNCE_MS = 1000;
let lastDailyNotePath: string | null = null;

async function runRoute(vaultPath: string): Promise<void> {
  try {
    const dailyNotePath = findDailyNoteFile(vaultPath);
    if (!dailyNotePath) return;

    let content = fs.readFileSync(dailyNotePath, 'utf-8');
    // Only process if there are checked decisions
    if (!content.includes('- [x]')) return;

    const notes = collectUnprocessedNotes(vaultPath);
    if (notes.length === 0) return;

    const result = await processDecisions(vaultPath, content, notes);
    if (result.routed.length > 0) {
      logger.info(
        { routed: result.routed.length, errors: result.errors.length },
        'Route watcher: decisions processed',
      );

      // Re-read content (processDecisions may have modified fleeting files)
      content = fs.readFileSync(dailyNotePath, 'utf-8');

      // Remove routed items from unprocessed and add to Routed section
      for (const routed of result.routed) {
        // Conversation items stay in unprocessed — just uncheck Process
        if (routed.routingType === 'conversation') {
          const pathRef = routed.fleetingPath.replace('.md', '');
          // Uncheck Process for this item so it stays visible
          const pathIdx = content.indexOf(pathRef);
          if (pathIdx !== -1) {
            // Find and uncheck the item's Process checkbox
            const processIdx = content.indexOf('- [x] Process', pathIdx);
            if (processIdx !== -1) {
              const after = content.slice(processIdx + '- [x] Process'.length, processIdx + '- [x] Process'.length + 5);
              if (!after.trimStart().startsWith('All')) {
                content = content.slice(0, processIdx) + '- [ ] Process' + content.slice(processIdx + '- [x] Process'.length);
              }
            }
            // Add/update **Chat:** line with summary from fleeting note
            const fleetingAbsPath = path.join(vaultPath, routed.fleetingPath);
            if (fs.existsSync(fleetingAbsPath)) {
              const fleetingContent = fs.readFileSync(fleetingAbsPath, 'utf-8');
              const lastAgent = fleetingContent.match(/\*\*Agent \([^)]+\):\*\* (.+)/g);
              if (lastAgent) {
                const lastReply = lastAgent[lastAgent.length - 1].match(/\*\*Agent \([^)]+\):\*\* (.+)/)?.[1] || '';
                const chatSummary = lastReply.slice(0, 80);
                // Insert Chat line after Proposed line for this item
                const proposedIdx = content.lastIndexOf('**Proposed:**', pathIdx + pathRef.length + 50);
                // Find a better anchor: look for the item's block
                const itemBlockStart = content.lastIndexOf('\n', pathIdx);
                const processEnd = content.indexOf('- [ ] Process', pathIdx);
                if (processEnd !== -1) {
                  const blockSlice = content.slice(itemBlockStart, processEnd);
                  if (blockSlice.includes('**Chat:**')) {
                    // Update existing Chat line
                    const chatLineStart = content.indexOf('**Chat:**', itemBlockStart);
                    const chatLineEnd = content.indexOf('\n', chatLineStart);
                    content = content.slice(0, chatLineStart) + `**Chat:** ${chatSummary}` + content.slice(chatLineEnd);
                  } else {
                    // Insert Chat line before Response
                    const responseIdx = content.indexOf('**Response:**', itemBlockStart);
                    if (responseIdx !== -1 && responseIdx < processEnd) {
                      content = content.slice(0, responseIdx) + `**Chat:** ${chatSummary}\n    ` + content.slice(responseIdx);
                    }
                  }
                }
              }
            }
          }
          continue;
        }

        // Find the item block by path reference
        const pathRef = routed.fleetingPath.replace('.md', '');
        const pathIdx = content.indexOf(pathRef);
        if (pathIdx === -1) continue;

        // Walk backwards to find the start of the numbered line
        let itemStart = content.lastIndexOf('\n', pathIdx);
        itemStart = itemStart === -1 ? 0 : itemStart + 1;
        while (itemStart > 0 && !/^\d+\.\s+/.test(content.slice(itemStart))) {
          itemStart = content.lastIndexOf('\n', itemStart - 2) + 1;
        }

        // Find item end: "- [ ] Process" or "- [x] Process" is always the last line of an item
        let itemEnd = -1;
        const processMarkers = ['- [x] Process', '- [ ] Process'];
        let searchFrom = pathIdx;
        for (const marker of processMarkers) {
          let pos = searchFrom;
          while (pos < content.length) {
            const idx = content.indexOf(marker, pos);
            if (idx === -1) break;
            // Skip "Process All"
            const after = content.slice(idx + marker.length, idx + marker.length + 5);
            if (after.trimStart().startsWith('All')) {
              pos = idx + marker.length;
              continue;
            }
            // Found the item's Process line — end of line + skip trailing blank
            itemEnd = content.indexOf('\n', idx) + 1;
            if (content[itemEnd] === '\n') itemEnd++;
            break;
          }
          if (itemEnd !== -1) break;
        }

        if (itemEnd > itemStart) {
          content = content.slice(0, itemStart) + content.slice(itemEnd);
        }

        // Append to Routed section (spec format)
        content = appendToRoutedSection(
          content,
          routed.fleetingPath,
          routed.action,
          routed.destinationPath,
          routed.title,
          routed.projectName,
          routed.routingType,
        );
      }

      // Uncheck Process All after routing
      content = content.replace('- [x] Process All', '- [ ] Process All');

      fs.writeFileSync(dailyNotePath, content);
    }
  } catch (err) {
    logger.error({ err }, 'Route watcher: error processing decisions');
  }
}

/**
 * Start watching today's daily note for changes.
 * On save, parses user decisions and routes accepted/retired notes.
 */
export function startRouteWatcher(vaultPath: string): fs.FSWatcher | null {
  if (routeWatcher) {
    logger.debug('Route watcher already running');
    return routeWatcher;
  }

  let dailyNotePath = findDailyNoteFile(vaultPath);
  if (!dailyNotePath) {
    dailyNotePath = createDailyNoteIfMissing(vaultPath);
  }
  lastDailyNotePath = dailyNotePath;

  logger.info({ dailyNotePath }, 'Starting route watcher on daily note');

  // On startup, uncheck Process All to prevent stale auto-routing of newly ingested notes
  const startupContent = fs.readFileSync(dailyNotePath, 'utf-8');
  if (startupContent.includes('- [x] Process All')) {
    fs.writeFileSync(
      dailyNotePath,
      startupContent.replace('- [x] Process All', '- [ ] Process All'),
    );
    logger.info('Route watcher: unchecked stale Process All on startup');
  }

  // Watch the directory (more reliable than watching a single file on macOS)
  const watchDir = dailyNotePath.substring(
    0,
    dailyNotePath.lastIndexOf('/'),
  );
  const watchFilename = dailyNotePath.substring(
    dailyNotePath.lastIndexOf('/') + 1,
  );

  routeWatcher = fs.watch(watchDir, (_eventType, filename) => {
    if (filename !== watchFilename) return;
    if (routeDebounceTimer) clearTimeout(routeDebounceTimer);
    routeDebounceTimer = setTimeout(() => {
      runRoute(vaultPath);
    }, ROUTE_DEBOUNCE_MS);
  });

  routeWatcher.on('error', (err) => {
    logger.error({ err }, 'Route watcher: fs.watch error');
  });

  return routeWatcher;
}

// ─── Combined startup (used by src/index.ts) ────────────────────

/**
 * Start both reactive watchers.
 * Replaces the old interval-based `startFleetingNotesPipeline`.
 */
export function startFleetingNotesPipeline(
  vaultPath: string,
  thingsDbPath: string,
  thingsAuthToken: string,
  _intervalMs?: number, // kept for backward compat with src/index.ts call site
): void {
  startIngestWatcher(vaultPath, thingsDbPath, thingsAuthToken);
  startRouteWatcher(vaultPath);
}

/** Stop all watchers. */
export function stopWatchers(): void {
  if (ingestWatcher) {
    ingestWatcher.close();
    ingestWatcher = null;
  }
  if (ingestPollTimer) {
    clearInterval(ingestPollTimer);
    ingestPollTimer = null;
  }
  if (ingestDebounceTimer) {
    clearTimeout(ingestDebounceTimer);
    ingestDebounceTimer = null;
  }
  if (routeWatcher) {
    routeWatcher.close();
    routeWatcher = null;
  }
  if (routeDebounceTimer) {
    clearTimeout(routeDebounceTimer);
    routeDebounceTimer = null;
  }
  lastDailyNotePath = null;
}

/** @internal - for tests only. */
export function _resetPipelineForTests(): void {
  stopWatchers();
}
