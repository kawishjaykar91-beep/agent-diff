// ---------------------------------------------------------------------------
// Public API surface
//
// Re-exports the core library so consumers can:
//   import { validateArtifact, diffRuns } from 'agentdiff';
// ---------------------------------------------------------------------------

export { SCHEMA_VERSION, type RunArtifact, type RunEvent, type EventType, type AgentInfo, type ModelInfo, type RunResult, type TokenSummary, type CostSummary } from './schema.js';
export { validateArtifact, ValidationError } from './validate.js';
export { AgentRecorder } from './recorder/index.js';
export { wrapOpenAI } from './recorder/openai.js';
export { wrapAnthropic } from './recorder/anthropic.js';
export { recordGenerateText, recordStreamText } from './recorder/vercel-ai.js';
export { runRegressionTest, type TestResult, type TestViolation } from './test-engine.js';
export { DEFAULT_CONFIG, type TestConfig } from './test-config.js';
export { AgentReplay, ReplayMismatchError } from './replay/index.js';
export { wrapOpenAIForReplay } from './replay/openai.js';
export { wrapAnthropicForReplay } from './replay/anthropic.js';
export { replayGenerateText, replayStreamText } from './replay/vercel-ai.js';
export { loadConfig, initProject, type AgentDiffConfig } from './config.js';
