import { describe, it, expect } from 'vitest';
import { AgentReplay, ReplayMismatchError } from '../index.js';
import { wrapAnthropicForReplay } from '../anthropic.js';
import { Anthropic } from '@anthropic-ai/sdk';
import type { RunArtifact } from '../../schema.js';

function createFixture(): RunArtifact {
  return {
    version: '0.1',
    runId: 'fixture-run',
    timestamp: '2026-01-01T00:00:00Z',
    agent: { name: 'test-agent' },
    events: [
      { id: 'e1', type: 'agent_start' },
      { 
        id: 'e2', type: 'model_call', model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }] 
      },
      { 
        id: 'e3', type: 'model_response', response: 'Hi there', 
        tokenUsage: { input: 10, output: 5, total: 15 } 
      },
      { 
        id: 'e4', type: 'model_call', model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Search' }] 
      },
      { id: 'e5', type: 'model_response', response: 'Searching...' },
      { id: 'e6', type: 'tool_call', tool: 'search_files', arguments: { q: 'test' } },
      { id: 'e7', type: 'agent_end' }
    ]
  };
}

describe('Anthropic Replay Adapter', () => {
  it('replays a successful match and synthesizes the exact response', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    
    const client = wrapAnthropicForReplay(new Anthropic({ apiKey: 'fake' }), replay);

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    });

    expect(response.content[0].type).toBe('text');
    expect((response.content[0] as any).text).toBe('Hi there');
    expect(response.usage?.input_tokens).toBe(10);
  });

  it('replays tool calls correctly', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapAnthropicForReplay(new Anthropic({ apiKey: 'fake' }), replay);

    // Consume first call
    await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    });

    // Consume second call which has a tool call in the fixture
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Search' }]
    });

    expect(response.stop_reason).toBe('tool_use');
    const toolUse = response.content.find(c => c.type === 'tool_use') as any;
    expect(toolUse).toBeDefined();
    expect(toolUse.name).toBe('search_files');
    expect(toolUse.input.q).toBe('test');
  });

  it('fails safely when the model mismatches', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapAnthropicForReplay(new Anthropic({ apiKey: 'fake' }), replay);

    await expect(client.messages.create({
      model: 'claude-3-opus-20240229', // Wrong model
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    })).rejects.toThrow(ReplayMismatchError);
  });
});
