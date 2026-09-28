/**
 * Vercel AI SDK + AgentDiff — Streaming Recording Example
 *
 * This demonstrates how to use AgentDiff with the Vercel AI SDK's
 * `streamText` function. It works completely offline without API keys
 * by mocking the SDK response.
 *
 * Usage:
 *   npx tsx examples/vercel-ai/streaming-agent.ts
 */

import { AgentRecorder, recordStreamText } from '../../src/index.js';
import { simulateReadableStream } from 'ai';

// ── Mock streamText for offline demo ───────────────────────────────────────
//
// In a real project, you would import { streamText } from 'ai' and pass
// a real provider model.

function mockStreamText(options: any): any {
  const resultEvent = {
    text: 'AgentDiff is tracking this stream!',
    toolCalls: [],
    toolResults: [],
    finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
    steps: [],
  };

  // Simulate Vercel AI calling onFinish in the background when the stream completes
  if (options.onFinish) {
    setTimeout(() => {
      options.onFinish(resultEvent);
    }, 50);
  }

  // Simulate the standard return object from `streamText`
  return {
    textStream: simulateReadableStream({
      chunks: [
        'AgentDiff ',
        'is tracking ',
        'this stream!'
      ],
      delayInMs: 10,
    }),
    text: Promise.resolve(resultEvent.text),
    usage: Promise.resolve(resultEvent.usage),
    finishReason: Promise.resolve(resultEvent.finishReason),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('--- Vercel AI SDK Streaming Demo ---\n');

  // 1. Create a recorder
  const recorder = new AgentRecorder(
    { name: 'vercel-streaming-agent', version: '1.0.0' },
    'Tell me a secret.'
  );

  // 2. Wrap `streamText` using `recordStreamText`
  // This behaves identically to streamText, but hooks into `onFinish` in the background
  const result = await recordStreamText(recorder, mockStreamText, {
    model: { modelId: 'gpt-4o', provider: 'openai' },
    prompt: 'Tell me a secret.',
  });

  // 3. Consume the stream exactly as you normally would
  process.stdout.write('Streaming response: ');
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');

  // Wait a brief moment to ensure `onFinish` background callback fires
  // (In real apps, `onFinish` is guaranteed to fire after the stream is fully consumed)
  await new Promise(r => setTimeout(r, 100));

  // 4. Save the artifact
  await recorder.save();

  console.log('Artifact saved to .agentdiff/runs/');
  console.log('\nRecorded events:');
  for (const evt of recorder.getArtifact().events) {
    console.log(`  [${evt.type}] ${evt.model || evt.tool || evt.response || evt.status || ''}`);
  }

  console.log('\n--- Done ---');
}

main().catch(console.error);
