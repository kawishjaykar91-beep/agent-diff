import type { AgentReplay } from './index.js';

/**
 * Extracts a stable model identifier string from a Vercel AI SDK model object.
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
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }
  }

  return messages;
}

/**
 * Replays a Vercel AI SDK `generateText` call deterministically from a recorded fixture.
 *
 * This function does NOT contact the real model/provider. It:
 * 1. Validates the request against the fixture using `AgentReplay.consumeModelCall()`.
 * 2. Constructs a deterministic result from the recorded `model_response` and `tool_call` events.
 * 3. Records the replayed events in the new trace.
 *
 * @param replay - The AgentReplay instance loaded from a fixture.
 * @param options - The original options the developer would pass to `generateText`.
 * @returns A result object structurally compatible with the Vercel AI SDK `generateText` return type.
 */
export async function replayGenerateText(replay: AgentReplay, options: any): Promise<any> {
  const result = consumeVercelReplay(replay, options);
  
  const mockResult = {
    text: result.text,
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
    finishReason: result.finishReason,
    usage: result.usage,
    steps: result.steps,
  };

  return mockResult;
}

/**
 * Replays a Vercel AI SDK `streamText` call deterministically from a recorded fixture.
 *
 * @param replay - The AgentReplay instance loaded from a fixture.
 * @param options - The original options the developer would pass to `streamText`.
 * @returns A result object structurally compatible with the Vercel AI SDK `streamText` return type.
 */
export async function replayStreamText(replay: AgentReplay, options: any): Promise<any> {
  const result = consumeVercelReplay(replay, options);

  const mockResult = {
    text: Promise.resolve(result.text),
    toolCalls: Promise.resolve(result.toolCalls),
    toolResults: Promise.resolve(result.toolResults),
    finishReason: Promise.resolve(result.finishReason),
    usage: Promise.resolve(result.usage),
    steps: Promise.resolve(result.steps),
    get textStream() {
      return (async function* () {
        if (result.text) {
          yield result.text;
        }
      })();
    },
    get fullStream() {
      return (async function* () {
        if (result.text) {
          yield { type: 'text-delta', textDelta: result.text };
        }
        for (const tc of result.toolCalls) {
          yield { type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args };
        }
        for (const tr of result.toolResults) {
          yield { type: 'tool-result', toolCallId: tr.toolCallId, toolName: tr.toolName, result: tr.result };
        }
        yield { type: 'finish', finishReason: result.finishReason, usage: result.usage };
      })();
    }
  };

  return mockResult;
}

/**
 * Common replay consumption logic.
 */
