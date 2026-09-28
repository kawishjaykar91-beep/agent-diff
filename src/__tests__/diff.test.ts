// ---------------------------------------------------------------------------
// Tests for the diff engine
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { diffRuns } from '../diff.js';
import type { RunArtifact } from '../schema.js';

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

describe('diffRuns', () => {
  it('detects identical runs', () => {
    const a = minimal({
      model: { provider: 'p1', name: 'm1' },
      durationMs: 100,
      tokenUsage: { total: 50 },
      events: [
        { id: '1', type: 'agent_start' },
        { id: '2', type: 'tool_call', tool: 'search' }
      ]
    });
    // Deep copy to ensure no reference sharing
    const b = JSON.parse(JSON.stringify(a));
    
    const diff = diffRuns(a, b);
    expect(diff.identical).toBe(true);
  });

  it('detects metadata changes', () => {
    const a = minimal({ agent: { name: 'v1' }, durationMs: 100 });
    const b = minimal({ agent: { name: 'v2' }, durationMs: 200 });
    
    const diff = diffRuns(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.metadata.agentName).toEqual({ a: 'v1', b: 'v2' });
    expect(diff.metadata.durationMs).toEqual({ a: 100, b: 200 });
  });

  it('diffs tool usage correctly', () => {
    const a = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' },
        { id: '2', type: 'tool_call', tool: 'read' }
      ]
    });
    const b = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' },
        { id: '2', type: 'tool_call', tool: 'search' },
        { id: '3', type: 'tool_call', tool: 'write' }
      ]
    });
    
    const diff = diffRuns(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.toolUsage).toHaveLength(3);
    
    const search = diff.toolUsage.find(t => t.tool === 'search');
    expect(search).toEqual({ tool: 'search', countA: 1, countB: 2, change: 1 });
    
    const read = diff.toolUsage.find(t => t.tool === 'read');
    expect(read).toEqual({ tool: 'read', countA: 1, countB: 0, change: -1 });
    
    const write = diff.toolUsage.find(t => t.tool === 'write');
    expect(write).toEqual({ tool: 'write', countA: 0, countB: 1, change: 1 });
  });

  it('diffs execution paths correctly', () => {
    const a = minimal({
      events: [
        { id: '1', type: 'model_call' },
        { id: '2', type: 'tool_call', tool: 'search' }
      ]
    });
    const b = minimal({
      events: [
        { id: '1', type: 'tool_call', tool: 'search' }
      ]
    });

    const diff = diffRuns(a, b);
    expect(diff.pathA).toHaveLength(2);
    expect(diff.pathA[0]).toEqual({ type: 'model_call', label: 'model' });
    expect(diff.pathA[1]).toEqual({ type: 'tool_call', label: 'search' });
    
    expect(diff.pathB).toHaveLength(1);
    expect(diff.pathB[0]).toEqual({ type: 'tool_call', label: 'search' });
  });

  it('diffs file interactions', () => {
    const a = minimal({
      events: [
        { id: '1', type: 'file_read', file: 'a.txt' },
        { id: '2', type: 'file_write', file: 'b.txt' }
      ]
    });
    const b = minimal({
      events: [
        { id: '1', type: 'file_read', file: 'b.txt' }
      ]
    });

    const diff = diffRuns(a, b);
    expect(diff.files).toHaveLength(2);
    
    const fA = diff.files.find(f => f.file === 'a.txt');
    expect(fA).toEqual({ file: 'a.txt', inA: true, inB: false, types: ['read'] });

    const fB = diff.files.find(f => f.file === 'b.txt');
    expect(fB?.types).toContain('write');
    expect(fB?.types).toContain('read');
    expect(fB?.inA).toBe(true);
    expect(fB?.inB).toBe(true);
  });

  it('diffs commands correctly', () => {
    const a = minimal({ events: [{ id: '1', type: 'command_execution', command: 'npm install' }] });
    const b = minimal({ events: [{ id: '1', type: 'command_execution', command: 'npm test' }] });
    
    const diff = diffRuns(a, b);
    expect(diff.commands).toHaveLength(2);
    expect(diff.commands.find(c => c.command === 'npm install')).toEqual({ command: 'npm install', inA: true, inB: false });
    expect(diff.commands.find(c => c.command === 'npm test')).toEqual({ command: 'npm test', inA: false, inB: true });
  });

  it('diffs errors (newly introduced and resolved)', () => {
    const a = minimal({ events: [{ id: '1', type: 'error', error: 'Database timeout', errorType: 'TimeoutError' }] });
    const b = minimal({ events: [{ id: '1', type: 'error', error: 'Out of memory' }] });
    
    const diff = diffRuns(a, b);
    expect(diff.errors).toHaveLength(2);
    expect(diff.errors.find(e => e.error === 'Database timeout')).toEqual({ error: 'Database timeout', type: 'TimeoutError', inA: true, inB: false });
    expect(diff.errors.find(e => e.error === 'Out of memory')).toEqual({ error: 'Out of memory', type: undefined, inA: false, inB: true });
  });

  it('diffs token counts', () => {
    const a = minimal({ tokenUsage: { input: 10, output: 5, total: 15 } });
    const b = minimal({ tokenUsage: { input: 20, output: 5, total: 25 } });
    
    const diff = diffRuns(a, b);
    expect(diff.tokens.inputTokens).toEqual({ a: 10, b: 20 });
    expect(diff.tokens.outputTokens).toBeNull();
    expect(diff.tokens.totalTokens).toEqual({ a: 15, b: 25 });
  });

  it('diffs cost including null/missing', () => {
    const a = minimal({ cost: { total: 0.1, currency: 'USD' } });
    const b = minimal({});
    const diff1 = diffRuns(a, b);
    expect(diff1.cost.total).toEqual({ a: 0.1, b: undefined });

    const c = minimal({});
    const d = minimal({});
    const diff2 = diffRuns(c, d);
    expect(diff2.cost.total).toBeNull();

    const e = minimal({ cost: { total: 0, currency: 'USD' } });
    const f = minimal({ cost: { total: 0, currency: 'USD' } });
    const diff3 = diffRuns(e, f);
    expect(diff3.cost.total).toBeNull(); // No change
  });

  it('diffs models', () => {
    const a = minimal({ model: { provider: 'openai', name: 'gpt-4o' } });
    const b = minimal({ model: { provider: 'anthropic', name: 'claude-3' } });
    
    const diff = diffRuns(a, b);
    expect(diff.metadata.modelProvider).toEqual({ a: 'openai', b: 'anthropic' });
    expect(diff.metadata.modelName).toEqual({ a: 'gpt-4o', b: 'claude-3' });
  });

  it('handles empty execution paths safely', () => {
    const diff = diffRuns(minimal(), minimal());
    expect(diff.pathA).toHaveLength(0);
    expect(diff.pathB).toHaveLength(0);
    expect(diff.pathAlignment).toHaveLength(0);
  });
});
