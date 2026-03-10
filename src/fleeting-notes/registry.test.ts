import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseRegistry,
  findProjectByTag,
  findProjectByName,
  detectProject,
  clearRegistryCache,
} from './registry.js';
import type { ProjectRegistryEntry } from './types.js';

const SAMPLE_REGISTRY = `# Project Registry

Machine-readable fields use \`**key:**\` format. Each project is an \`##\` section.

---

## Networking
- **aliases:** networking, people
- **vault:** \`1. Projects/Networking/\`
- **evergreen:** *(none yet)*
- **github:** *(none yet)*
- **status:** active
- **routing:** @networking, @people, names of known contacts (Pedro, Adam, etc.)

---

## NanoClaw
- **aliases:** nanoclaw, ai assistant, claw
- **vault:** \`1. Projects/AI Assistant/\`
- **evergreen:** \`1. Projects/AI Assistant/AI Assistant Evergreen.md\`
- **github:** \`index-engine/nanoclaw\`, \`index-engine/ai_assistant\`
- **status:** active
- **routing:** @nanoclaw, @claw, @ai_assistant

---

## Chores
- **aliases:** chores, personal, admin
- **vault:** \`1. Projects/Chores/\`
- **evergreen:** *(none)*
- **github:** *(none)*
- **status:** active
- **routing:** @chores, @personal, personal chores, insurance, pills, errands

---

## Archived Project
- **aliases:** old
- **vault:** \`1. Projects/Archived/\`
- **status:** archived
- **routing:** @old
`;

describe('registry', () => {
  let registry: ProjectRegistryEntry[];

  beforeEach(() => {
    clearRegistryCache();
    registry = parseRegistry(SAMPLE_REGISTRY);
  });

  describe('parseRegistry', () => {
    it('parses all active projects', () => {
      expect(registry).toHaveLength(4);
      expect(registry.map((e) => e.name)).toEqual([
        'Networking',
        'NanoClaw',
        'Chores',
        'Archived Project',
      ]);
    });

    it('parses aliases correctly', () => {
      const nc = registry.find((e) => e.name === 'NanoClaw')!;
      expect(nc.aliases).toEqual(['nanoclaw', 'ai assistant', 'claw']);
    });

    it('parses vault path', () => {
      const nc = registry.find((e) => e.name === 'NanoClaw')!;
      expect(nc.vault).toBe('1. Projects/AI Assistant/');
    });

    it('parses routing tags', () => {
      const chores = registry.find((e) => e.name === 'Chores')!;
      expect(chores.routing).toContain('@chores');
      expect(chores.routing).toContain('insurance');
      expect(chores.routing).toContain('pills');
    });

    it('parses evergreen and github when present', () => {
      const nc = registry.find((e) => e.name === 'NanoClaw')!;
      expect(nc.evergreen).toBe(
        '1. Projects/AI Assistant/AI Assistant Evergreen.md',
      );
      expect(nc.github).toBe(
        'index-engine/nanoclaw, index-engine/ai_assistant',
      );
    });

    it('leaves evergreen/github undefined when placeholder', () => {
      const net = registry.find((e) => e.name === 'Networking')!;
      expect(net.evergreen).toBeUndefined();
      expect(net.github).toBeUndefined();
    });

    it('parses status', () => {
      const archived = registry.find((e) => e.name === 'Archived Project')!;
      expect(archived.status).toBe('archived');
    });
  });

  describe('findProjectByTag', () => {
    it('finds project by @tag', () => {
      const result = findProjectByTag(registry, '@nanoclaw');
      expect(result?.name).toBe('NanoClaw');
    });

    it('finds project by tag without @', () => {
      const result = findProjectByTag(registry, 'claw');
      expect(result?.name).toBe('NanoClaw');
    });

    it('returns null for unknown tag', () => {
      const result = findProjectByTag(registry, '@unknown');
      expect(result).toBeNull();
    });

    it('skips archived projects', () => {
      const result = findProjectByTag(registry, '@old');
      expect(result).toBeNull();
    });

    it('is case-insensitive', () => {
      const result = findProjectByTag(registry, '@NanoClaw');
      expect(result?.name).toBe('NanoClaw');
    });
  });

  describe('findProjectByName', () => {
    it('finds by exact name', () => {
      const result = findProjectByName(registry, 'Networking');
      expect(result?.name).toBe('Networking');
    });

    it('finds by alias', () => {
      const result = findProjectByName(registry, 'people');
      expect(result?.name).toBe('Networking');
    });

    it('is case-insensitive', () => {
      const result = findProjectByName(registry, 'nanoclaw');
      expect(result?.name).toBe('NanoClaw');
    });

    it('returns null for unknown name', () => {
      expect(findProjectByName(registry, 'nonexistent')).toBeNull();
    });
  });

  describe('detectProject', () => {
    it('detects from @tag in title', () => {
      const result = detectProject(registry, '@nanoclaw fix the sync', '');
      expect(result?.name).toBe('NanoClaw');
    });

    it('detects from @tag in body', () => {
      const result = detectProject(
        registry,
        'Fix something',
        'This is about @chores',
      );
      expect(result?.name).toBe('Chores');
    });

    it('detects from non-@tag routing keyword', () => {
      const result = detectProject(registry, 'Resubmit insurance claim', '');
      expect(result?.name).toBe('Chores');
    });

    it('returns null when no match', () => {
      const result = detectProject(registry, 'Random thought', 'No tags here');
      expect(result).toBeNull();
    });

    it('prefers @tag over keyword match', () => {
      const result = detectProject(
        registry,
        '@networking insurance question',
        '',
      );
      expect(result?.name).toBe('Networking');
    });
  });
});
