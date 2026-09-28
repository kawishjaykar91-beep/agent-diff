/**
 * Vercel AI SDK + AgentDiff — Offline Recording Example
 *
 * This demonstrates how to use AgentDiff with the Vercel AI SDK's
 * `generateText` function. It uses a mock model so it works
 * completely offline without API keys.
 *
 * Usage:
 *   npx tsx examples/vercel-ai/agent.ts
 *
 * With a real provider (requires API key):
 *   import { openai } from '@ai-sdk/openai';
 *   const result = await recordGenerateText(recorder, generateText, {
 *     model: openai('gpt-4o'),
 *     prompt: 'What is the capital of France?',
 *   });
 */

import { AgentRecorder, recordGenerateText } from '../../src/index.js';

// ── Mock generateText for offline demo ─────────────────────────────────────
//
// In a real project, you would import { generateText } from 'ai' and pass
// a real provider model. Here we simulate the SDK's return shape.

async function mockGenerateText(options: any): Promise<any> {
  const prompt = options.prompt || options.messages?.[0]?.content || '';
  
  // Simulate tool usage if the prompt mentions weather
  if (prompt.toLowerCase().includes('weather')) {
    return {
      text: '',
      toolCalls: [
        { toolName: 'get_weather', toolCallId: 'call_1', args: { city: 'San Francisco' } },
      ],
      toolResults: [
        { toolName: 'get_weather', toolCallId: 'call_1', result: 'Sunny, 72°F' },
      ],
      finishReason: 'tool-calls',
      usage: { promptTokens: 45, completionTokens: 20, totalTokens: 65 },
      steps: [],
    };
  }

  return {
    text: 'The capital of France is Paris.',
    toolCalls: [],
    toolResults: [],
    finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    steps: [],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('--- Vercel AI SDK + AgentDiff Demo ---\n');

  // 1. Create a recorder
  const recorder = new AgentRecorder(
    { name: 'vercel-demo-agent', version: '1.0.0' },
    'What is the capital of France?'
  );

  // 2. Use recordGenerateText instead of calling generateText directly
  const result = await recordGenerateText(recorder, mockGenerateText, {
    model: { modelId: 'gpt-4o', provider: 'openai' },
    prompt: 'What is the capital of France?',
  });

  console.log(`Model response: ${result.text}`);
  console.log(`Finish reason:  ${result.finishReason}`);
  console.log(`Tokens used:    ${result.usage.totalTokens}`);

  // 3. Save the artifact
  await recorder.save();

  console.log('\nArtifact saved to .agentdiff/runs/');
  console.log('\nRecorded events:');
  for (const evt of recorder.getArtifact().events) {
    console.log(`  [${evt.type}] ${evt.model || evt.tool || evt.response || evt.status || ''}`);
  }

  console.log('\n--- Done ---');
}

main().catch(console.error);
