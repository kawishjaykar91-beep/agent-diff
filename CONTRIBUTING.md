# Contributing to AgentDiff

First off, thank you for considering contributing to AgentDiff!

## Project Structure

- `src/schema.ts`: Core data structures. Do not change these lightly! Backward compatibility is critical.
- `src/validate.ts`: Strict schema validation.
- `src/diff.ts`: The semantic differ.
- `src/align.ts`: LCS-based execution path alignment.
- `src/recorder/`: `AgentRecorder` and provider-specific adapters (`openai.ts`, `anthropic.ts`, `vercel-ai.ts`).
- `src/replay/`: Offline deterministic replay logic for each provider.
- `src/test-engine.ts`: CI regression assertions.
- `src/cli/`: The `agentdiff` command-line application.

## Local Setup

1. Clone the repository
2. Ensure you have Node.js 18 or later.
3. Install dependencies: `npm install`
4. Build the project: `npm run build`

## Development Workflow

- Run tests: `npm test`
- Typecheck: `npm run lint`
- Auto-run tests on change: `npm run test:watch`

## Adding a New Event Type

If you propose a new event type for `.agentrun`:
1. Add it to `EventType` and `RunEvent` in `src/schema.ts`.
2. Update the JSON schema in `src/validate.ts`.
3. Explain the rationale in your PR.

## Adding a Provider Adapter

To add support for a new provider:
1. Implement a new file in `src/recorder/` exporting an interceptor (e.g. `wrapMyProvider`).
2. Add offline mock tests to `src/recorder/__tests__/`.
3. Add a replay adapter to `src/replay/`.
4. Export the new adapter from `src/index.ts`.
5. Update the Supported Providers table in `README.md`.

## Code Style

- We use TypeScript and ES Modules (`"type": "module"`).
- We avoid dependencies whenever possible to keep the tool fast.
- We strictly avoid magical runtime interception (e.g. `nock` or monkey-patching HTTP directly for end-user execution). Prefer explicit client-wrapping APIs.
