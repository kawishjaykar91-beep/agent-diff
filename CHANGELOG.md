# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-09-28

### Added
- Core `.agentrun` schema (v0.1) for provider-neutral execution traces.
- `AgentRecorder` for programmatic event recording.
- `agentdiff diff` for structural comparison of two agent executions.
- `agentdiff test` for CI regression assertions (exit code 0/1).
- `agentdiff replay` for offline deterministic replay.
- `agentdiff demo` for zero-config interactive demo.
- `agentdiff doctor` for environment health checks.
- `agentdiff init` for project initialization.
- `agentdiff inspect` for viewing run artifact details.
- `agentdiff fixture save` for promoting runs to regression baselines.
- `agentdiff list` for listing recent runs and fixtures.
- OpenAI recording and replay adapter (`wrapOpenAI`).
- Anthropic recording and replay adapter (`wrapAnthropic`).
- Vercel AI SDK recording and replay (`recordGenerateText`, `recordStreamText`).
- Streaming support for OpenAI, Anthropic, and Vercel AI SDK `streamText`.
- Replay mismatch protection for model, prompt, and execution path divergence.
- LCS-based execution path alignment for structural diffing.
- JSON output mode for CI integration (`--json`).
- Git-native fixture workflow (record, save, commit, test).
- GitHub Actions CI workflow.

### Security
- API keys and authorization headers are never serialized into `.agentrun` artifacts.
- All data remains local; no telemetry or network transmission.
