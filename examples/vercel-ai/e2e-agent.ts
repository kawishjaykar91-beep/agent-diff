import { AgentRecorder, recordStreamText } from '../../src/index.js';
import { simulateReadableStream } from 'ai';

// --- Mock streamText ---
const mockStreamText = async (options: any) => {
  if (process.env.AGENTDIFF_REPLAY_FIXTURE) {
    throw new Error('Network hit! Replay failed to intercept streamText!');
  }
  const stepsData = [
    {
      text: '',
      toolCalls: [{ toolCallId: 'call_1', toolName: 'get_weather', args: { city: 'San Francisco' } }],
      toolResults: [{ toolCallId: 'call_1', toolName: 'get_weather', result: '72°F and sunny' }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'tool-calls'
    },
    {
      text: 'The weather in San Francisco is 72°F and sunny.',
      toolCalls: [],
      toolResults: [],
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      finishReason: 'stop'
    }
  ];

  setTimeout(() => {
    options.onFinish?.({
      text: 'The weather in San Francisco is 72°F and sunny.',
      toolCalls: [],
      toolResults: [],
      usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
      finishReason: 'stop',
      steps: stepsData,
    });
  }, 100);

  return {
    text: Promise.resolve('The weather in San Francisco is 72°F and sunny.'),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    usage: Promise.resolve({ promptTokens: 30, completionTokens: 15, totalTokens: 45 }),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([
      {
        text: '',
        toolCalls: [{ toolCallId: 'call_1', toolName: 'get_weather', args: { city: 'San Francisco' } }],
        toolResults: [{ toolCallId: 'call_1', toolName: 'get_weather', result: '72°F and sunny' }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'tool-calls'
      },
      {
        text: 'The weather in San Francisco is 72°F and sunny.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        finishReason: 'stop'
      }
    ]),
    get textStream() {
      return simulateReadableStream({
        chunks: [
          'The weather ',
          'in San Francisco is 72°F and sunny.'
        ]
      });
    }
  };
};

async function main() {
  console.log('--- Vercel AI SDK E2E Recording Demo ---');

  const recorder = new AgentRecorder(
    { name: 'vercel-e2e-agent', version: '1.0.0' },
    'What is the weather in SF?'
  );

  try {
    const result = await recordStreamText(recorder, mockStreamText, {
      model: { modelId: 'gpt-4o', provider: 'openai' },
      prompt: 'What is the weather in SF?',
      tools: {
        get_weather: {
          description: 'Get the weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        }
      },
      maxSteps: 2,
    });

    console.log('\nAgent Final Response (Streaming):');
    for await (const chunk of result.textStream) {
       process.stdout.write(chunk);
    }
    console.log();

    await new Promise(r => setTimeout(r, 200)); // wait for onFinish to fire
    await recorder.save();
    console.log('\nArtifact saved successfully.');
    
    // Optional: Print semantic trace
    console.log('\nSemantic Trace:');
    const artifact = recorder.getArtifact();
    for (const evt of artifact.events) {
      console.log(`  [${evt.type}] ${evt.tool || evt.model || evt.response || evt.status || ''}`);
    }

  } catch (err: any) {
    console.error('Agent failed:', err);
  }
}

main().catch(console.error);
