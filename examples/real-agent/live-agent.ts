import OpenAI from 'openai';
import { AgentRecorder, wrapOpenAI } from '../../dist/index.js';

// WARNING: To run this example, you must set OPENAI_API_KEY in your environment.

async function runAgent() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is missing.');
    console.error('Please set it via: export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  // 1. Initialize AgentDiff Recorder
  const recorder = new AgentRecorder({
    name: 'weather-agent-live',
    version: '1.0.0'
  }, 'What is the weather in SF?');

  // 2. Wrap the real OpenAI client with the recorder
  const client = wrapOpenAI(new OpenAI(), recorder);

  console.log('--- Live Agent Execution Started ---');
  
  const messages = [
    { role: 'user', content: 'What is the weather in SF?' }
  ];

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather in a given location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            },
            required: ['location']
          }
        }
      }]
    });
    
    const message = response.choices[0].message;
    console.log('Model response:', message);
    
    if (message.tool_calls) {
      const toolCall = message.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);
      
      console.log(`\nExecuting tool: ${toolCall.function.name} with args:`, args);
      
      // Simulate real tool execution and log result
      const toolResult = { temperature: 68, condition: 'partly cloudy' };
      recorder.addEvent({
        type: 'tool_result',
        tool: toolCall.function.name,
        result: toolResult
      });
      
      messages.push(message as any);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
      });
      
      // Second model call
      const finalResponse = await client.chat.completions.create({
        model: 'gpt-4o',
        messages
      });
      
      console.log('\nFinal response:', finalResponse.choices[0].message.content);
      recorder.endRun('success', finalResponse.choices[0].message.content);
    } else {
       recorder.endRun('success', message.content);
    }
  } catch (error) {
    console.error('Agent crashed:', error);
    recorder.recordError(error);
    recorder.endRun('error');
  }
  
  // 3. Save the execution trace
  await recorder.save();
  console.log(`\n--- Live Agent Execution Finished ---`);
  console.log(`Trace saved. Run 'npx agentdiff list' to see it.`);
}

runAgent();
