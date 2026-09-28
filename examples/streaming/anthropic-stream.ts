import { Anthropic } from '@anthropic-ai/sdk';
import { AgentRecorder, wrapAnthropic } from '../../src/index.js';

// No API key required because this file is intended to be run under replay mode.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });
const recorder = new AgentRecorder({ name: 'anthropic-streaming-agent' });
const wrappedClient = wrapAnthropic(client, recorder);

async function main() {
  console.log('--- Anthropic Streaming Demo ---');
  
  try {
    const stream = await wrappedClient.messages.create({
      model: 'claude-3-5-sonnet',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
      stream: true,
      tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { location: { type: 'string' } } } }]
    });

    process.stdout.write('Response: ');
    let toolName = '';
    
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        process.stdout.write(chunk.delta.text);
      } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
        toolName = chunk.content_block.name;
        console.log(`\n[Tool called: ${toolName}]`);
      } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
        process.stdout.write(chunk.delta.partial_json);
      }
    }
    console.log('\n\nStream finished!');
    
    // Save the recording
    await recorder.save();
    console.log(`Trace saved to: .agentdiff/runs/${recorder.getArtifact().runId}.agentrun`);
  } catch (error: any) {
    console.error('Error during execution:', error.message);
  }
}

main();
