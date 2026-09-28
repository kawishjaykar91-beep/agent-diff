import { describe, it, expect, vi } from 'vitest';
import { AgentReplay, ReplayMismatchError } from '../index.js';
import { wrapOpenAIForReplay } from '../openai.js';
import { OpenAI } from 'openai';
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
        id: 'e2', type: 'model_call', model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }] 
      },
      { 
        id: 'e3', type: 'model_response', response: 'Hi there', 
        tokenUsage: { input: 10, output: 5, total: 15 } 
      },
      { 
        id: 'e4', type: 'model_call', model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Search' }] 
      },
      { id: 'e5', type: 'model_response', response: '' },
      { id: 'e6', type: 'tool_call', tool: 'search_files', arguments: { q: 'test' } },
      { id: 'e7', type: 'agent_end' }
    ]
  };
}

describe('OpenAI Replay Adapter', () => {
  it('replays a successful match and synthesizes the exact response', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    
    // We provide a real but completely unauthenticated client.
    // Replay should intercept before it ever hits the network.
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }]
    });

    expect(response.choices[0].message.content).toBe('Hi there');
    expect(response.usage?.total_tokens).toBe(15);
  });

  it('replays tool calls correctly', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    // Consume first call
    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }]
    });

    // Consume second call which has a tool call in the fixture
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Search' }]
    });

    expect(response.choices[0].message.content).toBeNull(); // synthetic content is null or '' when tool calls exist
    expect(response.choices[0].message.tool_calls).toHaveLength(1);
    expect(response.choices[0].message.tool_calls![0].function.name).toBe('search_files');
    expect(response.choices[0].message.tool_calls![0].function.arguments).toBe('{"q":"test"}');
  });

  it('fails safely when the model mismatches', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    await expect(client.chat.completions.create({
      model: 'gpt-3.5-turbo', // Wrong model
      messages: [{ role: 'user', content: 'Hello' }]
    })).rejects.toThrow(ReplayMismatchError);
  });

  it('fails safely when the request sequence diverges', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    await expect(client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'Wrong role' }] // Mismatch
    })).rejects.toThrow(ReplayMismatchError);
  });

  it('fails when agent makes too many calls', async () => {
    const fixture = createFixture();
    // Remove the second call from the fixture to simulate a short run
    fixture.events.splice(3, 3);
    
    const replay = new AgentReplay(fixture);
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    // First call succeeds
    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }]
    });

    // Second call should fail because fixture is out of events
    await expect(client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Search' }]
    })).rejects.toThrow(/Unexpected extra model call/);
  });
  
  it('generates a new valid artifact trace', async () => {
    const fixture = createFixture();
    const replay = new AgentReplay(fixture);
    const client = wrapOpenAIForReplay(new OpenAI({ apiKey: 'fake' }), replay);

    await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }]
    });

    replay.getRecorder().endRun('success');
    const newArtifact = replay.getRecorder().getArtifact();
    
    // new artifact should have 3 events: start, call, response, end
    expect(newArtifact.events).toHaveLength(4);
    expect(newArtifact.events[1].type).toBe('model_call');
    expect(newArtifact.events[2].type).toBe('model_response');
    expect((newArtifact.events[2] as any).response).toBe('Hi there');
  });
});
