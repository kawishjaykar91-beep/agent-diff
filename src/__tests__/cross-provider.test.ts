import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRecorder } from '../recorder/index.js';
import { wrapOpenAI } from '../recorder/openai.js';
import { wrapAnthropic } from '../recorder/anthropic.js';
import { recordGenerateText } from '../recorder/vercel-ai.js';
import type { RunArtifact } from '../schema.js';

describe('Cross-Provider Recording Compatibility', () => {
  beforeEach(() => {
    delete process.env.AGENTDIFF_REPLAY_FIXTURE;
  });

  it('produces structurally compatible traces for a basic tool-calling workflow', async () => {
    // Conceptual workflow:
    // 1. User: "What's the weather in SF?"
    // 2. Model calls get_weather({ city: "SF" })
    // 3. Tool returns "Sunny, 72F"
    // 4. Model says "It is Sunny and 72F in SF."

    // --- 1. OPENAI MOCK ---
    const mockOpenAIClient = {
      chat: {
        completions: {
          create: async (opts: any) => {
            // Check if this is the first call (triggering tool) or second (returning text)
            if (opts.messages.length === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    tool_calls: [{
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"city":"SF"}' }
                    }]
                  }
                }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
              };
            } else {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: 'It is Sunny and 72F in SF.'
                  }
                }],
                usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
              };
            }
          }
        }
      }
    };
    
    // wrapOpenAI patches client.chat.completions.create
    const openaiRecorder = new AgentRecorder({ name: 'openai' });
    const wrappedOpenAI = wrapOpenAI(mockOpenAIClient as any, openaiRecorder);
    
    // Simulate OpenAI execution
    const oaiRes1 = await wrappedOpenAI.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: "What's the weather in SF?" }]
    });
    
    // Developer manually records tool result (since OpenAI is unmanaged)
    openaiRecorder.addEvent({
      type: 'tool_result',
      tool: 'get_weather',
      result: 'Sunny, 72F'
    });

    await wrappedOpenAI.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: "What's the weather in SF?" },
        oaiRes1.choices[0].message,
        { role: 'tool', tool_call_id: 'call_1', content: 'Sunny, 72F' }
      ]
    });
    
    const openaiArtifact = openaiRecorder.getArtifact();

    // --- 2. ANTHROPIC MOCK ---
    const mockAnthropicClient = {
      messages: {
        create: async (opts: any) => {
          if (opts.messages.length === 1) {
            return {
              content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }],
              usage: { input_tokens: 10, output_tokens: 5 }
            };
          } else {
            return {
              content: [{ type: 'text', text: 'It is Sunny and 72F in SF.' }],
              usage: { input_tokens: 20, output_tokens: 10 }
            };
          }
        }
      }
    };

    const anthropicRecorder = new AgentRecorder({ name: 'anthropic' });
    const wrappedAnthropic = wrapAnthropic(mockAnthropicClient as any, anthropicRecorder);
    
    // Simulate Anthropic execution
    const antRes1 = await wrappedAnthropic.messages.create({
      model: 'claude-3',
      max_tokens: 100,
      messages: [{ role: 'user', content: "What's the weather in SF?" }]
    });

    anthropicRecorder.addEvent({
      type: 'tool_result',
      tool: 'get_weather',
      result: 'Sunny, 72F'
    });

    await wrappedAnthropic.messages.create({
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        { role: 'user', content: "What's the weather in SF?" },
        { role: 'assistant', content: antRes1.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Sunny, 72F' }] }
      ]
    });

    const anthropicArtifact = anthropicRecorder.getArtifact();

    // --- 3. VERCEL AI SDK MOCK ---
    const mockVercelGenerateText = async (opts: any) => {
      // Vercel handles the multi-step loop internally and returns a single result with steps
      return {
        text: 'It is Sunny and 72F in SF.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
        steps: [
          {
            text: '',
            toolCalls: [{ toolCallId: 'call_1', toolName: 'get_weather', args: { city: 'SF' } }],
            toolResults: [{ toolCallId: 'call_1', toolName: 'get_weather', result: 'Sunny, 72F' }],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
          },
          {
            text: 'It is Sunny and 72F in SF.',
            toolCalls: [],
            toolResults: [],
            usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 }
          }
        ]
      };
    };

    const vercelRecorder = new AgentRecorder({ name: 'vercel' });
    await recordGenerateText(vercelRecorder, mockVercelGenerateText, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: "What's the weather in SF?"
    });

    const vercelArtifact = vercelRecorder.getArtifact();

    // --- ASSERTIONS ---
    
    // We expect the sequence of semantic events to be identical for all three:
    // agent_start -> model_call -> model_response -> tool_call -> tool_result -> model_call -> model_response -> agent_end
    // (Note: Vercel might slightly interleave tool_call / tool_result depending on how the step is processed, but it shouldn't matter)
    
    const getEventTypes = (artifact: RunArtifact) => artifact.events.map(e => e.type);

    const expectedSequence = [
      'model_call',
      'model_response',
      'tool_call',
      'tool_result',
      'model_call',
      'model_response'
    ];

    // Some tools might leave agent_start at the beginning, but let's check the core model/tool events
    const extractCore = (types: string[]) => types.filter(t => t !== 'agent_start' && t !== 'agent_end');

    expect(extractCore(getEventTypes(openaiArtifact))).toEqual(expectedSequence);
    expect(extractCore(getEventTypes(anthropicArtifact))).toEqual(expectedSequence);
    expect(extractCore(getEventTypes(vercelArtifact))).toEqual(expectedSequence);

    // Verify token usage accumulation is conceptually identical
    // OpenAI total = 15 + 30 = 45
    expect(openaiArtifact.tokenUsage?.total).toBe(45);
    // Anthropic total = 15 + 30 = 45
    expect(anthropicArtifact.tokenUsage?.total).toBe(45);
    // Vercel total = 45 (from final aggregate usage)
    expect(vercelArtifact.tokenUsage?.total).toBe(45);

    // Verify tool calls match structure
    const getToolCall = (a: RunArtifact) => a.events.find(e => e.type === 'tool_call');
    expect(getToolCall(openaiArtifact)?.tool).toBe('get_weather');
    expect(getToolCall(anthropicArtifact)?.tool).toBe('get_weather');
    expect(getToolCall(vercelArtifact)?.tool).toBe('get_weather');

    expect(getToolCall(openaiArtifact)?.arguments).toEqual({ city: 'SF' });
    expect(getToolCall(anthropicArtifact)?.arguments).toEqual({ city: 'SF' });
    expect(getToolCall(vercelArtifact)?.arguments).toEqual({ city: 'SF' });
  });
});
