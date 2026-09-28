// ---------------------------------------------------------------------------
// Tests for artifact validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateArtifact, ValidationError } from '../validate.js';
import type { RunArtifact } from '../schema.js';

/** Helper to build a minimal valid artifact */
function minimal(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    version: '0.1',
    runId: 'test-run',
    timestamp: '2026-01-01T00:00:00Z',
    agent: { name: 'test-agent' },
    events: [],
    ...overrides,
  };
}

describe('validateArtifact', () => {
  it('accepts a minimal valid artifact', () => {
    const result = validateArtifact(minimal());
    expect(result.runId).toBe('test-run');
  });

  it('accepts a fully-populated artifact', () => {
    const full = minimal({
      model: { provider: 'openai', name: 'gpt-4o' },
      input: 'do something',
      events: [
        { id: 'e1', type: 'agent_start' },
        { id: 'e2', type: 'tool_call', tool: 'search' },
        { id: 'e3', type: 'agent_end', status: 'success' },
      ],
      result: { status: 'success' },
      durationMs: 1000,
      tokenUsage: { input: 100, output: 50, total: 150 },
      cost: { total: 0.01, currency: 'USD' },
      tags: ['test'],
      metadata: { custom: true },
    });
    const result = validateArtifact(full);
    expect(result.events).toHaveLength(3);
  });

  it('rejects null', () => {
    expect(() => validateArtifact(null)).toThrow(ValidationError);
  });

  it('rejects an array', () => {
    expect(() => validateArtifact([])).toThrow(ValidationError);
  });

  it('rejects a string', () => {
    expect(() => validateArtifact('not an object')).toThrow(ValidationError);
  });

  it('rejects missing version', () => {
    const data = { ...minimal(), version: undefined };
    expect(() => validateArtifact(data as unknown)).toThrow(/version/);
  });

  it('rejects unsupported version', () => {
    const data = { ...minimal(), version: '9.9' };
    expect(() => validateArtifact(data)).toThrow(/unsupported version/i);
  });

  it('rejects empty version', () => {
    const data = { ...minimal(), version: '' };
    expect(() => validateArtifact(data)).toThrow(/version/);
  });

  it('rejects missing runId', () => {
    const data = { ...minimal(), runId: undefined };
    expect(() => validateArtifact(data as unknown)).toThrow(/runId/);
  });

  it('rejects empty runId', () => {
    const data = { ...minimal(), runId: '   ' };
    expect(() => validateArtifact(data)).toThrow(/runId/);
  });

  it('rejects missing timestamp', () => {
    const data = { ...minimal(), timestamp: undefined };
    expect(() => validateArtifact(data as unknown)).toThrow(/timestamp/);
  });

  it('rejects missing agent', () => {
    const data = { ...minimal(), agent: undefined };
    expect(() => validateArtifact(data as unknown)).toThrow(/agent/);
  });

  it('rejects agent without name', () => {
    const data = { ...minimal(), agent: { name: '' } };
    expect(() => validateArtifact(data)).toThrow(/agent\.name/);
  });

  it('rejects missing events array', () => {
    const data = { ...minimal(), events: undefined };
    expect(() => validateArtifact(data as unknown)).toThrow(/events/);
  });

  it('rejects events as a non-array', () => {
    const data = { ...minimal(), events: 'not-array' };
    expect(() => validateArtifact(data as unknown)).toThrow(/events/);
  });

  it('rejects event without id', () => {
    const data = minimal({ events: [{ id: '', type: 'agent_start' }] });
    expect(() => validateArtifact(data)).toThrow(/field "id"/);
  });

  it('rejects event without type', () => {
    const data = minimal({ events: [{ id: 'e1', type: '' }] });
    expect(() => validateArtifact(data)).toThrow(/field "type"/);
  });

  it('accepts events with unknown types (extensibility)', () => {
    const data = minimal({
      events: [{ id: 'e1', type: 'custom_thing' as any }],
    });
    const result = validateArtifact(data);
    expect(result.events[0].type).toBe('custom_thing');
  });

  it('includes source path in error messages', () => {
    try {
      validateArtifact({}, 'my-file.json');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('my-file.json');
    }
  });
});
