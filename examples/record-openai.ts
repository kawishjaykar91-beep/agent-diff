import { OpenAI } from 'openai';
import { AgentRecorder, wrapOpenAI } from '../src/index.js';

// This example expects the OPENAI_API_KEY environment variable to be set.
// If it isn't set, we'll mock the client so the example still works.
const isMocked = !process.env.OPENAI_API_KEY;

async function main() {
  console.log(`Running with ${isMocked ? 'mocked' : 'live'} OpenAI client...`);
  
  let client = new OpenAI(isMocked ? { apiKey: 'dummy-key' } : undefined);
  
  if (isMocked) {
    client.chat.completions.create = async () => ({
      id: 'mock-123',
      model: 'gpt-4o',
      object: 'chat.completion',
      created: Date.now(),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'The capital of France is Paris.'
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 7,
        total_tokens: 22
      }
    }) as any;
  }

  // 1. Initialize the recorder
  const recorder = new AgentRecorder(
    { name: 'example-bot', version: '1.0.0' },
    'What is the capital of France?'
  );

  // 2. Wrap the client
  const wrappedClient = wrapOpenAI(client, recorder);

  // 3. Make a call
  console.log('Making OpenAI request...');
  const response = await wrappedClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'What is the capital of France?' }
    ]
  });

  console.log('Response:', response.choices[0].message.content);

  // 4. End run and save artifact
  recorder.endRun('success');
  const filename = `examples/demo-record-${Date.now()}.json`;
  await recorder.save(filename);
  
  console.log(`\nArtifact saved to: ${filename}`);
  console.log(`You can inspect it with: npx agentdiff inspect ${filename}`);
}

main().catch(console.error);
