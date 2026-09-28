import { describe, it, expect } from 'vitest';
import { runRegressionTest } from '../test-engine.js';
import { diffRuns } from '../diff.js';
import type { RunArtifact } from '../schema.js';
import { DEFAULT_CONFIG } from '../test-config.js';

function minimal(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    version: '0.1',
    runId: 'r1',
    timestamp: '2026-01-01T00:00:00Z',
    agent: { name: 'agent' },
    events: [],
    ...overrides,
  };
}

describe('Test Engine', () => {
  it('passes identical artifacts', () => {
    const a = minimal({
      events: [
        { id: '1', type: 'agent_start' },
        { id: '2', type: 'tool_call', tool: 'search' },
        { id: '3', type: 'agent_end' }
      ]
    });
    const diff = diffRuns(a, JSON.parse(JSON.stringify(a)));
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('ignores harmless timestamp and runId changes', () => {
    const a = minimal({ runId: 'A', timestamp: '2020-01-01T00:00:00Z' });
    const b = minimal({ runId: 'B', timestamp: '2021-01-01T00:00:00Z' });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(true);
  });

  it('fails if extra tool call is added', () => {
    const a = minimal({
      events: [{ id: '1', type: 'tool_call', tool: 'search' }]
    });
    const b = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' },
        { id: '2', type: 'tool_call', tool: 'read' }
      ]
    });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ category: 'tool', message: expect.stringContaining('read') })
    );
  });

  it('fails if path diverges', () => {
    const a = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' },
        { id: '2', type: 'tool_call', tool: 'read' }
      ]
    });
    const b = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' },
        { id: '2', type: 'tool_call', tool: 'write' } // Divergence
      ]
    });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ category: 'path' })
    );
  });

  it('fails on new error', () => {
    const a = minimal({ events: [] });
    const b = minimal({
      events: [{ id: '1', type: 'error', error: 'Database failed' }]
    });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ category: 'error', message: expect.stringContaining('Database failed') })
    );
  });

  it('does not fail on model change by default', () => {
    const a = minimal({ model: { provider: 'openai', name: 'gpt-3' } });
    const b = minimal({ model: { provider: 'anthropic', name: 'claude' } });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff);
    expect(result.passed).toBe(true);
  });

  it('fails on model change if configured', () => {
    const a = minimal({ model: { provider: 'openai', name: 'gpt-3' } });
    const b = minimal({ model: { provider: 'anthropic', name: 'claude' } });
    const diff = diffRuns(a, b);
    const result = runRegressionTest(diff, { ...DEFAULT_CONFIG, assertModel: true });
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ category: 'model' })
    );
  });

  it('fails on cost thresholds', () => {
    const a = minimal({ cost: { total: 1.0, currency: 'USD' } });
    const b = minimal({ cost: { total: 2.0, currency: 'USD' } });
    const diff = diffRuns(a, b);
    
    // Test max increase pct
    let result = runRegressionTest(diff, { ...DEFAULT_CONFIG, assertCost: { maxIncreasePct: 50 } });
    expect(result.passed).toBe(false);
    expect(result.violations[0].category).toBe('cost');
    expect(result.violations[0].message).toContain('100.0%');

    // Test max total
    result = runRegressionTest(diff, { ...DEFAULT_CONFIG, assertCost: { maxTotal: 1.5 } });
    expect(result.passed).toBe(false);
  });
});
