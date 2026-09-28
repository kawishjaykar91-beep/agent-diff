import { OpenAI } from 'openai';
import { AgentRecorder, wrapOpenAI } from '../src/index.js';

const isMocked = !process.env.OPENAI_API_KEY;

async function runAgent(
  runName: string,
  model: string,
  input: string,
  mockResponse: string
): Promise<string> {
  let client = new OpenAI(isMocked ? { apiKey: 'dummy-key' } : undefined);
  
  if (isMocked) {
    client.chat.completions.create = async () => ({
      id: `mock-${Date.now()}`,
      model: model,
      object: 'chat.completion',
      created: Date.now(),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: mockResponse },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: input.length,
        completion_tokens: mockResponse.length,
        total_tokens: input.length + mockResponse.length
      }
    }) as any;
  }

  const recorder = new AgentRecorder({ name: 'demo-bot', version: '1.0.0' }, input);
  const wrappedClient = wrapOpenAI(client, recorder);

  console.log(`[${runName}] Calling ${model} with input: "${input}"`);
  const response = await wrappedClient.chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: input }]
  });

  recorder.endRun('success');
  const filename = `examples/${runName}.agentrun`;
  await recorder.save(filename);
  console.log(`[${runName}] Saved artifact to ${filename}`);
  return filename;
}

async function main() {
  console.log(`Running with ${isMocked ? 'mocked' : 'live'} OpenAI client...\n`);
  
  // Run A: Simple query
  const fileA = await runAgent(
    'demo-run-a',
    'gpt-3.5-turbo',
    'What is the capital of France?',
    'The capital of France is Paris.'
  );

  console.log('');

  // Run B: Changed model and slightly different input
  const fileB = await runAgent(
    'demo-run-b',
    'gpt-4o',
    'What is the capital of France, and what is its population?',
    'The capital of France is Paris. Its population is approximately 2.1 million.'
  );

  console.log(`\nNow you can compare them with:`);
  console.log(`npx agentdiff diff ${fileA} ${fileB}`);
}

main().catch(console.error);
