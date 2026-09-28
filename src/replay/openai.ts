import type { OpenAI } from 'openai';
import type { AgentReplay } from './index.js';

export function wrapOpenAIForReplay(client: OpenAI, replay: AgentReplay): OpenAI {
  const recorder = replay.getRecorder();

  client.chat.completions.create = (async (body: any, options?: any) => {
    const startMs = Date.now();
    
    // Attempt to consume the expected call from the fixture
    const { response: expectedResponse } = replay.consumeModelCall(body.model, body.messages || []);

    if (!expectedResponse) {
      throw new Error('Replay mismatch: Expected a model_response in the fixture but none was found.');
    }

    // Record the simulated outgoing call
    recorder.addEvent({
      type: 'model_call',
      provider: 'openai',
      model: body.model,
      messages: body.messages?.map((m: any) => ({ 
        role: m.role, 
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) 
      }))
    });

    // Simulate network delay using the recorded duration, or a small default
    const duration = expectedResponse.durationMs || 100;

    // We don't actually sleep in tests to keep them fast, 
    // but in a real replay we could `await new Promise(r => setTimeout(r, duration));`
    // We'll skip the actual delay for determinism and speed, but record the simulated duration.
    const endMs = startMs + duration;

    // Look for tool calls that occurred in the fixture immediately after the response.
    // The fixture schema flattens tool_calls as separate events, but OpenAI SDK expects them
    // inside the message object. We need to reconstruct the OpenAI SDK response structure.
    
    // To do this reliably for M3, we assume the recorded `model_response` contains
    // what we need, or we peek at the `tool_call` events that immediately follow it
    // in the fixture.
    
    // Wait, the standard recorder (M1) records `model_response` and THEN `tool_call`s.
    // We need to look up those tool calls to synthesize `tool_calls` in the OpenAI response.
    
    // (Simplification for M3: if the user's code expects a tool call, we need to return it
    // exactly as the SDK would. For now, we will extract it from the fixture using the recorder's history).
    const fixtureArtifact = (replay as any).fixture; // private access for synthesis
    const responseIndex = fixtureArtifact.events.findIndex((e: any) => e.id === expectedResponse.id);
    
    const toolCalls: any[] = [];
    let i = responseIndex + 1;
    while (i < fixtureArtifact.events.length && fixtureArtifact.events[i].type === 'tool_call') {
       const tc = fixtureArtifact.events[i];
       toolCalls.push({
          id: `call_${tc.id}`, // Faked ID
          type: 'function',
          function: {
             name: tc.tool,
             arguments: JSON.stringify(tc.arguments || {})
          }
       });
       i++;
    }

    // Handle Streaming Replay
    if (body.stream === true || options?.stream === true) {
      return (async function* () {
        // Record the simulated response in the new trace (at the end)
        try {
          const chunkId = `replay-${Date.now()}`;
          
          // Yield content
          if (expectedResponse.response) {
            yield {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [{
                index: 0,
                delta: { content: expectedResponse.response },
                finish_reason: null
              }]
            };
          }

          // Yield tool calls
          if (toolCalls.length > 0) {
            yield {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: toolCalls.map((tc, idx) => ({
                    index: idx,
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments
                    }
                  }))
                },
                finish_reason: 'tool_calls'
              }]
            };
          } else {
            yield {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }]
            };
          }

          // Optional: Yield usage if available (some SDK options require this)
          if (expectedResponse.tokenUsage) {
            yield {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [],
              usage: {
                prompt_tokens: expectedResponse.tokenUsage.input || 0,
                completion_tokens: expectedResponse.tokenUsage.output || 0,
                total_tokens: expectedResponse.tokenUsage.total || 0
              }
            };
          }

        } finally {
          recorder.addEvent({
            type: 'model_response',
            durationMs: duration,
            response: expectedResponse.response || '',
            tokenUsage: expectedResponse.tokenUsage
          });

          for (const tc of toolCalls) {
            recorder.addEvent({
               type: 'tool_call',
               tool: tc.function.name,
               arguments: JSON.parse(tc.function.arguments)
            });
          }

          const artifact = recorder.getArtifact();
          if (expectedResponse.tokenUsage) {
            if (!artifact.tokenUsage) artifact.tokenUsage = { input: 0, output: 0, total: 0 };
            artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + (expectedResponse.tokenUsage.input || 0);
            artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + (expectedResponse.tokenUsage.output || 0);
            artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + (expectedResponse.tokenUsage.total || 0);
          }
          if (!artifact.model) {
            artifact.model = { provider: 'openai', name: body.model };
          }
        }
      })() as any;
    }

    // Handle Non-Streaming Replay
    const mockResponse: any = {
      id: `replay-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: expectedResponse.response || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: expectedResponse.tokenUsage?.input || 0,
        completion_tokens: expectedResponse.tokenUsage?.output || 0,
        total_tokens: expectedResponse.tokenUsage?.total || 0
      }
    };

    // Record the simulated response in the new trace
    recorder.addEvent({
      type: 'model_response',
      durationMs: duration,
      response: expectedResponse.response || '',
      tokenUsage: expectedResponse.tokenUsage
    });

    // Record the simulated tool calls
    for (const tc of toolCalls) {
      recorder.addEvent({
         type: 'tool_call',
         tool: tc.function.name,
         arguments: JSON.parse(tc.function.arguments)
      });
    }

    // Accumulate tokens on the new artifact
    const artifact = recorder.getArtifact();
    if (expectedResponse.tokenUsage) {
      if (!artifact.tokenUsage) artifact.tokenUsage = { input: 0, output: 0, total: 0 };
      artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + (expectedResponse.tokenUsage.input || 0);
      artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + (expectedResponse.tokenUsage.output || 0);
      artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + (expectedResponse.tokenUsage.total || 0);
    }
    
    if (!artifact.model) {
      artifact.model = { provider: 'openai', name: body.model };
    }

    return mockResponse;
  }) as any;

  return client;
}