function consumeVercelReplay(replay: AgentReplay, options: any) {
  const recorder = replay.getRecorder();
  const modelId = extractModelId(options.model);
  const provider = extractProvider(options.model);
  const normalizedMessages = normalizeMessages(options);

  // Consume the expected model call from the fixture and validate the FIRST step
  const { response: firstResponse } = replay.consumeModelCall(modelId, normalizedMessages);

  if (!firstResponse) {
    throw new Error('Replay mismatch: Expected a model_response in the fixture but none was found.');
  }

  // Record the simulated outgoing call in the new trace
  recorder.addEvent({
    type: 'model_call',
    provider,
    model: modelId,
    messages: normalizedMessages,
  });

  const fixtureArtifact = (replay as any).fixture;
  let currentIndex = fixtureArtifact.events.findIndex((e: any) => e.id === firstResponse.id);
  
  const steps: any[] = [];
  let allToolCalls: any[] = [];
  let allToolResults: any[] = [];
  let finalResponseText = firstResponse.response || '';
  let finalFinishReason = (firstResponse.metadata as any)?.finishReason;

  // Track the current step being built
  let currentStep = {
    text: firstResponse.response || '',
    toolCalls: [] as any[],
    toolResults: [] as any[],
    usage: {
      promptTokens: firstResponse.tokenUsage?.input || 0,
      completionTokens: firstResponse.tokenUsage?.output || 0,
      totalTokens: firstResponse.tokenUsage?.total || 0,
    },
    finishReason: (firstResponse.metadata as any)?.finishReason || 'stop',
  };

  recorder.addEvent({
    type: 'model_response',
    durationMs: firstResponse.durationMs || 100,
    response: firstResponse.response || '',
    tokenUsage: firstResponse.tokenUsage,
    metadata: firstResponse.metadata,
  });

  let i = currentIndex + 1;
  while (i < fixtureArtifact.events.length) {
    const evt = fixtureArtifact.events[i];
    
    if (evt.type === 'tool_call') {
      const tc = {
        toolName: evt.tool,
        toolCallId: `call_${evt.id}`,
        args: evt.arguments || {},
      };
      currentStep.toolCalls.push(tc);
      allToolCalls.push(tc);
      recorder.addEvent({ type: 'tool_call', tool: evt.tool, arguments: evt.arguments });
    } else if (evt.type === 'tool_result') {
      const tr = {
        toolName: evt.tool,
        toolCallId: `call_${evt.id}`, // assumes paired ID in real usage, close enough for mock
        result: evt.result,
      };
      currentStep.toolResults.push(tr);
      allToolResults.push(tr);
      recorder.addEvent({ type: 'tool_result', tool: evt.tool, result: evt.result });
    } else if (evt.type === 'model_call') {
      // Vercel auto-multi-step loop continues
      steps.push(currentStep); // Save the previous step
      
      // Consume the internal model_call
      replay.consumeModelCall(evt.model || modelId, evt.messages || []);
      recorder.addEvent({
        type: 'model_call',
        provider: evt.provider,
        model: evt.model,
        messages: evt.messages,
      });
      
    } else if (evt.type === 'model_response') {
      // This is the response for the internal model_call
      
      currentStep = {
        text: evt.response || '',
        toolCalls: [],
        toolResults: [],
        usage: {
          promptTokens: evt.tokenUsage?.input || 0,
          completionTokens: evt.tokenUsage?.output || 0,
          totalTokens: evt.tokenUsage?.total || 0,
        },
        finishReason: (evt.metadata as any)?.finishReason || 'stop',
      };
      
      finalResponseText = evt.response || '';
      finalFinishReason = currentStep.finishReason;

      recorder.addEvent({
        type: 'model_response',
        durationMs: evt.durationMs || 100,
        response: evt.response || '',
        tokenUsage: evt.tokenUsage,
        metadata: evt.metadata,
      });
    } else {
      // Any other event (like agent_end) means the multi-step generation is over
      break;
    }
    i++;
  }
  
  // Push the final step
  if (currentStep.toolCalls.length > 0) {
    currentStep.finishReason = currentStep.finishReason === 'stop' ? 'tool-calls' : currentStep.finishReason;
  }
  steps.push(currentStep);

  // Accumulate usage total across steps
  let totalInput = 0;
  let totalOutput = 0;
  for (const s of steps) {
    totalInput += s.usage.promptTokens;
    totalOutput += s.usage.completionTokens;
  }

  const artifact = recorder.getArtifact();
  if (!artifact.tokenUsage) artifact.tokenUsage = {};
  artifact.tokenUsage.input = (artifact.tokenUsage.input || 0) + totalInput;
  artifact.tokenUsage.output = (artifact.tokenUsage.output || 0) + totalOutput;
  artifact.tokenUsage.total = (artifact.tokenUsage.total || 0) + totalInput + totalOutput;

  if (!artifact.model) {
    artifact.model = { provider, name: modelId };
  }
    
  return {
    text: finalResponseText,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    finishReason: finalFinishReason || (allToolCalls.length > 0 ? 'tool-calls' : 'stop'),
    usage: {
      promptTokens: totalInput,
      completionTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
    },
    steps,
  };
}
