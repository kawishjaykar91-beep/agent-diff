import { AgentRecorder, wrapOpenAI } from '../../dist/index.js';

// 1. We create a mock OpenAI client to run this example offline without API keys.
// In a real application, you would import OpenAI from "openai" and instantiate it.
class MockOpenAI {
  chat = {
    completions: {
      create: async (body) => {
        const lastMessage = body.messages[body.messages.length - 1].content;
        
        // Return a tool call on the first request
        if (lastMessage.includes('weather')) {
          return {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location": "San Francisco"}' }
                }]
              }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
          };
        }
        
        // Return a final response on the second request
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: 'The weather in San Francisco is 65F and sunny.'
            }
          }],
          usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 }
        };
      }
    }
  };
}

// 2. Initialize AgentDiff Recorder
const recorder = new AgentRecorder({
  name: 'weather-agent',
  version: '1.0.0'
}, 'What is the weather in SF?');

// 3. Wrap your AI client with the recorder
const client = wrapOpenAI(new MockOpenAI() as any, recorder);

async function runAgent() {
  console.log('--- Agent Execution Started ---');
  
  const messages = [
    { role: 'user', content: 'What is the weather in SF?' }
  ];

  try {
    // First model call
    const response1 = await client.chat.completions.create({
      model: 'gpt-4o',
      messages
    });
    
    const message = response1.choices[0].message;
    console.log('Model response:', message);
    
    if (message.tool_calls) {
      const toolCall = message.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);
      
      console.log(`\nExecuting tool: ${toolCall.function.name} with args:`, args);
      
      // We manually log the tool result into the recorder
      const toolResult = { temperature: 65, condition: 'sunny' };
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
      const response2 = await client.chat.completions.create({
        model: 'gpt-4o',
        messages
      });
      
      console.log('\nFinal response:', response2.choices[0].message.content);
      recorder.endRun('success', response2.choices[0].message.content);
    }
  } catch (error) {
    console.error('Agent crashed:', error);
    recorder.recordError(error);
    recorder.endRun('error');
  }
  
  // 4. Save the execution trace
  await recorder.save();
  console.log(`\n--- Agent Execution Finished ---`);
  console.log(`Trace saved. Run 'npx agentdiff list' to see it.`);
}

runAgent();
