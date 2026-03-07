/**
 * Parses the Obsidian vault project registry (1. Projects/registry.md)
 * and provides lookup functions for routing fleeting notes to projects.
 */

import fs from 'fs';
import path from 'path';
import type { ProjectRegistryEntry } from './types.js';

let cachedRegistry: ProjectRegistryEntry[] | null = null;
let cachedMtime = 0;

/** Parse registry.md into structured entries. */
export function parseRegistry(content: string): ProjectRegistryEntry[] {
  const entries: ProjectRegistryEntry[] = [];
  const sections = content.split(/^## /m).slice(1); // split on ## headings

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const name = lines[0].trim();
    if (!name) continue;

    const entry: ProjectRegistryEntry = {
      name,
      aliases: [],
      vault: '',
      status: 'active',
      routing: [],
    };

    for (const line of lines.slice(1)) {
      const m = line.match(/^- \*\*(\w+):\*\*\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      const cleaned = value.replace(/`/g, '').trim();

      switch (key) {
        case 'aliases':
          entry.aliases = cleaned.split(',').map((a) => a.trim().toLowerCase());
          break;
        case 'vault':
          entry.vault = cleaned;
          break;
        case 'evergreen':
          if (!cleaned.startsWith('*')) entry.evergreen = cleaned;
          break;
        case 'github':
          if (!cleaned.startsWith('*')) entry.github = cleaned;
          break;
        case 'status':
          entry.status = cleaned;
          break;
        case 'routing':
          entry.routing = cleaned.split(',').map((r) => r.trim().toLowerCase());
          break;
      }
    }

    entries.push(entry);
  }

  return entries;
}

/** Load registry from disk, with mtime-based caching. */
export function loadRegistry(vaultPath: string): ProjectRegistryEntry[] {
  const registryPath = path.join(vaultPath, '1. Projects', 'registry.md');

  if (!fs.existsSync(registryPath)) {
    return [];
  }

  const stat = fs.statSync(registryPath);
  if (cachedRegistry && stat.mtimeMs === cachedMtime) {
    return cachedRegistry;
  }

  const content = fs.readFileSync(registryPath, 'utf-8');
  cachedRegistry = parseRegistry(content);
  cachedMtime = stat.mtimeMs;
  return cachedRegistry;
}

/** Clear the registry cache (useful for testing). */
export function clearRegistryCache(): void {
  cachedRegistry = null;
  cachedMtime = 0;
}

/** Find a project by @tag or keyword from routing rules. */
export function findProjectByTag(
  registry: ProjectRegistryEntry[],
  tag: string,
): ProjectRegistryEntry | null {
  const normalized = tag.toLowerCase().replace(/^@/, '');
  for (const entry of registry) {
    if (entry.status !== 'active') continue;
    for (const rule of entry.routing) {
      const ruleNorm = rule.replace(/^@/, '');
      if (ruleNorm === normalized) return entry;
    }
  }
  return null;
}

/** Find a project by name or alias. */
export function findProjectByName(
  registry: ProjectRegistryEntry[],
  name: string,
): ProjectRegistryEntry | null {
  const normalized = name.toLowerCase();
  for (const entry of registry) {
    if (entry.name.toLowerCase() === normalized) return entry;
    if (entry.aliases.includes(normalized)) return entry;
  }
  return null;
}

/**
 * Detect project from fleeting note content.
 * Checks title and body for @tags and known keywords from routing rules.
 */
export function detectProject(
  registry: ProjectRegistryEntry[],
  title: string,
  body: string,
): ProjectRegistryEntry | null {
  const text = `${title} ${body}`.toLowerCase();

  // Check for explicit @tags first
  const tagMatches = text.match(/@(\w+)/g);
  if (tagMatches) {
    for (const tag of tagMatches) {
      const found = findProjectByTag(registry, tag);
      if (found) return found;
    }
  }

  // Check for routing keywords (non-@tag entries like "insurance", "pills")
  for (const entry of registry) {
    if (entry.status !== 'active') continue;
    for (const rule of entry.routing) {
      if (!rule.startsWith('@') && text.includes(rule.toLowerCase())) {
        return entry;
      }
    }
  }

  return null;
}
