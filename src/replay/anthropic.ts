import type { Anthropic } from '@anthropic-ai/sdk';
import type { AgentReplay } from './index.js';

export function wrapAnthropicForReplay(client: Anthropic, replay: AgentReplay): Anthropic {
  const recorder = replay.getRecorder();

  client.messages.create = (async (body: any, options?: any) => {
    const startMs = Date.now();
    
    // Normalize request to match against the fixture
    const normalizedMessages: any[] = [];
    if (body.system) {
       normalizedMessages.push({ role: 'system', content: typeof body.system === 'string' ? body.system : JSON.stringify(body.system) });
    }
    if (body.messages) {
       for (const m of body.messages) {
          normalizedMessages.push({
             role: m.role,
             content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          });
       }
    }

    const { response: expectedResponse } = replay.consumeModelCall(body.model, normalizedMessages);

    if (!expectedResponse) {
      throw new Error('Replay mismatch: Expected a model_response in the fixture but none was found.');
    }

    recorder.addEvent({
      type: 'model_call',
      provider: 'anthropic',
      model: body.model,
      messages: normalizedMessages
    });

    const duration = expectedResponse.durationMs || 100;
    
    // Extract tool calls from fixture following the model_response
    const fixtureArtifact = (replay as any).fixture; 
    const responseIndex = fixtureArtifact.events.findIndex((e: any) => e.id === expectedResponse.id);
    
    const toolCalls: any[] = [];
    let i = responseIndex + 1;
    while (i < fixtureArtifact.events.length && fixtureArtifact.events[i].type === 'tool_call') {
       const tc = fixtureArtifact.events[i];
       toolCalls.push({
          type: 'tool_use',
          id: `toolu_${tc.id}`,
          name: tc.tool,
          input: tc.arguments || {}
       });
       i++;
    }

    const contentBlocks: any[] = [];
    if (expectedResponse.response) {
       contentBlocks.push({ type: 'text', text: expectedResponse.response });
    }
    for (const tc of toolCalls) {
       contentBlocks.push(tc);
    }

    if (body.stream === true || options?.stream === true) {
       return (async function* () {
         try {
           // message_start
           yield {
             type: 'message_start',
             message: {
               id: `msg_replay_${Date.now()}`,
               type: 'message',
               role: 'assistant',
               model: body.model,
               content: [],
               stop_reason: null,
               stop_sequence: null,
               usage: { input_tokens: expectedResponse.tokenUsage?.input || 0, output_tokens: 0 }
             }
           };

           // Yield text content
           if (expectedResponse.response) {
             yield {
               type: 'content_block_start',
               index: 0,
               content_block: { type: 'text', text: '' }
             };
             yield {
               type: 'content_block_delta',
               index: 0,
               delta: { type: 'text_delta', text: expectedResponse.response }
             };
             yield {
               type: 'content_block_stop',
               index: 0
             };
           }

           // Yield tool calls
           let blockIndex = expectedResponse.response ? 1 : 0;
           for (const tc of toolCalls) {
             yield {
               type: 'content_block_start',
               index: blockIndex,
               content_block: {
                 type: 'tool_use',
                 id: tc.id,
                 name: tc.name
               }
             };
             yield {
               type: 'content_block_delta',
               index: blockIndex,
               delta: {
                 type: 'input_json_delta',
                 partial_json: JSON.stringify(tc.input)
               }
             };
             yield {
               type: 'content_block_stop',
               index: blockIndex
             };
             blockIndex++;
           }

           // message_delta (output tokens & stop reason)
           yield {
             type: 'message_delta',
             delta: {
               stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
               stop_sequence: null
             },
             usage: { output_tokens: expectedResponse.tokenUsage?.output || 0 }
           };

           // message_stop
           yield { type: 'message_stop' };

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
                tool: tc.name,
                arguments: tc.input
             });
           }

           const artifact = recorder.getArtifact();
           if (expectedResponse.tokenUsage) {
             if (!artifact.tokenUsage) artifact.tokenUsage = {};
             artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + (expectedResponse.tokenUsage.input || 0);
             artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + (expectedResponse.tokenUsage.output || 0);
             artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + (expectedResponse.tokenUsage.total || 0);
           }
           
           if (!artifact.model) {
             artifact.model = { provider: 'anthropic', name: body.model };
           }
         }
       })();
    }

    const mockResponse: any = {
      id: `msg_replay_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      content: contentBlocks,
      usage: {
        input_tokens: expectedResponse.tokenUsage?.input || 0,
        output_tokens: expectedResponse.tokenUsage?.output || 0
      }
    };

    recorder.addEvent({
      type: 'model_response',
      durationMs: duration,
      response: expectedResponse.response || '',
      tokenUsage: expectedResponse.tokenUsage
    });

    for (const tc of toolCalls) {
      recorder.addEvent({
         type: 'tool_call',
         tool: tc.name,
         arguments: tc.input
      });
    }

    const artifact = recorder.getArtifact();
    if (expectedResponse.tokenUsage) {
      if (!artifact.tokenUsage) artifact.tokenUsage = {};
      artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + (expectedResponse.tokenUsage.input || 0);
      artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + (expectedResponse.tokenUsage.output || 0);
      artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + (expectedResponse.tokenUsage.total || 0);
    }
    
    if (!artifact.model) {
      artifact.model = { provider: 'anthropic', name: body.model };
    }

    return mockResponse;
  }) as any;

  return client;
}
