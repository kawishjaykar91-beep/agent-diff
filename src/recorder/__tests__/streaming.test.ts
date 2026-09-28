import { describe, it, expect } from 'vitest';
import { AgentRecorder } from '../index.js';
import { wrapOpenAI } from '../openai.js';
import { wrapAnthropic } from '../anthropic.js';

describe('Streaming Recorder', () => {
  it('records an OpenAI stream correctly', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    
    const fakeClient = {
      chat: {
        completions: {
          create: async (body: any, options: any) => {
            async function* mockStream() {
              yield { choices: [{ delta: { content: 'Hello' } }] };
              yield { choices: [{ delta: { content: ' world' } }] };
              yield { choices: [{ delta: { content: '!' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
            }
            return mockStream();
          }
        }
      }
    };

    const wrapped = wrapOpenAI(fakeClient as any, recorder);
    
    const stream = await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    }) as unknown as AsyncIterable<any>;

    let result = '';
    for await (const chunk of stream) {
      if (chunk.choices[0].delta.content) {
         result += chunk.choices[0].delta.content;
      }
    }
    
    expect(result).toBe('Hello world!');

    const artifact = recorder.getArtifact();
    const responseEvent = artifact.events.find(e => e.type === 'model_response') as any;
    
    expect(responseEvent).toBeDefined();
    expect(responseEvent.response).toBe('Hello world!');
    expect(responseEvent.tokenUsage).toEqual({ input: 10, output: 5, total: 15 });
  });

  it('records an Anthropic stream correctly with tool calls', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    
    const fakeClient = {
      messages: {
        create: async () => {
          async function* mockStream() {
            yield { type: 'message_start', message: { usage: { input_tokens: 20 } } };
            yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure' } };
            yield { type: 'content_block_stop', index: 0 };
            
            yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'search' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q"' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"test"}' } };
            yield { type: 'content_block_stop', index: 1 };
            
            yield { type: 'message_delta', usage: { output_tokens: 30 } };
            yield { type: 'message_stop' };
          }
          return mockStream();
        }
      }
    };

    const wrapped = wrapAnthropic(fakeClient as any, recorder);
    
    const stream = await wrapped.messages.create({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    }) as unknown as AsyncIterable<any>;

    for await (const _ of stream) { /* consume */ }

    const artifact = recorder.getArtifact();
    
    const responseEvent = artifact.events.find(e => e.type === 'model_response') as any;
    expect(responseEvent).toBeDefined();
    expect(responseEvent.response).toBe('Sure');
    expect(responseEvent.tokenUsage).toEqual({ input: 20, output: 30, total: 50 });

    const toolCallEvent = artifact.events.find(e => e.type === 'tool_call') as any;
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent.tool).toBe('search');
    expect(toolCallEvent.arguments).toEqual({ q: 'test' });
  });

  it('records a failed stream gracefully', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            async function* mockStream() {
              yield { choices: [{ delta: { content: 'Partial text' } }] };
              throw new Error("Stream connection lost");
            }
            return mockStream();
          }
        }
      }
    };

    const wrapped = wrapOpenAI(fakeClient as any, recorder);
    
    const stream = await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    }) as unknown as AsyncIterable<any>;

    await expect(async () => {
       for await (const _ of stream) { /* consume */ }
    }).rejects.toThrow("Stream connection lost");

    const artifact = recorder.getArtifact();
    
    // It should have recorded the partial response up to the error
    const responseEvent = artifact.events.find(e => e.type === 'model_response') as any;
    expect(responseEvent).toBeDefined();
    expect(responseEvent.response).toBe('Partial text');
    
    // It should also have an error event
    const errorEvent = artifact.events.find(e => e.type === 'error') as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toBe('Stream connection lost');
  });
});
