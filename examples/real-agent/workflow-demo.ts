import { AgentRecorder, wrapOpenAI } from '../../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

function createMockOpenAI(behavior: 'baseline' | 'regression') {
  return {
    chat: {
      completions: {
        create: async (body: any) => {
          const lastMessage = body.messages[body.messages.length - 1].content;
          
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
          
          if (behavior === 'regression') {
             // In the regression run, the agent hallucinates a second tool call before responding
             return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_456',
                      type: 'function',
                      function: { name: 'search_files', arguments: '{"query": "weather"}' }
                    }]
                  }
                }],
                usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
             };
          }

          return {
            choices: [{
              message: { role: 'assistant', content: 'The weather in San Francisco is 65F and sunny.' }
            }],
            usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 }
          };
        }
      }
    }
  };
}

async function runAgent(recorder: AgentRecorder, client: any) {
  const messages: any[] = [{ role: 'user', content: 'What is the weather in SF?' }];

  try {
    const response1 = await client.chat.completions.create({ model: 'gpt-4o', messages });
    const message = response1.choices[0].message;
    
    if (message.tool_calls) {
      const toolCall = message.tool_calls[0];
      recorder.addEvent({
        type: 'tool_result',
        tool: toolCall.function.name,
        result: { temperature: 65, condition: 'sunny' }
      });
      
      messages.push(message);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ temperature: 65, condition: 'sunny' })
      });
      
      const response2 = await client.chat.completions.create({ model: 'gpt-4o', messages });
      if (response2.choices[0].message.tool_calls) {
         // Agent hallucinates an error state
         recorder.recordError(new Error("Unexpected tool call hallucinated"));
         recorder.endRun('error');
      } else {
         recorder.endRun('success', response2.choices[0].message.content);
      }
    }
  } catch (error) {
    recorder.recordError(error);
    recorder.endRun('error');
  }
}

async function main() {
  console.log('1. Running Baseline Agent...');
  const baselineRecorder = new AgentRecorder({ name: 'weather-agent', version: '1.0' }, 'What is the weather in SF?');
  const baselineClient = wrapOpenAI(createMockOpenAI('baseline') as any, baselineRecorder);
  
  await runAgent(baselineRecorder, baselineClient);
  
  // Save as fixture
  const fixturesDir = path.join(process.cwd(), '.agentdiff', 'fixtures');
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
  const fixturePath = path.join(fixturesDir, 'baseline.agentrun');
  await baselineRecorder.save(fixturePath);
  console.log(`   Baseline fixture saved to: ${fixturePath}\n`);

  console.log('2. Running Regression Agent (Agent behavior changed)...');
  const regressionRecorder = new AgentRecorder({ name: 'weather-agent', version: '1.1' }, 'What is the weather in SF?');
  const regressionClient = wrapOpenAI(createMockOpenAI('regression') as any, regressionRecorder);
  
  await runAgent(regressionRecorder, regressionClient);
  
  // Save as run
  const runsDir = path.join(process.cwd(), '.agentdiff', 'runs');
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const runPath = path.join(runsDir, 'latest.agentrun');
  await regressionRecorder.save(runPath);
  console.log(`   Regression run saved to: ${runPath}\n`);

  console.log('3. Running `agentdiff test` to detect the regression:');
  try {
     execSync(`node dist/cli/main.js test "${fixturePath}" "${runPath}"`, { stdio: 'inherit' });
  } catch (err) {
     console.log('\n(Exit code 1 correctly returned due to behavioral regression)');
  }
}

main();
