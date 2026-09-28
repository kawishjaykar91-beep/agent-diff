export interface TestConfig {
  /** Fail if the usage counts of any tools change */
  assertToolUsage?: boolean;
  
  /** Fail if the sequence of meaningful execution steps diverges */
  assertExecutionPath?: boolean;
  
  /** Fail if new errors are introduced in the actual run */
  assertErrors?: boolean;
  
  /** Fail if file read/write targets change */
  assertFiles?: boolean;
  
  /** Fail if command execution patterns change */
  assertCommands?: boolean;
  
  /** Fail if the AI model or provider changes */
  assertModel?: boolean;
  
  /** Thresholds for execution cost */
  assertCost?: {
    maxIncreasePct?: number; // e.g., 50 for +50% max cost increase
    maxTotal?: number; // e.g., 0.05 for max $0.05 total cost
  };
  
  /** Thresholds for token usage */
  assertTokens?: {
    maxIncreasePct?: number;
    maxTotal?: number;
  };
}

export const DEFAULT_CONFIG: TestConfig = {
  assertToolUsage: true,
  assertExecutionPath: true,
  assertErrors: true,
  assertFiles: true,
  assertCommands: true,
  assertModel: false, // We often want to test a new model against an old model's trace
};
