import { OpenAI } from 'openai';
import { AgentRecorder, wrapOpenAI } from '../src/index.js';

// If this script is run via `agentdiff replay`, this environment variable will be set.
const replayFixturePath = process.env.AGENTDIFF_REPLAY_FIXTURE;
const isMocked = !process.env.OPENAI_API_KEY && !replayFixturePath;

async function runAgent(client: OpenAI): Promise<string> {
  const input = 'What is the capital of France?';
  console.log(`Agent: Making request... "${input}"`);
  const response = await client.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: input }]
  });
  console.log(`Agent: Received response -> "${response.choices[0].message.content}"`);
  return response.choices[0].message.content || '';
}

async function main() {
  // We use a dummy API key if we are mocked or replaying, to avoid OpenAI SDK throwing an auth error.
  let client = new OpenAI(isMocked || replayFixturePath ? { apiKey: 'dummy-key' } : undefined);
  
  if (isMocked) {
    // Provide a basic offline fallback just so the script can run without a real key
    client.chat.completions.create = async () => ({
      id: `mock-${Date.now()}`,
      model: 'gpt-3.5-turbo',
      object: 'chat.completion',
      created: Date.now(),
      choices: [{ index: 0, message: { role: 'assistant', content: 'The capital of France is Paris (mocked).' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }) as any;
  }

  // Initialize the recorder
  const recorder = new AgentRecorder({ name: 'replayable-bot', version: '1.0.0' }, 'What is the capital of France?');
  
  // Wrap the client. If AGENTDIFF_REPLAY_FIXTURE is set, this automatically uses replay mode!
  client = wrapOpenAI(client, recorder);

  // Run the agent control flow
  await runAgent(client);

  // End and save
  recorder.endRun('success');
  const outFilename = replayFixturePath ? 'examples/actual-replay.agentrun' : 'examples/original.agentrun';
  await recorder.save(outFilename);
  
  console.log(`\nArtifact saved to ${outFilename}`);
  if (!replayFixturePath) {
    console.log(`Now you can replay it deterministically with:`);
    console.log(`npx agentdiff replay examples/original.agentrun npx tsx examples/replay-openai.ts`);
  } else {
    console.log(`Now you can test the structural integrity:`);
    console.log(`npx agentdiff test ${replayFixturePath} ${outFilename}`);
  }
}

main().catch(err => {
  console.error('\nAgent Failed:', err.message);
  process.exit(1);
});
