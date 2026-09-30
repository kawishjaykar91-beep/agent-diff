# AgentDiff

[![npm version](https://img.shields.io/npm/v/@kawish-jaykar/agentdiff.svg)](https://www.npmjs.com/package/@kawish-jaykar/agentdiff)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Git diff for AI-agent behavior.**

AgentDiff is a local-first CLI for detecting behavioral changes in AI agents.

AI agents are unpredictable. Standard unit tests often fail to catch when an agent starts looping, hallucinating new tools, or taking wildly different execution paths.

AgentDiff solves this by intercepting your agent's API calls, saving them to a JSON file (`.agentrun`), and performing structural, Git-like diffs on its behavior.

```text
AgentDiff
----------------------------

X Behavioral regression

Execution path:
  baseline: start -> model -> response -> search_files -> model -> response -> end
  current:  start -> model -> response -> search_files -> search_files -> error -> end

Tool usage:
  search_files: 1 -> 2

Errors:
  0 -> 1
----------------------------
```

## Installation

```bash
npm install @kawish-jaykar/agentdiff
```

## Quick Start

Experience it instantly in your terminal without any API keys or configuration:

```bash
npx agentdiff demo
```
*This command loads two offline example traces and demonstrates a behavioral diff and CI regression failure.*

---

## Core Capabilities

- **Record:** Intercepts LLM SDK calls and saves them as versioned `.agentrun` artifacts.
- **Diff:** Compares structural execution paths between two runs to visually highlight behavioral drift.
- **Test:** Automatically asserts that a new agent execution hasn't diverged from a known-good baseline in CI.
- **Replay:** Virtualizes the LLM responses completely offline, allowing deterministic re-execution of agent logic.

## Architecture

```text
RECORD -> DIFF -> SAVE FIXTURE -> TEST -> REPLAY
```

## Positioning

AgentDiff focuses entirely on **Git-native, structural behavioral regression testing** for developers.

It is deliberately **NOT**:
- A hosted observability dashboard.
- A tracing SaaS platform.
- A general-purpose prompt-evaluation tool.

By remaining local-first and CLI-driven, AgentDiff integrates seamlessly into existing CI/CD pipelines without sending data to third-party services.

---

## The Git-Native Workflow

### 1. RECORD
AgentDiff intercepts API calls at the SDK layer. Initialize a recorder and wrap your client.

**OpenAI:**
```typescript
import { AgentRecorder, wrapOpenAI } from '@kawish-jaykar/agentdiff';
import { OpenAI } from 'openai';

const recorder = new AgentRecorder({ name: 'my-agent' });
const client = wrapOpenAI(new OpenAI(), recorder);

// ... your agent code uses client normally ...

await recorder.save(); // saves to .agentdiff/runs/<run-id>.agentrun
```

**Anthropic:**
```typescript
import { AgentRecorder, wrapAnthropic } from '@kawish-jaykar/agentdiff';
import { Anthropic } from '@anthropic-ai/sdk';

const recorder = new AgentRecorder({ name: 'my-agent' });
const client = wrapAnthropic(new Anthropic(), recorder);

// ... your agent code uses client normally ...

await recorder.save();
```

**Vercel AI SDK:**
```typescript
import { generateText } from 'ai';
import { AgentRecorder, recordGenerateText } from '@kawish-jaykar/agentdiff';

const recorder = new AgentRecorder({ name: 'my-agent' });

// Wrap generateText -- note: Vercel AI SDK uses wrapper functions,
// not client monkey-patching, because it uses free functions.
const result = await recordGenerateText(recorder, generateText, {
  model: openai('gpt-4o'),
  prompt: 'What is the capital of France?',
});

await recorder.save();
```

### 2. DIFF
When you change your code or prompt, record a new run and compare it against your baseline:

```bash
npx agentdiff diff .agentdiff/fixtures/baseline.agentrun .agentdiff/runs/<run-id>.agentrun
```

### 3. SAVE FIXTURE
Once you are happy with a run, promote it to a regression fixture and commit it to your repository:

```bash
npx agentdiff fixture save .agentdiff/runs/<run-id>.agentrun baseline
git add .agentdiff/fixtures/baseline.agentrun
```

### 4. TEST
In your CI pipeline, automatically assert that your latest agent execution hasn't structurally diverged:

```bash
npx agentdiff test
```
AgentDiff ignores timestamps and IDs, failing your pipeline only if the execution path diverges, new errors appear, or unexpected tools are called.

Machine-readable JSON output for CI integrations:
```bash
npx agentdiff test --json
```

### 5. REPLAY
Debug complex agent logic offline. Replay intercepts LLM SDK calls and deterministically returns the exact model responses recorded in the fixture:

```bash
npx agentdiff replay .agentdiff/fixtures/baseline.agentrun npx tsx my-agent.ts
```

Or use the environment variable for automatic replay in code:
```bash
AGENTDIFF_REPLAY_FIXTURE=.agentdiff/fixtures/baseline.agentrun npx tsx my-agent.ts
```

---

## Supported Providers

| Provider | Recording | Replay | Streaming |
|----------|-----------|--------|-----------|
| **OpenAI** (`wrapOpenAI`) | Yes | Yes | Yes |
| **Anthropic** (`wrapAnthropic`) | Yes | Yes | Yes |
| **Vercel AI SDK** (`recordGenerateText`) | Yes | Yes | -- |
| **Vercel AI SDK** (`recordStreamText`) | Yes | Yes | Yes |

### Vercel AI SDK Notes

The Vercel AI SDK uses free functions (`generateText`, `streamText`) rather than a client instance. AgentDiff therefore provides **explicit wrapper functions** instead of monkey-patching a client:

- `recordGenerateText(recorder, generateText, options)` -- records `generateText` calls
- `recordStreamText(recorder, streamText, options)` -- records `streamText` calls

Currently supported Vercel AI SDK functions:
- `generateText` -- supported
- `streamText` -- supported
- `generateObject` -- not currently supported
- `streamObject` -- not currently supported

---

## Streaming Support

AgentDiff supports recording and deterministically replaying `stream: true` responses for OpenAI, Anthropic, and Vercel AI SDK `streamText`.

The developer experience remains identical. AgentDiff intercepts the async generator, observes the streamed chunks to reconstruct the final response and tool calls, and yields the chunks back to your application transparently.

During **replay**, AgentDiff deterministically emits the reconstructed response as mocked stream chunks, allowing your `for await` loops to function completely offline without any code changes.

---

## Replay

### How It Works

When `AGENTDIFF_REPLAY_FIXTURE` is set, the recording adapters (`wrapOpenAI`, `wrapAnthropic`, `recordGenerateText`, `recordStreamText`) automatically switch to replay mode. No code changes are needed.

Replay intercepts only the LLM SDK layer. It does **not** virtualize:
- Your application's tool/function execution
- File system access
- Database queries
- Arbitrary HTTP/fetch calls
- External services

### Mismatch Protection

Replay enforces structural matching between the fixture and the current execution:

- **Model mismatch:** If the code requests a different model than the fixture recorded, a `ReplayMismatchError` is thrown.
- **Prompt mismatch:** If the initial user prompt differs from the fixture, a `ReplayMismatchError` is thrown.
- **Execution path mismatch:** If the code makes more model calls than the fixture contains, a `ReplayMismatchError` is thrown.

This prevents silently returning unrelated fixture data when the agent's behavior has changed.

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Agent Regression Test
on: [push, pull_request]

jobs:
  agent-test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: 'npm'
    - run: npm ci
    - run: npm run build

    # Run your agent (produces .agentrun artifact)
    - run: npx tsx my-agent.ts

    # Regression test against committed fixture
    - run: npx agentdiff test
```

`agentdiff test` exits with code 0 if the execution path matches the fixture, and code 1 if a structural behavioral regression is detected. This makes it directly usable as a CI gate.

**What it detects:** execution path divergence, new/removed tool calls, new errors, and unexpected cost changes.

**What it does not detect:** semantic content changes in model responses (e.g., different wording with the same structure).

---

## Privacy and Security

AgentDiff is strictly local-first. No data is transmitted anywhere.

**Important:** `.agentrun` artifacts capture your prompts, model responses, and tool arguments in plain text. They may contain sensitive application content.

**What is NOT stored:** API keys, authorization headers, and SDK client configuration objects are never serialized into artifacts.

**What IS stored:** User prompts, system prompts, model responses, tool call arguments, tool results, token usage, and model/provider identifiers.

**Recommendations:**
- Add `.agentdiff/runs/` to `.gitignore` (done by `agentdiff init`)
- Inspect fixtures before committing them to a public repository
- Use sanitized/synthetic prompts for fixtures committed to public repos
- Never commit artifacts containing production PII, secrets, or credentials

---

## Limitations

- **External Side Effects:** Replay does not virtualize your file system, database, or network calls -- only the LLM SDK is mocked.
- **Vercel AI SDK Coverage:** Only `generateText` and `streamText` are currently supported. `generateObject`, `streamObject`, middleware, and hooks are not yet supported.
- **Streaming Speed:** During replay, streaming chunks are emitted as fast as possible rather than simulating artificial network latency.
- **Complex Topologies:** Highly complex nested/parallel agent architectures are flattened into chronological execution traces.
- **Content Matching:** Regression tests detect structural behavioral changes (execution path, tool usage, errors), not semantic content differences in model responses.

---

## CLI Reference

```
agentdiff init                              # Initialize project configuration
agentdiff demo                              # Run offline demo
agentdiff doctor                            # Check environment health
agentdiff list                              # List recent runs and fixtures
agentdiff inspect [run]                     # View details of a run artifact
agentdiff diff <run-a> <run-b>              # Structurally compare two runs
agentdiff diff <run-a> <run-b> --json       # Output diff as JSON
agentdiff fixture save <run> [name]         # Save a run as a regression fixture
agentdiff test [expected] [actual]          # Run structural regression test
agentdiff test --json                       # Output test result as JSON
agentdiff replay <fixture> [command...]     # Execute agent code with fixture replay
```

---

## Contributing
We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to run tests, add new providers, and submit pull requests.
