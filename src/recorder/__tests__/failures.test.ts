import { describe, it, expect } from 'vitest';
import { AgentRecorder } from '../index.js';
import { wrapOpenAI } from '../openai.js';

describe('Recorder Failures and Interruptions', () => {
  it('gracefully handles a crashed model call', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("Rate limit exceeded");
          }
        }
      }
    };

    const wrapped = wrapOpenAI(fakeClient as any, recorder);
    
    await expect(wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toThrow("Rate limit exceeded");

    const artifact = recorder.getArtifact();
    
    // It should have recorded the model_call before crashing
    expect(artifact.events.some(e => e.type === 'model_call')).toBe(true);
    // It should have recorded the error
    const errorEvent = artifact.events.find(e => e.type === 'error') as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toBe("Rate limit exceeded");
  });

  it('handles mid-run save by marking it incomplete', async () => {
    const recorder = new AgentRecorder({ name: 'test-agent' });
    recorder.addEvent({ type: 'tool_call', tool: 'search' });
    
    // Save without calling endRun
    // We mock fs in a real environment, but here we just check the internal state effect of save()
    // Wait, save() writes to disk. Let's just call endRun('incomplete') manually to simulate what save() does internally, or override save filepath
    await recorder.save('scratch/temp-failure-test.agentrun');
    
    const artifact = recorder.getArtifact();
    expect(artifact.result?.status).toBe('incomplete');
    expect(artifact.events[artifact.events.length - 1].type).toBe('agent_end');
    expect((artifact.events[artifact.events.length - 1] as any).status).toBe('incomplete');
  });
});
