// ---------------------------------------------------------------------------
// Diff engine — the heart of agentdiff
//
// Compares two RunArtifacts and produces a structured DiffResult that
// the formatter can render. All comparison logic lives here; the formatter
// only cares about presentation.
// ---------------------------------------------------------------------------

import type { RunArtifact, RunEvent } from './schema.js';
import { alignSequences, type DiffOperation } from './align.js';

// ── Diff result types ──────────────────────────────────────────────────────

export interface MetadataDiff {
  agentName: { a?: string; b?: string } | null;
  agentVersion: { a?: string; b?: string } | null;
  modelProvider: { a?: string; b?: string } | null;
  modelName: { a?: string; b?: string } | null;
  status: { a?: string; b?: string } | null;
  durationMs: { a?: number; b?: number } | null;
  input: { a?: string; b?: string } | null;
}

export interface TokenDiff {
  inputTokens: { a?: number; b?: number } | null;
  outputTokens: { a?: number; b?: number } | null;
  totalTokens: { a?: number; b?: number } | null;
}

export interface CostDiff {
  total: { a?: number; b?: number } | null;
  currency: string;
}

export interface ToolUsageEntry {
  tool: string;
  countA: number;
  countB: number;
  change: number; // positive = more in B
}

export interface FileEntry {
  file: string;
  inA: boolean;
  inB: boolean;
  types: string[]; // 'read' | 'write'
}

export interface CommandEntry {
  command: string;
  inA: boolean;
  inB: boolean;
}

export interface ErrorEntry {
  error: string;
  type?: string;
  inA: boolean;
  inB: boolean;
}

export type PathStepKind = 'model_call' | 'model_response' | 'tool_call' | 'tool_result' | string;

export interface PathStep {
  type: PathStepKind;
  label: string;
}

export interface EventCountDiff {
  a: number;
  b: number;
  byType: Map<string, { a: number; b: number }>;
}

export interface DiffResult {
  runIdA: string;
  runIdB: string;
  metadata: MetadataDiff;
  tokens: TokenDiff;
  cost: CostDiff;
  toolUsage: ToolUsageEntry[];
  pathA: PathStep[];
  pathB: PathStep[];
  pathAlignment: DiffOperation[];
  files: FileEntry[];
  commands: CommandEntry[];
  errors: ErrorEntry[];
  eventCounts: EventCountDiff;
  identical: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function changed<T>(a: T | undefined, b: T | undefined): { a: T | undefined; b: T | undefined } | null {
  if (a === b) return null;
  if (a === undefined && b === undefined) return null;
  return { a, b };
}

function eventToPathStep(evt: RunEvent): PathStep {
  switch (evt.type) {
    case 'tool_call':
      return { type: 'tool_call', label: evt.tool ?? 'unknown_tool' };
    case 'tool_result':
      return { type: 'tool_result', label: evt.tool ?? 'unknown_tool' };
    case 'model_call':
      return { type: 'model_call', label: 'model' };
    case 'model_response':
      return { type: 'model_response', label: 'response' };
    case 'file_read':
      return { type: 'file_read', label: `read(${evt.file ?? '?'})` };
    case 'file_write':
      return { type: 'file_write', label: `write(${evt.file ?? '?'})` };
    case 'command_execution':
      return { type: 'command_execution', label: `cmd(${truncate(evt.command ?? '?', 20)})` };
    case 'error':
      return { type: 'error', label: `error` };
    case 'agent_start':
      return { type: 'agent_start', label: 'start' };
    case 'agent_end':
      return { type: 'agent_end', label: 'end' };
    default:
      return { type: evt.type, label: evt.type };
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ── Tool usage ─────────────────────────────────────────────────────────────

function countToolCalls(events: RunEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const evt of events) {
    if (evt.type === 'tool_call' && evt.tool) {
      counts.set(evt.tool, (counts.get(evt.tool) ?? 0) + 1);
    }
  }
  return counts;
}

function diffToolUsage(eventsA: RunEvent[], eventsB: RunEvent[]): ToolUsageEntry[] {
  const countsA = countToolCalls(eventsA);
  const countsB = countToolCalls(eventsB);
  const allTools = new Set([...countsA.keys(), ...countsB.keys()]);
  const result: ToolUsageEntry[] = [];
  for (const tool of [...allTools].sort()) {
    const cA = countsA.get(tool) ?? 0;
    const cB = countsB.get(tool) ?? 0;
    result.push({ tool, countA: cA, countB: cB, change: cB - cA });
  }
  return result;
}

// ── Files ──────────────────────────────────────────────────────────────────

function collectFiles(events: RunEvent[]): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const evt of events) {
    if ((evt.type === 'file_read' || evt.type === 'file_write') && evt.file) {
      const existing = files.get(evt.file) ?? new Set();
      existing.add(evt.type === 'file_read' ? 'read' : 'write');
      files.set(evt.file, existing);
    }
  }
  return files;
}

function diffFiles(eventsA: RunEvent[], eventsB: RunEvent[]): FileEntry[] {
  const filesA = collectFiles(eventsA);
  const filesB = collectFiles(eventsB);
  const allFiles = new Set([...filesA.keys(), ...filesB.keys()]);
  const result: FileEntry[] = [];
  for (const file of [...allFiles].sort()) {
    const typesA = filesA.get(file);
    const typesB = filesB.get(file);
    const types = [...new Set([...(typesA ?? []), ...(typesB ?? [])])];
    result.push({ file, inA: !!typesA, inB: !!typesB, types });
  }
  return result;
}

