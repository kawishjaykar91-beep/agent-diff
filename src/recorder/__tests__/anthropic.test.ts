import { describe, it, expect } from 'vitest';
import { AgentRecorder } from '../index.js';
import { wrapAnthropic } from '../anthropic.js';
import { Anthropic } from '@anthropic-ai/sdk';

describe('Anthropic Recorder Adapter', () => {
  it('records a successful model call and response', async () => {
    const recorder = new AgentRecorder({ name: 'test' });
    const client = new Anthropic({ apiKey: 'fake' });
    
    // Mock the SDK
    client.messages.create = async () => ({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-opus-20240229',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [{ type: 'text', text: 'Hello from Claude' }],
      usage: { input_tokens: 10, output_tokens: 5 }
    }) as any;

    const wrapped = wrapAnthropic(client, recorder);

    await wrapped.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }]
    });

    recorder.endRun();
    const artifact = recorder.getArtifact();

    expect(artifact.events).toHaveLength(4); // start, call, response, end
    expect(artifact.events[1].type).toBe('model_call');
    expect(artifact.events[2].type).toBe('model_response');
    expect((artifact.events[2] as any).response).toBe('Hello from Claude');
    expect((artifact.events[2] as any).tokenUsage?.total).toBe(15);
  });

  it('records tool calls correctly', async () => {
    const recorder = new AgentRecorder({ name: 'test' });
    const client = new Anthropic({ apiKey: 'fake' });
    
    client.messages.create = async () => ({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-opus-20240229',
      stop_reason: 'tool_use',
      stop_sequence: null,
      content: [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'agentdiff' } }
      ],
      usage: { input_tokens: 10, output_tokens: 20 }
    }) as any;

    const wrapped = wrapAnthropic(client, recorder);

    await wrapped.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Search agentdiff' }]
    });

    recorder.endRun();
    const artifact = recorder.getArtifact();

    expect(artifact.events).toHaveLength(5); // start, call, response, tool_call, end
    const toolCallEvent = artifact.events.find(e => e.type === 'tool_call') as any;
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent.tool).toBe('search');
    expect(toolCallEvent.arguments.q).toBe('agentdiff');
  });
});
