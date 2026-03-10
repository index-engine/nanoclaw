/** Standalone runner for reactive fleeting notes watchers. */
import os from 'os';
import path from 'path';

import { startIngestWatcher, startRouteWatcher } from './index.js';

const vaultPath = path.join(os.homedir(), 'Documents/vvault');
const thingsDbPath = path.join(
  os.homedir(),
  'Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-YN4YZ/Things Database.thingsdatabase/main.sqlite',
);
const thingsAuthToken =
  process.env.THINGS_AUTH_TOKEN || 'qNoxawEAAACEW2CfAQAAAA';

console.log('Starting ingest watcher...');
const iw = startIngestWatcher(vaultPath, thingsDbPath, thingsAuthToken);
console.log('Ingest watcher:', iw ? 'RUNNING' : 'FAILED');

console.log('Starting route watcher...');
const rw = startRouteWatcher(vaultPath);
console.log('Route watcher:', rw ? 'RUNNING' : 'FAILED');

console.log('\n=== READY — add an item to Things Today ===');
console.log('Press Ctrl+C to stop.\n');
