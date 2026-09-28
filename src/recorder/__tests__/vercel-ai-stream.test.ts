import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRecorder } from '../../recorder/index.js';
import { recordStreamText } from '../../recorder/vercel-ai.js';
import { simulateReadableStream } from 'ai';

function mockModel(modelId: string, provider: string) {
  return { modelId, provider };
}

// ── Mock streamText implementations ────────────────────────────────────────

function createMockStreamText(resultEvent: any) {
  return (options: any) => {
    // Simulate Vercel AI calling onFinish in the background
    if (options.onFinish) {
      setTimeout(() => {
        options.onFinish(resultEvent);
      }, 10);
    }
    
    return {
      text: Promise.resolve(resultEvent.text || ''),
      usage: Promise.resolve(resultEvent.usage),
      textStream: simulateReadableStream({
        chunks: [
          { type: 'text-delta', textDelta: resultEvent.text || '' },
        ]
      })
    };
  };
}

function createFailingStreamText(error: Error) {
  return (options: any) => {
    throw error;
  };
}

describe('Vercel AI SDK — recordStreamText', () => {
  let recorder: AgentRecorder;

  beforeEach(() => {
    delete process.env.AGENTDIFF_REPLAY_FIXTURE;
    recorder = new AgentRecorder({ name: 'vercel-test-agent' }, 'Test task');
  });

  it('records a basic streamText call with text response', async () => {
    const mockEvent = {
      text: 'Paris is the capital.',
      toolCalls: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      steps: [],
    };

    const streamTextFn = createMockStreamText(mockEvent);

    const result = await recordStreamText(recorder, streamTextFn, {
      model: mockModel('gpt-4o', 'openai'),
      prompt: 'What is the capital?',
    });

    // Verify events were recorded after stream finishes
    await new Promise(r => setTimeout(r, 20));

    const artifact = recorder.getArtifact();
    const events = artifact.events;

    const modelCall = events.find(e => e.type === 'model_call');
    expect(modelCall).toBeDefined();
    expect(modelCall!.provider).toBe('openai');
    expect(modelCall!.model).toBe('gpt-4o');

    const modelResponse = events.find(e => e.type === 'model_response');
    expect(modelResponse).toBeDefined();
    expect(modelResponse!.response).toBe('Paris is the capital.');
    expect(modelResponse!.tokenUsage).toEqual({ input: 10, output: 5, total: 15 });
  });

  it('records tool calls from streamText onFinish', async () => {
    const mockEvent = {
      text: '',
      toolCalls: [
        { toolName: 'get_weather', args: { city: 'SF' } },
      ],
      toolResults: [
        { toolName: 'get_weather', result: 'Sunny' },
      ],
      finishReason: 'tool-calls',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      steps: [],
    };

    await recordStreamText(recorder, createMockStreamText(mockEvent), {
      model: mockModel('claude-3', 'anthropic'),
      prompt: 'Weather?',
    });

    await new Promise(r => setTimeout(r, 20));

    const artifact = recorder.getArtifact();
    const toolCallEvents = artifact.events.filter(e => e.type === 'tool_call');
    
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0].tool).toBe('get_weather');
    expect(toolCallEvents[0].arguments).toEqual({ city: 'SF' });
  });

  it('records an error when streamText throws synchronously', async () => {
    const error = new Error('Sync throw');
    error.name = 'SyncError';

    const streamTextFn = createFailingStreamText(error);

    await expect(
      recordStreamText(recorder, streamTextFn, {
        model: mockModel('gpt-4o', 'openai'),
        prompt: 'Hello',
      })
    ).rejects.toThrow('Sync throw');

    const artifact = recorder.getArtifact();
    const errorEvents = artifact.events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe('Sync throw');
  });
});
