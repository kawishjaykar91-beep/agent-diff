import { describe, it, expect, beforeEach } from 'vitest';
import { AgentReplay, ReplayMismatchError } from '../../replay/index.js';
import { replayGenerateText } from '../../replay/vercel-ai.js';
import type { RunArtifact } from '../../schema.js';

// ── Fixture helpers ────────────────────────────────────────────────────────

function createFixtureArtifact(overrides?: Partial<RunArtifact>): RunArtifact {
  return {
    version: '0.1',
    runId: 'run-fixture-001',
    timestamp: '2026-09-27T00:00:00Z',
    agent: { name: 'vercel-test-agent' },
    input: 'Test task',
    events: [
      { id: 'evt-1', type: 'agent_start', timestamp: '2026-09-27T00:00:00Z' },
      {
        id: 'evt-2', type: 'model_call', timestamp: '2026-09-27T00:00:01Z',
        provider: 'openai', model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      },
      {
        id: 'evt-3', type: 'model_response', timestamp: '2026-09-27T00:00:02Z',
        durationMs: 500,
        response: 'The capital of France is Paris.',
        tokenUsage: { input: 12, output: 8, total: 20 },
        metadata: { finishReason: 'stop' },
      },
      { id: 'evt-4', type: 'agent_end', timestamp: '2026-09-27T00:00:03Z', status: 'success' },
    ],
    ...overrides,
  };
}

function createFixtureWithTools(): RunArtifact {
  return {
    version: '0.1',
    runId: 'run-fixture-tools',
    timestamp: '2026-09-27T00:00:00Z',
    agent: { name: 'vercel-tool-agent' },
    input: 'Weather task',
    events: [
      { id: 'evt-1', type: 'agent_start', timestamp: '2026-09-27T00:00:00Z' },
      {
        id: 'evt-2', type: 'model_call', timestamp: '2026-09-27T00:00:01Z',
        provider: 'openai', model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Weather in SF?' }],
      },
      {
        id: 'evt-3', type: 'model_response', timestamp: '2026-09-27T00:00:02Z',
        durationMs: 300,
        response: '',
        tokenUsage: { input: 25, output: 15, total: 40 },
        metadata: { finishReason: 'tool-calls' },
      },
      {
        id: 'evt-4', type: 'tool_call', timestamp: '2026-09-27T00:00:02Z',
        tool: 'get_weather', arguments: { city: 'San Francisco' },
      },
      {
        id: 'evt-5', type: 'tool_result', timestamp: '2026-09-27T00:00:02Z',
        tool: 'get_weather', result: 'Sunny, 72°F',
      },
      { id: 'evt-6', type: 'agent_end', timestamp: '2026-09-27T00:00:03Z', status: 'success' },
    ],
  };
}

describe('Vercel AI SDK — replayGenerateText', () => {

  beforeEach(() => {
    delete process.env.AGENTDIFF_REPLAY_FIXTURE;
  });

  it('replays a basic text response deterministically', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    const result = await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the capital of France?',
    });

    // Verify the replayed result
    expect(result.text).toBe('The capital of France is Paris.');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.promptTokens).toBe(12);
    expect(result.usage.completionTokens).toBe(8);
    expect(result.usage.totalTokens).toBe(20);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.toolResults).toHaveLength(0);

    // Verify the new trace was recorded
    const newArtifact = replay.getRecorder().getArtifact();
    const modelCall = newArtifact.events.find(e => e.type === 'model_call');
    expect(modelCall).toBeDefined();
    expect(modelCall!.model).toBe('gpt-4o');

    const modelResponse = newArtifact.events.find(e => e.type === 'model_response');
    expect(modelResponse).toBeDefined();
    expect(modelResponse!.response).toBe('The capital of France is Paris.');
  });

  it('replays tool calls from the fixture', async () => {
    const fixture = createFixtureWithTools();
    const replay = new AgentReplay(fixture);

    const result = await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'Weather in SF?',
    });

    expect(result.text).toBe('');
    expect(result.finishReason).toBe('tool-calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('get_weather');
    expect(result.toolCalls[0].args).toEqual({ city: 'San Francisco' });
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0].toolName).toBe('get_weather');
    expect(result.toolResults[0].result).toBe('Sunny, 72°F');

    // Verify the new trace contains tool events
    const newArtifact = replay.getRecorder().getArtifact();
    const toolCallEvents = newArtifact.events.filter(e => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0].tool).toBe('get_weather');

    const toolResultEvents = newArtifact.events.filter(e => e.type === 'tool_result');
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].result).toBe('Sunny, 72°F');
  });

  it('throws ReplayMismatchError for model mismatch', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    await expect(
      replayGenerateText(replay, {
        model: { modelId: 'claude-sonnet-4-20250514', provider: 'anthropic' },
        prompt: 'What is the capital of France?',
      })
    ).rejects.toThrow(ReplayMismatchError);
  });

  it('throws ReplayMismatchError for message count mismatch', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    await expect(
      replayGenerateText(replay, {
        model: { modelId: 'gpt-4o', provider: 'openai' },
        system: 'You are helpful.',
        prompt: 'What is the capital of France?',
      })
    ).rejects.toThrow(ReplayMismatchError);
  });

  it('accumulates token usage on the new artifact', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the capital of France?',
    });

    const newArtifact = replay.getRecorder().getArtifact();
    expect(newArtifact.tokenUsage).toEqual({ input: 12, output: 8, total: 20 });
  });

  it('sets model info on the replayed artifact', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the capital of France?',
    });

    const newArtifact = replay.getRecorder().getArtifact();
    expect(newArtifact.model).toEqual({ provider: 'openai', name: 'gpt-4o' });
  });

  it('does not make network calls during replay', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    // replayGenerateText never calls generateText from 'ai';
    // it constructs the result entirely from the fixture.
    // This test verifies the function signature: no generateTextFn parameter is needed.
    const result = await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the capital of France?',
    });

    expect(result.text).toBe('The capital of France is Paris.');
  });

  it('produces a steps array in the replayed result', async () => {
    const fixture = createFixtureArtifact();
    const replay = new AgentReplay(fixture);

    const result = await replayGenerateText(replay, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the capital of France?',
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].text).toBe('The capital of France is Paris.');
    expect(result.steps[0].finishReason).toBe('stop');
  });
});
