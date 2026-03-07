/** Shared types for the fleeting notes pipeline. */

export interface FleetingNote {
  /** Vault-relative path: Fleeting/{year}/{month}/{day}/{slug}.md */
  path: string;
  slug: string;
  title: string;
  body: string;
  source: 'things' | 'telegram' | 'email';
  thingsUuid?: string;
  created: string; // YYYY-MM-DD
  status: 'raw' | 'completed' | 'retired';
  project?: string;
  convertedTo?: string;
  literatureNote?: string;
  routingSession?: string;
}

export interface ThingsItem {
  uuid: string;
  title: string;
  notes: string;
  creationDate: number; // Unix timestamp
  projectTitle?: string;
}

export interface RoutingProposal {
  /** "Project {name}." or "No project match." */
  projectLine: string;
  /** Full proposal text: "{projectLine} {conversionPath} — {description}" */
  text: string;
}

export interface UserDecision {
  itemIndex: number;
  fleetingPath: string;
  action: 'accept' | 'retire' | 'response' | 'chat' | 'skip';
  responseText?: string;
  chatText?: string;
  proposal?: RoutingProposal;
}

export interface ProjectRegistryEntry {
  name: string;
  aliases: string[];
  vault: string;
  evergreen?: string;
  github?: string;
  status: string;
  routing: string[];
}

export interface IngestResult {
  created: FleetingNote[];
  skipped: string[]; // UUIDs that already had fleeting notes
  errors: string[];
}

export interface RoutingResult {
  routed: Array<{
    fleetingPath: string;
    action: string;
    destinationPath?: string;
  }>;
  errors: string[];
}

export interface IntegrityIssue {
  type:
    | 'orphan'
    | 'broken-link'
    | 'case-sensitive'
    | 'missing-date-prefix'
    | 'wrong-query-filter'
    | 'raw-remaining'
    | 'broken-bold';
  file: string;
  detail: string;
}

export interface IntegrityReport {
  issues: IntegrityIssue[];
  checked: number;
  passed: boolean;
}
