import type { OpenAI } from 'openai';
import type { AgentRecorder } from './index.js';
import { AgentReplay } from '../replay/index.js';
import { wrapOpenAIForReplay } from '../replay/openai.js';

/**
 * Wraps an OpenAI client to automatically record model calls and responses
 * into the provided AgentRecorder instance.
 *
 * NOTE: This is a shallow wrap of `chat.completions.create` for Milestone 1.
 * It will not capture streaming responses yet.
 */
export function wrapOpenAI(client: OpenAI, recorder: AgentRecorder): OpenAI {
  if (process.env.AGENTDIFF_REPLAY_FIXTURE) {
    // Transparently upgrade to replay mode
    const replay = new AgentReplay(process.env.AGENTDIFF_REPLAY_FIXTURE, recorder);
    return wrapOpenAIForReplay(client, replay);
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  // We mutate the create method to intercept calls.
  // In a more robust production version, a Proxy approach might be used,
  // but this is standard and effective for the milestone.
  client.chat.completions.create = (async (body: any, options?: any) => {
    const startMs = Date.now();
    
    // Add model_call event
    recorder.addEvent({
      type: 'model_call',
      provider: 'openai',
      model: body.model,
      // Be cautious: only capture basic text messages to avoid capturing complex images/secrets
      // This is a minimal extraction for milestone 1
      messages: body.messages?.map((m: any) => ({ 
        role: m.role, 
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) 
      }))
    });

    try {
      // Execute the actual SDK call
      const response = await originalCreate(body, options);
      
      // Handle Streaming
      if (body.stream === true || options?.stream === true) {
        return (async function* () {
          let fullText = '';
          const toolCallsMap = new Map<number, { id: string, name: string, arguments: string }>();
          let finalUsage: any = undefined;

          try {
            for await (const chunk of response as any) {
              const delta = chunk.choices?.[0]?.delta;
              if (delta) {
                if (delta.content) {
                  fullText += delta.content;
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (!toolCallsMap.has(tc.index)) {
                      toolCallsMap.set(tc.index, { id: tc.id || `call_${Date.now()}_${tc.index}`, name: tc.function?.name || 'unknown', arguments: '' });
                    }
                    if (tc.function?.arguments) {
                      toolCallsMap.get(tc.index)!.arguments += tc.function.arguments;
                    }
                  }
                }
              }
              if (chunk.usage) {
                finalUsage = chunk.usage;
              }
              yield chunk;
            }
          } catch (err: any) {
             recorder.addEvent({
                type: 'error',
                error: err.message || String(err),
                errorType: err.name || 'OpenAIStreamError',
                recoverable: false
             });
             throw err;
          } finally {
            const endMs = Date.now();
            
            // Record aggregated response
            recorder.addEvent({
              type: 'model_response',
              durationMs: endMs - startMs,
              response: fullText,
              tokenUsage: finalUsage ? {
                input: finalUsage.prompt_tokens,
                output: finalUsage.completion_tokens,
                total: finalUsage.total_tokens
              } : undefined
            });

            // Record aggregated tool calls
            for (const [_, tc] of toolCallsMap.entries()) {
              let parsedArgs = {};
              try { parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { parsedArgs = { raw: tc.arguments }; }
              recorder.addEvent({
                type: 'tool_call',
                tool: tc.name,
                arguments: parsedArgs
              });
            }

            // Accumulate tokens on artifact
            if (finalUsage) {
              const artifact = recorder.getArtifact();
              if (!artifact.tokenUsage) artifact.tokenUsage = { input: 0, output: 0, total: 0 };
              artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + finalUsage.prompt_tokens;
              artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + finalUsage.completion_tokens;
              artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + finalUsage.total_tokens;
            }
            
            const artifact = recorder.getArtifact();
            if (!artifact.model) artifact.model = { provider: 'openai', name: body.model };
          }
        })() as any;
      }

      // Handle Non-Streaming
      const endMs = Date.now();
      const message = response.choices?.[0]?.message;
      
      // Add model_response event
      recorder.addEvent({
        type: 'model_response',
        durationMs: endMs - startMs,
        response: message?.content || '',
        tokenUsage: response.usage ? {
          input: response.usage.prompt_tokens,
          output: response.usage.completion_tokens,
          total: response.usage.total_tokens
        } : undefined
      });

      // If the model requested tool calls, log them
      if (message?.tool_calls && message.tool_calls.length > 0) {
         for (const tc of message.tool_calls) {
            if (tc.type === 'function') {
               recorder.addEvent({
                  type: 'tool_call',
                  tool: tc.function.name,
                  arguments: JSON.parse(tc.function.arguments || '{}')
               });
            }
         }
      }

      // Accumulate token usage at the artifact level
      const artifact = recorder.getArtifact();
      if (!artifact.tokenUsage) {
        artifact.tokenUsage = { input: 0, output: 0, total: 0 };
      }
      if (response.usage) {
        artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + response.usage.prompt_tokens;
        artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + response.usage.completion_tokens;
        artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + response.usage.total_tokens;
      }
      
      // Record primary model info if not already set
      if (!artifact.model) {
        artifact.model = { provider: 'openai', name: body.model };
      }

      return response;
    } catch (error: any) {
      recorder.addEvent({
        type: 'error',
        error: error.message || String(error),
        errorType: error.name || 'OpenAIError',
        recoverable: false
      });
      throw error;
    }
  }) as any;

  return client;
}
