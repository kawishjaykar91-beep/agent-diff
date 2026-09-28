import { describe, it, expect, vi } from 'vitest';
import { AgentRecorder } from '../index.js';
import { wrapOpenAI } from '../openai.js';
import { OpenAI } from 'openai';

// Mock OpenAI client
function createMockOpenAI(mockResponse: any, shouldThrow = false) {
  const mockCreate = vi.fn().mockImplementation(async () => {
    if (shouldThrow) {
      throw new Error('API Error');
    }
    return mockResponse;
  });

  return {
    chat: {
      completions: {
        create: mockCreate
      }
    }
  } as unknown as OpenAI;
}

describe('OpenAI Recorder Adapter', () => {
  it('records successful completions without tool calls', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Hello there!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    };
    
    const client = createMockOpenAI(mockResponse);
    const recorder = new AgentRecorder({ name: 'test-agent' });
    const wrapped = wrapOpenAI(client, recorder);

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }]
    });

    const artifact = recorder.getArtifact();
    expect(artifact.events).toHaveLength(3); // agent_start, model_call, model_response
    
    const callEvent = artifact.events[1];
    expect(callEvent.type).toBe('model_call');
    expect(callEvent.model).toBe('gpt-4o');
    expect(callEvent.provider).toBe('openai');
    
    const responseEvent = artifact.events[2];
    expect(responseEvent.type).toBe('model_response');
    expect(responseEvent.response).toBe('Hello there!');
    expect(responseEvent.tokenUsage).toEqual({ input: 10, output: 5, total: 15 });
    
    expect(artifact.tokenUsage).toEqual({ input: 10, output: 5, total: 15 });
    expect(artifact.model).toEqual({ provider: 'openai', name: 'gpt-4o' });
  });

  it('records tool calls properly', async () => {
    const mockResponse = {
      id: 'chatcmpl-456',
      model: 'gpt-4o',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'search_files',
              arguments: '{"query": "test"}'
            }
          }]
        }
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
    };
    
    const client = createMockOpenAI(mockResponse);
    const recorder = new AgentRecorder({ name: 'test-agent' });
    const wrapped = wrapOpenAI(client, recorder);

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Search test' }]
    });

    const artifact = recorder.getArtifact();
    expect(artifact.events).toHaveLength(4); // agent_start, model_call, model_response, tool_call
    
    const toolEvent = artifact.events[3];
    expect(toolEvent.type).toBe('tool_call');
    expect(toolEvent.tool).toBe('search_files');
    expect(toolEvent.arguments).toEqual({ query: 'test' });
  });

  it('records errors', async () => {
    const client = createMockOpenAI(null, true);
    const recorder = new AgentRecorder({ name: 'test-agent' });
    const wrapped = wrapOpenAI(client, recorder);

    await expect(wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: []
    })).rejects.toThrow('API Error');

    const artifact = recorder.getArtifact();
    expect(artifact.events).toHaveLength(3); // agent_start, model_call, error
    
    const errorEvent = artifact.events[2];
    expect(errorEvent.type).toBe('error');
    expect(errorEvent.error).toBe('API Error');
  });
});
