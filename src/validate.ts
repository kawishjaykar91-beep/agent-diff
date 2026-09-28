// ---------------------------------------------------------------------------
// Artifact validation
//
// Validates that a parsed JSON object conforms to the RunArtifact schema.
// Does NOT use a heavyweight validation library — hand-written checks are
// sufficient for v0.1 and keep dependencies at zero.
// ---------------------------------------------------------------------------

import { SCHEMA_VERSION, type RunArtifact, type RunEvent, type EventType } from './schema.js';

const KNOWN_EVENT_TYPES: Set<string> = new Set<string>([
  'agent_start', 'agent_end', 'model_call', 'model_response',
  'tool_call', 'tool_result', 'file_read', 'file_write',
  'command_execution', 'error', 'custom',
]);

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate a raw parsed object as a RunArtifact.
 * Throws ValidationError on the first problem found.
 * Returns the typed artifact on success.
 */
export function validateArtifact(data: unknown, sourcePath?: string): RunArtifact {
  const label = sourcePath ? ` (${sourcePath})` : '';

  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError(
      `Artifact${label} must be a JSON object`,
      'root',
    );
  }

  const obj = data as Record<string, unknown>;

  // version
  if (typeof obj.version !== 'string' || obj.version.trim() === '') {
    throw new ValidationError(
      `Artifact${label} is missing required field "version"`,
      'version',
    );
  }
  if (obj.version !== SCHEMA_VERSION) {
    throw new ValidationError(
      `Artifact${label} has unsupported version "${obj.version}" (expected "${SCHEMA_VERSION}")`,
      'version',
    );
  }

  // runId
  if (typeof obj.runId !== 'string' || obj.runId.trim() === '') {
    throw new ValidationError(
      `Artifact${label} is missing required field "runId"`,
      'runId',
    );
  }

  // timestamp
  if (typeof obj.timestamp !== 'string' || obj.timestamp.trim() === '') {
    throw new ValidationError(
      `Artifact${label} is missing required field "timestamp"`,
      'timestamp',
    );
  }

  // agent
  if (typeof obj.agent !== 'object' || obj.agent === null || Array.isArray(obj.agent)) {
    throw new ValidationError(
      `Artifact${label} is missing required field "agent" (must be an object)`,
      'agent',
    );
  }
  const agent = obj.agent as Record<string, unknown>;
  if (typeof agent.name !== 'string' || agent.name.trim() === '') {
    throw new ValidationError(
      `Artifact${label} agent.name is required`,
      'agent.name',
    );
  }

  // events
  if (!Array.isArray(obj.events)) {
    throw new ValidationError(
      `Artifact${label} is missing required field "events" (must be an array)`,
      'events',
    );
  }

  for (let i = 0; i < obj.events.length; i++) {
    validateEvent(obj.events[i] as unknown, i, label);
  }

  return data as RunArtifact;
}

function validateEvent(data: unknown, index: number, label: string): void {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError(
      `Event at index ${index}${label} must be an object`,
      `events[${index}]`,
    );
  }

  const evt = data as Record<string, unknown>;

  if (typeof evt.id !== 'string' || evt.id.trim() === '') {
    throw new ValidationError(
      `Event at index ${index}${label} is missing required field "id"`,
      `events[${index}].id`,
    );
  }

  if (typeof evt.type !== 'string' || evt.type.trim() === '') {
    throw new ValidationError(
      `Event at index ${index}${label} is missing required field "type"`,
      `events[${index}].type`,
    );
  }

  // Warn-level: unknown types are allowed (extensibility) but we note them
  // For now we just accept them silently — the diff engine treats unknown
  // types generically.
}

/**
 * Check whether a string is a known event type.
 */
export function isKnownEventType(t: string): t is EventType {
  return KNOWN_EVENT_TYPES.has(t);
}
