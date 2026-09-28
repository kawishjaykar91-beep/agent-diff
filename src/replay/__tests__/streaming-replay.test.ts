import { describe, it, expect } from 'vitest';
import { AgentReplay } from '../index.js';
import { wrapOpenAIForReplay } from '../openai.js';
import { wrapAnthropicForReplay } from '../anthropic.js';
import type { RunArtifact } from '../../schema.js';

const mockFixture: RunArtifact = {
  version: '0.1',
  runId: 'test-123',
  timestamp: new Date().toISOString(),
  agent: { name: 'test' },
  events: [
    {
      id: 'evt-1',
      type: 'model_call',
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }]
    },
    {
      id: 'evt-2',
      type: 'model_response',
      response: 'Hello streaming world!',
      tokenUsage: { input: 10, output: 20, total: 30 }
    },
    {
      id: 'evt-3',
      type: 'model_call',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'tool time' }]
    },
    {
      id: 'evt-4',
      type: 'model_response',
      response: 'Sure',
      tokenUsage: { input: 5, output: 5, total: 10 }
    },
    {
      id: 'evt-5',
      type: 'tool_call',
      tool: 'get_weather',
      arguments: { location: 'SF' }
    }
  ]
};

describe('Streaming Replay', () => {
  it('replays an OpenAI stream deterministically', async () => {
    const replay = new AgentReplay(mockFixture);
    const fakeClient = { chat: { completions: { create: async () => {} } } };
    const wrapped = wrapOpenAIForReplay(fakeClient as any, replay);
    
    const stream = await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    }) as unknown as AsyncIterable<any>;

    let result = '';
    let hasUsage = false;
    for await (const chunk of stream) {
      if (chunk.choices?.[0]?.delta?.content) {
         result += chunk.choices[0].delta.content;
      }
      if (chunk.usage) {
         expect(chunk.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
         hasUsage = true;
      }
    }
    
    expect(result).toBe('Hello streaming world!');
    expect(hasUsage).toBe(true);
  });

  it('replays an Anthropic stream deterministically with tool calls', async () => {
    const replay = new AgentReplay(mockFixture);
    const fakeClient = { messages: { create: async () => {} } };
    const wrapped = wrapAnthropicForReplay(fakeClient as any, replay);
    
    // We must advance the replay to the second call by consuming the first one
    replay.consumeModelCall('gpt-4o', [{ role: 'user', content: 'hi' }]);
    
    const stream = await wrapped.messages.create({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'tool time' }],
      stream: true
    }) as unknown as AsyncIterable<any>;

    let text = '';
    let toolName = '';
    let toolArgs = '';
    
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
         if (chunk.delta.type === 'text_delta') {
            text += chunk.delta.text;
         } else if (chunk.delta.type === 'input_json_delta') {
            toolArgs += chunk.delta.partial_json;
         }
      } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
         toolName = chunk.content_block.name;
      }
    }
    
    expect(text).toBe('Sure');
    expect(toolName).toBe('get_weather');
    expect(JSON.parse(toolArgs)).toEqual({ location: 'SF' });
  });
});
