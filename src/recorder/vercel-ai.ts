import type { AgentRecorder } from './index.js';
import { AgentReplay } from '../replay/index.js';

/**
 * Extracts a stable model identifier string from a Vercel AI SDK model object.
 * The model object may expose `modelId`, `id`, or be a string itself.
 */
function extractModelId(model: any): string {
  if (typeof model === 'string') return model;
  if (model?.modelId) return String(model.modelId);
  if (model?.id) return String(model.id);
  return 'unknown';
}

/**
 * Extracts the provider identifier from a Vercel AI SDK model object.
 */
function extractProvider(model: any): string {
  if (typeof model === 'string') {
    // Format: "provider/model-name"
    const slash = model.indexOf('/');
    if (slash > 0) return model.slice(0, slash);
    return 'vercel-ai';
  }
  if (model?.provider) return String(model.provider);
  return 'vercel-ai';
}

/**
 * Normalizes Vercel AI SDK messages/prompt into the AgentDiff message format.
 */
function normalizeMessages(options: any): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  if (options.system) {
    messages.push({ role: 'system', content: String(options.system) });
  }

  if (options.prompt) {
    messages.push({ role: 'user', content: String(options.prompt) });
  }

  if (options.messages && Array.isArray(options.messages)) {
    for (const m of options.messages) {
      messages.push({
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      });
    }
  }

  return messages;
}

/**
 * Wraps the Vercel AI SDK `generateText` function to record the execution
 * into an AgentDiff artifact.
 *
 * Usage:
 * ```ts
 * import { generateText } from 'ai';
 * import { AgentRecorder, recordGenerateText } from 'agentdiff';
 *
 * const recorder = new AgentRecorder({ name: 'my-agent' });
 * const result = await recordGenerateText(recorder, generateText, {
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 * });
 * ```
 *
 * @param recorder - The AgentRecorder instance to record events into.
 * @param generateTextFn - The real `generateText` function from the `ai` package.
 * @param options - The options to pass to `generateText`.
 * @returns The result of `generateText`, unchanged.
 */
const replayCache = new WeakMap<AgentRecorder, AgentReplay>();

export async function recordGenerateText<T>(
  recorder: AgentRecorder,
  generateTextFn: (options: any) => Promise<T>,
  options: any
): Promise<T> {
  // Check for auto-replay mode
  if (process.env.AGENTDIFF_REPLAY_FIXTURE) {
    const { replayGenerateText } = await import('../replay/vercel-ai.js');
    let replay = replayCache.get(recorder);
    if (!replay) {
      replay = new AgentReplay(process.env.AGENTDIFF_REPLAY_FIXTURE, recorder);
      replayCache.set(recorder, replay);
    }
    return replayGenerateText(replay, options) as Promise<T>;
  }

  const startMs = Date.now();
  const modelId = extractModelId(options.model);
  const provider = extractProvider(options.model);
  const normalizedMessages = normalizeMessages(options);

  // Record the outgoing model call
  recorder.addEvent({
    type: 'model_call',
    provider,
    model: modelId,
    messages: normalizedMessages,
  });

  try {
    const result = await generateTextFn(options);
    const endMs = Date.now();
    
    recordVercelResult(recorder, result, provider, modelId, normalizedMessages, startMs, endMs);

    return result;
  } catch (error: any) {
    recorder.addEvent({
      type: 'error',
      error: error.message || String(error),
      errorType: error.name || 'VercelAIError',
      recoverable: false,
    });
    throw error;
  }
}

/**
 * Common logic to record the successful result of a Vercel AI SDK generation/stream.
 */
