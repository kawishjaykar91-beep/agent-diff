import { streamText, simulateReadableStream } from 'ai';

async function main() {
  const result = streamText({
    model: {
      specificationVersion: 'v3',
      provider: 'mock-provider',
      modelId: 'mock-model',
      async doStream() {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', textDelta: 'Hello' },
              { type: 'text-delta', textDelta: ' world!' },
              { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } }
            ]
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    } as any,
    prompt: 'test',
  });

  // Await promises in the background
  result.text.then((t: any) => console.log('Promise text:', t));
  result.usage.then((u: any) => console.log('Promise usage:', u));
  result.steps.then((s: any) => console.log('Promise steps:', s));

  // See if textStream still works
  for await (const chunk of result.textStream) {
    console.log('Stream chunk:', chunk);
  }
}

main().catch(console.error);
