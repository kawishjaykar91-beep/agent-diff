import { OpenAI } from 'openai';
import { AgentRecorder, wrapOpenAI } from '../../src/index.js';

const fixture = process.env.AGENTDIFF_REPLAY_FIXTURE;

async function runCodingAgent(client: OpenAI, task: string) {
  // A simple simulated agent loop
  const messages: any[] = [{ role: 'system', content: 'You are a coding assistant with access to search and edit files.' }, { role: 'user', content: task }];
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools: [
      { type: 'function', function: { name: 'search_files', description: 'Search for files', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
      { type: 'function', function: { name: 'edit_file', description: 'Edit a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } }
    ]
  });

  const msg = response.choices[0].message;
  if (msg.tool_calls) {
    for (const call of msg.tool_calls) {
      if (call.function.name === 'search_files') {
        console.log(`[Agent] Searching files for: ${JSON.parse(call.function.arguments).query}`);
      } else if (call.function.name === 'edit_file') {
        console.log(`[Agent] Editing file: ${JSON.parse(call.function.arguments).path}`);
      }
    }
  } else {
    console.log(`[Agent] Final Response: ${msg.content}`);
  }
}

async function main() {
  const isMocked = !process.env.OPENAI_API_KEY && !fixture;
  let client = new OpenAI(isMocked || fixture ? { apiKey: 'dummy-key' } : undefined);

  if (isMocked) {
    client.chat.completions.create = async () => ({
      id: `mock-${Date.now()}`, model: 'gpt-4o', object: 'chat.completion', created: Date.now(),
      choices: [{ index: 0, message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{"query":"auth"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }) as any;
  }

  // Initialize recorder
  const recorder = new AgentRecorder({ name: 'coding-agent' }, 'Fix the auth bug');
  
  // Wrap client. Auto-replays if AGENTDIFF_REPLAY_FIXTURE is set
  client = wrapOpenAI(client, recorder);

  await runCodingAgent(client, 'Fix the auth bug');

  // Uses automatic defaults! Will save to .agentdiff/runs/latest.agentrun
  await recorder.save();
}

main().catch(console.error);
