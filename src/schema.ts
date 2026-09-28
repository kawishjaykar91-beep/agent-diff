// ---------------------------------------------------------------------------
// Run Artifact Schema — v0.1
//
// This is the portable execution format for agentdiff. It captures the
// structured trace of an AI-agent execution in a provider-neutral,
// framework-neutral way.
//
// Design principles:
//   - Every field is either required or explicitly optional
//   - The `events` array is ordered chronologically
//   - Provider-specific data goes in `metadata` (free-form record)
//   - New event types can be added without changing existing code
// ---------------------------------------------------------------------------

/** Supported schema version */
export const SCHEMA_VERSION = '0.1';

// ── Event types ────────────────────────────────────────────────────────────

/**
 * Discriminated union tag for all event types.
 * New types can be added here without breaking existing events.
 */
export type EventType =
  | 'agent_start'
  | 'agent_end'
  | 'model_call'
  | 'model_response'
  | 'tool_call'
  | 'tool_result'
  | 'file_read'
  | 'file_write'
  | 'command_execution'
  | 'error'
  | 'custom';

/**
 * A single event in the execution trace.
 *
 * The `type` field acts as a discriminator. Fields like `tool`, `model`,
 * `file`, `command` are only present for the relevant event types.
 */
export interface RunEvent {
  /** Unique event ID within this run */
  id: string;

  /** Event type discriminator */
  type: EventType;

  /** ISO 8601 timestamp of when the event occurred */
  timestamp?: string;

  /** Duration in milliseconds (for events that have measurable duration) */
  durationMs?: number;

  // ── Tool-related fields (tool_call / tool_result) ──────────────────────
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;

  // ── Model-related fields (model_call / model_response) ─────────────────
  model?: string;
  provider?: string;
  messages?: Array<{ role: string; content: string }>;
  response?: string;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };

  // ── File-related fields (file_read / file_write) ───────────────────────
  file?: string;
  content?: string;

  // ── Command-related fields (command_execution) ─────────────────────────
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;

  // ── Error fields (error) ───────────────────────────────────────────────
  error?: string;
  errorType?: string;
  recoverable?: boolean;

  // ── Status (agent_end) ─────────────────────────────────────────────────
  status?: string;

  // ── Extension point ────────────────────────────────────────────────────
  metadata?: Record<string, unknown>;
}

// ── Run-level structures ───────────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelInfo {
  provider: string;
  name: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface RunResult {
  status: 'success' | 'failure' | 'error' | 'timeout' | 'cancelled' | string;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenSummary {
  input?: number;
  output?: number;
  total?: number;
}

export interface CostSummary {
  total?: number;
  currency?: string;
}

/**
 * The top-level run artifact.
 *
 * This is the file developers save and pass to `agentdiff diff`.
 */
export interface RunArtifact {
  /** Schema version — must match SCHEMA_VERSION */
  version: string;

  /** Unique run identifier */
  runId: string;

  /** ISO 8601 timestamp of when the run started */
  timestamp: string;

  /** Information about the agent that executed */
  agent: AgentInfo;

  /** Primary model used (if applicable) */
  model?: ModelInfo;

  /** The input / task given to the agent */
  input?: string;

  /** Ordered sequence of execution events */
  events: RunEvent[];

  /** Final result of the run */
  result?: RunResult;

  /** Total duration in milliseconds */
  durationMs?: number;

  /** Aggregate token usage */
  tokenUsage?: TokenSummary;

  /** Estimated cost */
  cost?: CostSummary;

  /** Tags for categorization */
  tags?: string[];

  /** Free-form extension data */
  metadata?: Record<string, unknown>;
}