// ── Commands ───────────────────────────────────────────────────────────────

function collectCommands(events: RunEvent[]): Set<string> {
  const cmds = new Set<string>();
  for (const evt of events) {
    if (evt.type === 'command_execution' && evt.command) {
      cmds.add(evt.command);
    }
  }
  return cmds;
}

function diffCommands(eventsA: RunEvent[], eventsB: RunEvent[]): CommandEntry[] {
  const cmdsA = collectCommands(eventsA);
  const cmdsB = collectCommands(eventsB);
  const all = new Set([...cmdsA, ...cmdsB]);
  const result: CommandEntry[] = [];
  for (const cmd of [...all].sort()) {
    result.push({ command: cmd, inA: cmdsA.has(cmd), inB: cmdsB.has(cmd) });
  }
  return result;
}

// ── Errors ─────────────────────────────────────────────────────────────────

function collectErrors(events: RunEvent[]): Map<string, string | undefined> {
  const errors = new Map<string, string | undefined>();
  for (const evt of events) {
    if (evt.type === 'error' && evt.error) {
      errors.set(evt.error, evt.errorType);
    }
  }
  return errors;
}

function diffErrors(eventsA: RunEvent[], eventsB: RunEvent[]): ErrorEntry[] {
  const errA = collectErrors(eventsA);
  const errB = collectErrors(eventsB);
  const all = new Set([...errA.keys(), ...errB.keys()]);
  const result: ErrorEntry[] = [];
  for (const err of all) {
    result.push({
      error: err,
      type: errA.get(err) ?? errB.get(err),
      inA: errA.has(err),
      inB: errB.has(err),
    });
  }
  return result;
}

// ── Event counts ───────────────────────────────────────────────────────────

function countByType(events: RunEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const evt of events) {
    counts.set(evt.type, (counts.get(evt.type) ?? 0) + 1);
  }
  return counts;
}

function diffEventCounts(eventsA: RunEvent[], eventsB: RunEvent[]): EventCountDiff {
  const byTypeA = countByType(eventsA);
  const byTypeB = countByType(eventsB);
  const allTypes = new Set([...byTypeA.keys(), ...byTypeB.keys()]);
  const byType = new Map<string, { a: number; b: number }>();
  for (const t of [...allTypes].sort()) {
    byType.set(t, { a: byTypeA.get(t) ?? 0, b: byTypeB.get(t) ?? 0 });
  }
  return { a: eventsA.length, b: eventsB.length, byType };
}

// ── Main diff function ─────────────────────────────────────────────────────

export function diffRuns(a: RunArtifact, b: RunArtifact): DiffResult {
  const metadata: MetadataDiff = {
    agentName: changed(a.agent.name, b.agent.name),
    agentVersion: changed(a.agent.version, b.agent.version),
    modelProvider: changed(a.model?.provider, b.model?.provider),
    modelName: changed(a.model?.name, b.model?.name),
    status: changed(a.result?.status, b.result?.status),
    durationMs: changed(a.durationMs, b.durationMs),
    input: changed(a.input, b.input),
  };

  const tokens: TokenDiff = {
    inputTokens: changed(a.tokenUsage?.input, b.tokenUsage?.input),
    outputTokens: changed(a.tokenUsage?.output, b.tokenUsage?.output),
    totalTokens: changed(a.tokenUsage?.total, b.tokenUsage?.total),
  };

  const cost: CostDiff = {
    total: changed(a.cost?.total, b.cost?.total),
    currency: a.cost?.currency ?? b.cost?.currency ?? 'USD',
  };

  const toolUsage = diffToolUsage(a.events, b.events);
  const pathA = a.events.map(eventToPathStep);
  const pathB = b.events.map(eventToPathStep);
  const files = diffFiles(a.events, b.events);
  const commands = diffCommands(a.events, b.events);
  const errors = diffErrors(a.events, b.events);
  const eventCounts = diffEventCounts(a.events, b.events);

  // Determine if runs are structurally identical
  const identical =
    metadata.agentName === null &&
    metadata.agentVersion === null &&
    metadata.modelProvider === null &&
    metadata.modelName === null &&
    metadata.status === null &&
    metadata.durationMs === null &&
    tokens.inputTokens === null &&
    tokens.outputTokens === null &&
    tokens.totalTokens === null &&
    cost.total === null &&
    toolUsage.every(t => t.change === 0) &&
    pathA.length === pathB.length &&
    pathA.every((s, i) => s.type === pathB[i]?.type && s.label === pathB[i]?.label) &&
    files.every(f => f.inA === f.inB) &&
    commands.every(c => c.inA === c.inB) &&
    errors.every(e => e.inA === e.inB) &&
    metadata.input === null;

  return {
    runIdA: a.runId,
    runIdB: b.runId,
    metadata,
    tokens,
    cost,
    toolUsage,
    pathA,
    pathB,
    pathAlignment: alignSequences(pathA.map(p => p.label), pathB.map(p => p.label)),
    files,
    commands,
    errors,
    eventCounts,
    identical,
  };
}
