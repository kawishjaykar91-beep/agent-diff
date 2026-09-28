import { streamText } from 'ai';

async function main() {
  const result = streamText({
    model: 'mock' as any,
    prompt: 'test',
    onFinish: (event) => {
      // Intentionally causing a type error to inspect `event` type
      const e: typeof event = null as any;
    }
  });
}
