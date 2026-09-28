import { OpenAI } from 'openai';
import { AgentRecorder, wrapOpenAI } from '../../src/index.js';

// No API key required because this file is intended to be run under replay mode.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
const recorder = new AgentRecorder({ name: 'openai-streaming-agent' });
const wrappedClient = wrapOpenAI(client, recorder);

async function main() {
  console.log('--- OpenAI Streaming Demo ---');
  
  try {
    const stream = await wrappedClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
      stream: true,
      stream_options: { include_usage: true }
    });

    process.stdout.write('Response: ');
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        process.stdout.write(content);
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
