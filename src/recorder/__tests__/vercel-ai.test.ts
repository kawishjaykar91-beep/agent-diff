import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRecorder } from '../../recorder/index.js';
import { recordGenerateText } from '../../recorder/vercel-ai.js';

// ── Mock model objects ─────────────────────────────────────────────────────

function mockModel(modelId: string, provider: string) {
  return { modelId, provider };
}

// ── Mock generateText implementations ──────────────────────────────────────

function createMockGenerateText(result: any) {
  return async (_options: any) => result;
}

function createFailingGenerateText(error: Error) {
  return async (_options: any) => { throw error; };
}

describe('Vercel AI SDK — recordGenerateText', () => {
  let recorder: AgentRecorder;

  beforeEach(() => {
    // Clean replay env to avoid auto-replay interference
    delete process.env.AGENTDIFF_REPLAY_FIXTURE;
    recorder = new AgentRecorder({ name: 'vercel-test-agent' }, 'Test task');
  });

  it('records a basic generateText call with text response', async () => {
    const mockResult = {
      text: 'Paris is the capital of France.',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      steps: [],
    };

    const generateTextFn = createMockGenerateText(mockResult);

    const result = await recordGenerateText(recorder, generateTextFn, {
      model: mockModel('gpt-4o', 'openai'),
      prompt: 'What is the capital of France?',
    });

    // Verify the original result is returned unchanged
    expect(result).toBe(mockResult);
    expect(result.text).toBe('Paris is the capital of France.');

    // Verify events were recorded
    const artifact = recorder.getArtifact();
    const events = artifact.events;

    // agent_start + model_call + model_response = 3 events
    expect(events.length).toBe(3);

    const modelCall = events.find(e => e.type === 'model_call');
    expect(modelCall).toBeDefined();
    expect(modelCall!.provider).toBe('openai');
    expect(modelCall!.model).toBe('gpt-4o');
    expect(modelCall!.messages).toEqual([
      { role: 'user', content: 'What is the capital of France?' }
    ]);

    const modelResponse = events.find(e => e.type === 'model_response');
    expect(modelResponse).toBeDefined();
    expect(modelResponse!.response).toBe('Paris is the capital of France.');
    expect(modelResponse!.tokenUsage).toEqual({ input: 10, output: 8, total: 18 });
  });

  it('records tool calls from generateText result', async () => {
    const mockResult = {
      text: '',
      toolCalls: [
        { toolName: 'get_weather', toolCallId: 'call_1', args: { city: 'San Francisco' } },
        { toolName: 'get_time', toolCallId: 'call_2', args: { timezone: 'PST' } },
      ],
      toolResults: [
        { toolName: 'get_weather', toolCallId: 'call_1', result: 'Sunny, 72°F' },
        { toolName: 'get_time', toolCallId: 'call_2', result: '2:30 PM' },
      ],
      finishReason: 'tool-calls',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      steps: [],
    };

    const generateTextFn = createMockGenerateText(mockResult);

    await recordGenerateText(recorder, generateTextFn, {
      model: mockModel('claude-sonnet-4-20250514', 'anthropic'),
      messages: [{ role: 'user', content: 'What is the weather in SF?' }],
    });

    const artifact = recorder.getArtifact();
    const toolCallEvents = artifact.events.filter(e => e.type === 'tool_call');
    const toolResultEvents = artifact.events.filter(e => e.type === 'tool_result');

    expect(toolCallEvents).toHaveLength(2);
    expect(toolCallEvents[0].tool).toBe('get_weather');
    expect(toolCallEvents[0].arguments).toEqual({ city: 'San Francisco' });
    expect(toolCallEvents[1].tool).toBe('get_time');
    expect(toolCallEvents[1].arguments).toEqual({ timezone: 'PST' });

    expect(toolResultEvents).toHaveLength(2);
    expect(toolResultEvents[0].tool).toBe('get_weather');
    expect(toolResultEvents[0].result).toBe('Sunny, 72°F');
    expect(toolResultEvents[1].tool).toBe('get_time');
    expect(toolResultEvents[1].result).toBe('2:30 PM');
  });

  it('normalizes token usage onto the artifact', async () => {
    const mockResult = {
      text: 'Hello!',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: mockModel('gpt-4o', 'openai'),
      prompt: 'Hi',
    });

    const artifact = recorder.getArtifact();
    expect(artifact.tokenUsage).toEqual({ input: 100, output: 50, total: 150 });
  });

  it('sets model info on the artifact', async () => {
    const mockResult = {
      text: 'Hello!',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: mockModel('claude-sonnet-4-20250514', 'anthropic'),
      prompt: 'Hi',
    });

    const artifact = recorder.getArtifact();
    expect(artifact.model).toEqual({ provider: 'anthropic', name: 'claude-sonnet-4-20250514' });
  });

  it('records an error when generateText throws', async () => {
    const error = new Error('API rate limit exceeded');
    error.name = 'RateLimitError';

    const generateTextFn = createFailingGenerateText(error);

    await expect(
      recordGenerateText(recorder, generateTextFn, {
        model: mockModel('gpt-4o', 'openai'),
        prompt: 'Hello',
      })
    ).rejects.toThrow('API rate limit exceeded');

    const artifact = recorder.getArtifact();
    const errorEvents = artifact.events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe('API rate limit exceeded');
    expect(errorEvents[0].errorType).toBe('RateLimitError');
  });

  it('records finishReason in model_response metadata', async () => {
    const mockResult = {
      text: 'I need to search for that...',
      toolCalls: [{ toolName: 'search', toolCallId: 'c1', args: { q: 'test' } }],
      toolResults: [],
      finishReason: 'tool-calls',
      usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: mockModel('gpt-4o', 'openai'),
      prompt: 'Search for something',
    });

    const artifact = recorder.getArtifact();
    const modelResponse = artifact.events.find(e => e.type === 'model_response');
    expect(modelResponse!.metadata).toEqual({ finishReason: 'tool-calls' });
  });

  it('normalizes system + prompt messages correctly', async () => {
    const mockResult = {
      text: 'Hello!',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: undefined,
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: mockModel('gpt-4o', 'openai'),
      system: 'You are a helpful assistant.',
      prompt: 'Hi there',
    });

    const artifact = recorder.getArtifact();
    const modelCall = artifact.events.find(e => e.type === 'model_call');
    expect(modelCall!.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hi there' },
    ]);
  });

  it('handles model specified as a provider/model string', async () => {
    const mockResult = {
      text: 'Response',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: 'anthropic/claude-sonnet-4-20250514',
      prompt: 'Test',
    });

    const artifact = recorder.getArtifact();
    const modelCall = artifact.events.find(e => e.type === 'model_call');
    expect(modelCall!.provider).toBe('anthropic');
    expect(modelCall!.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('handles generateText result with no usage data', async () => {
    const mockResult = {
      text: 'Hello',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: undefined,
      steps: [],
    };

    await recordGenerateText(recorder, createMockGenerateText(mockResult), {
      model: mockModel('gpt-4o', 'openai'),
      prompt: 'Hi',
    });

    const artifact = recorder.getArtifact();
    const modelResponse = artifact.events.find(e => e.type === 'model_response');
    expect(modelResponse!.tokenUsage).toBeUndefined();
    // Artifact-level tokenUsage should not be populated
    expect(artifact.tokenUsage).toBeUndefined();
  });
});
