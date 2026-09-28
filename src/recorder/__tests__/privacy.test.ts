import { describe, it, expect } from 'vitest';
import { AgentRecorder } from '../index.js';
import { wrapOpenAI } from '../openai.js';

describe('Privacy and Security Boundaries', () => {
  it('does not serialize API keys or authorization headers', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    
    // Create a fake OpenAI client containing sensitive info
    const fakeClient = {
      apiKey: 'sk-secret-12345',
      defaultHeaders: { 'Authorization': 'Bearer sk-secret-12345' },
      chat: {
        completions: {
          create: async (body: any) => {
            return {
              choices: [{ message: { role: 'assistant', content: 'hello' } }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
            };
          }
        }
      }
    };

    const wrapped = wrapOpenAI(fakeClient as any, recorder);
    
    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }]
    });

    recorder.endRun('success');
    
    const artifact = recorder.getArtifact();
    const artifactStr = JSON.stringify(artifact);

    expect(artifactStr).not.toContain('sk-secret-12345');
    expect(artifactStr).not.toContain('Authorization');
    
    // Ensure the event contains the message content but not the headers
    const callEvent = artifact.events.find(e => e.type === 'model_call');
    expect(callEvent).toBeDefined();
    expect(callEvent?.provider).toBe('openai');
    expect((callEvent as any).messages[0].content).toBe('hi');
  });
});