function recordVercelResult(
  recorder: AgentRecorder, 
  r: any, 
  provider: string, 
  modelId: string, 
  normalizedMessages: any[], 
  startMs: number, 
  endMs: number
) {
  // Process steps if available (multi-step agent flows)
  const steps = r.steps;
  if (steps && Array.isArray(steps) && steps.length > 1) {
    // Multi-step: record each step individually
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (i > 0) {
        // Record additional model_call events for subsequent steps
        recorder.addEvent({
          type: 'model_call',
          provider,
          model: modelId,
          messages: normalizedMessages, // Simplified; real messages evolve per step
        });
      }

      // Record model_response for this step
      const stepUsage = step.usage;
      recorder.addEvent({
        type: 'model_response',
        durationMs: i === steps.length - 1 ? endMs - startMs : undefined,
        response: step.text || '',
        tokenUsage: stepUsage ? {
          input: stepUsage.promptTokens ?? stepUsage.input,
          output: stepUsage.completionTokens ?? stepUsage.output,
          total: (stepUsage.promptTokens ?? stepUsage.input ?? 0) + (stepUsage.completionTokens ?? stepUsage.output ?? 0),
        } : undefined,
        metadata: step.finishReason ? { finishReason: step.finishReason } : undefined,
      });

      // Record tool calls from this step
      if (step.toolCalls && Array.isArray(step.toolCalls)) {
        for (const tc of step.toolCalls) {
          recorder.addEvent({
            type: 'tool_call',
            tool: tc.toolName || tc.name || 'unknown',
            arguments: tc.args || tc.arguments || {},
          });
        }
      }

      // Record tool results from this step
      if (step.toolResults && Array.isArray(step.toolResults)) {
        for (const tr of step.toolResults) {
          recorder.addEvent({
            type: 'tool_result',
            tool: tr.toolName || tr.name || 'unknown',
            result: tr.result,
          });
        }
      }
    }
  } else {
    // Single-step: record the final result directly
    const usage = r.usage;
    recorder.addEvent({
      type: 'model_response',
      durationMs: endMs - startMs,
      response: r.text || '',
      tokenUsage: usage ? {
        input: usage.promptTokens ?? usage.input,
        output: usage.completionTokens ?? usage.output,
        total: (usage.promptTokens ?? usage.input ?? 0) + (usage.completionTokens ?? usage.output ?? 0),
      } : undefined,
      metadata: r.finishReason ? { finishReason: r.finishReason } : undefined,
    });

    // Record tool calls
    if (r.toolCalls && Array.isArray(r.toolCalls)) {
      for (const tc of r.toolCalls) {
        recorder.addEvent({
          type: 'tool_call',
          tool: tc.toolName || tc.name || 'unknown',
          arguments: tc.args || tc.arguments || {},
        });
      }
    }

    // Record tool results
    if (r.toolResults && Array.isArray(r.toolResults)) {
      for (const tr of r.toolResults) {
        recorder.addEvent({
          type: 'tool_result',
          tool: tr.toolName || tr.name || 'unknown',
          result: tr.result,
        });
      }
    }
  }

  // Accumulate token usage on the artifact
  const totalUsage = r.usage;
  if (totalUsage) {
    const artifact = recorder.getArtifact();
    if (!artifact.tokenUsage) artifact.tokenUsage = {};
    const input = totalUsage.promptTokens ?? totalUsage.input ?? 0;
    const output = totalUsage.completionTokens ?? totalUsage.output ?? 0;
    artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + input;
    artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + output;
    artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + input + output;
  }

  // Set primary model info
  const artifact = recorder.getArtifact();
  if (!artifact.model) {
    artifact.model = { provider, name: modelId };
  }
}

/**
 * Wraps the Vercel AI SDK `streamText` function to record the execution
 * into an AgentDiff artifact.
 *
 * Usage:
 * ```ts
 * import { streamText } from 'ai';
 * import { AgentRecorder, recordStreamText } from 'agentdiff';
 *
 * const recorder = new AgentRecorder({ name: 'my-agent' });
 * const result = await recordStreamText(recorder, streamText, {
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello!',
 * });
 * for await (const chunk of result.textStream) { ... }
 * ```
 *
 * @param recorder - The AgentRecorder instance to record events into.
 * @param streamTextFn - The real `streamText` function from the `ai` package.
 * @param options - The options to pass to `streamText`.
 * @returns The result of `streamText`, unchanged.
 */
export async function recordStreamText<T>(
  recorder: AgentRecorder,
  streamTextFn: (options: any) => T,
  options: any
): Promise<T> {
  if (process.env.AGENTDIFF_REPLAY_FIXTURE) {
    const { replayStreamText } = await import('../replay/vercel-ai.js');
    let replay = replayCache.get(recorder);
    if (!replay) {
      replay = new AgentReplay(process.env.AGENTDIFF_REPLAY_FIXTURE, recorder);
      replayCache.set(recorder, replay);
    }
    return replayStreamText(replay, options) as Promise<T>;
  }

  const startMs = Date.now();
  const modelId = extractModelId(options.model);
  const provider = extractProvider(options.model);
  const normalizedMessages = normalizeMessages(options);

  // Record the outgoing model call
  recorder.addEvent({
    type: 'model_call',
    provider,
    model: modelId,
    messages: normalizedMessages,
  });

  const originalOnFinish = options.onFinish;
  let stepsProcessed = false;

  const newOptions = {
    ...options,
    onFinish: async (event: any) => {
      if (stepsProcessed) return;
      stepsProcessed = true;

      const endMs = Date.now();
      recordVercelResult(recorder, event, provider, modelId, normalizedMessages, startMs, endMs);

      if (originalOnFinish) {
        await originalOnFinish(event);
      }
    }
  };

  try {
    return streamTextFn(newOptions);
  } catch (error: any) {
    recorder.addEvent({
      type: 'error',
      error: error.message || String(error),
      errorType: error.name || 'VercelAIError',
      recoverable: false,
    });
    throw error;
  }
}
