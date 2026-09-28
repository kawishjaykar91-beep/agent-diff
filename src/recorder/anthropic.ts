import type { Anthropic } from '@anthropic-ai/sdk';
import type { AgentRecorder } from './index.js';
import { AgentReplay } from '../replay/index.js';
import { wrapAnthropicForReplay } from '../replay/anthropic.js';

/**
 * Wraps an Anthropic client to automatically record model calls and tool usage.
 */
export function wrapAnthropic(client: Anthropic, recorder: AgentRecorder): Anthropic {
  if (process.env.AGENTDIFF_REPLAY_FIXTURE) {
    const replay = new AgentReplay(process.env.AGENTDIFF_REPLAY_FIXTURE, recorder);
    return wrapAnthropicForReplay(client, replay);
  }

  const originalCreate = client.messages.create.bind(client.messages);

  client.messages.create = (async (body: any, options?: any) => {
    const startMs = Date.now();
    
    // Construct normalized messages array
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

    recorder.addEvent({
      type: 'model_call',
      provider: 'anthropic',
      model: body.model,
      messages: normalizedMessages
    });

    let message: any;
    try {
      // Execute the real network request
      message = await originalCreate(body, options);
      
      if (body.stream === true || options?.stream === true) {
         return (async function* () {
           let fullText = '';
           const toolCallsMap = new Map<number, { id: string, name: string, arguments: string }>();
           let inputTokens = 0;
           let outputTokens = 0;
           
           try {
             for await (const chunk of message) {
               if (chunk.type === 'message_start' && chunk.message?.usage) {
                 inputTokens += chunk.message.usage.input_tokens || 0;
                 outputTokens += chunk.message.usage.output_tokens || 0;
               } else if (chunk.type === 'message_delta' && chunk.usage) {
                 outputTokens += chunk.usage.output_tokens || 0;
               } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
                 toolCallsMap.set(chunk.index, { 
                   id: chunk.content_block.id, 
                   name: chunk.content_block.name, 
                   arguments: '' 
                 });
               } else if (chunk.type === 'content_block_delta') {
                 if (chunk.delta.type === 'text_delta') {
                   fullText += chunk.delta.text;
                 } else if (chunk.delta.type === 'input_json_delta') {
                   const tc = toolCallsMap.get(chunk.index);
                   if (tc) tc.arguments += chunk.delta.partial_json;
                 }
               }
               yield chunk;
             }
           } catch (err: any) {
             recorder.addEvent({
                type: 'error',
                error: err.message || String(err),
                errorType: err.name || 'AnthropicStreamError',
                recoverable: false
             });
             throw err;
           } finally {
             const endMs = Date.now();
             
             recorder.addEvent({
               type: 'model_response',
               durationMs: endMs - startMs,
               response: fullText,
               tokenUsage: (inputTokens > 0 || outputTokens > 0) ? {
                 input: inputTokens,
                 output: outputTokens,
                 total: inputTokens + outputTokens
               } : undefined
             });

             for (const [_, tc] of toolCallsMap.entries()) {
               let parsedArgs = {};
               try { parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { parsedArgs = { raw: tc.arguments }; }
               recorder.addEvent({
                 type: 'tool_call',
                 tool: tc.name,
                 arguments: parsedArgs
               });
             }

             const artifact = recorder.getArtifact();
             if (inputTokens > 0 || outputTokens > 0) {
               if (!artifact.tokenUsage) artifact.tokenUsage = {};
               artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + inputTokens;
               artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + outputTokens;
               artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + (inputTokens + outputTokens);
             }
             if (!artifact.model) artifact.model = { provider: 'anthropic', name: body.model };
           }
         })();
      }
    } catch (error: any) {
      recorder.addEvent({
        type: 'error',
        error: error.message || 'Unknown Anthropic error',
      });
      throw error;
    }

    const endMs = Date.now();
    const duration = endMs - startMs;

    // Aggregate content (text) vs tool_use
    let textualResponse = '';
    const toolCalls: any[] = [];

    if (message.content && Array.isArray(message.content)) {
       for (const block of message.content) {
          if (block.type === 'text') {
             textualResponse += block.text;
          } else if (block.type === 'tool_use') {
             toolCalls.push(block);
          }
       }
    }

    // Anthropic token usage
    const tokenUsage = {
      input: message.usage?.input_tokens || 0,
      output: message.usage?.output_tokens || 0,
      total: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0)
    };

    recorder.addEvent({
      type: 'model_response',
      durationMs: duration,
      response: textualResponse || '',
      tokenUsage: tokenUsage.total > 0 ? tokenUsage : undefined
    });

    for (const tc of toolCalls) {
      recorder.addEvent({
         type: 'tool_call',
         tool: tc.name,
         arguments: tc.input
      });
    }

    // Accumulate total tokens in the artifact metadata
    const artifact = recorder.getArtifact();
    if (!artifact.tokenUsage) artifact.tokenUsage = {};
    artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + tokenUsage.input;
    artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + tokenUsage.output;
    artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + tokenUsage.total;
    
    if (!artifact.model) {
      artifact.model = { provider: 'anthropic', name: body.model };
    }

    return message;
  }) as any;

  return client;
}
