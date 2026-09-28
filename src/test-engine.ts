import { type DiffResult } from './diff.js';
import { type TestConfig, DEFAULT_CONFIG } from './test-config.js';

export interface TestViolation {
  category: 'tool' | 'path' | 'error' | 'file' | 'command' | 'model' | 'cost' | 'tokens';
  message: string;
}

export interface TestResult {
  passed: boolean;
  violations: TestViolation[];
  diff: DiffResult; // Embed the original diff for rendering
}

/**
 * Runs a structural regression test by evaluating a DiffResult against a TestConfig.
 */
export function runRegressionTest(diff: DiffResult, config: TestConfig = DEFAULT_CONFIG): TestResult {
  const violations: TestViolation[] = [];

  // evaluate tool usage
  if (config.assertToolUsage !== false) {
    for (const tool of diff.toolUsage) {
       if (tool.change !== 0) {
          violations.push({ category: 'tool', message: `Tool usage changed for "${tool.tool}": ${tool.countA} → ${tool.countB}` });
       }
    }
  }

  // evaluate execution path
  if (config.assertExecutionPath !== false) {
     // Checks for unexpected new errors.
     // Ignores agent_start and agent_end which are bookends.
     const pathA = diff.pathA.filter(s => s.type !== 'agent_start' && s.type !== 'agent_end');
     const pathB = diff.pathB.filter(s => s.type !== 'agent_start' && s.type !== 'agent_end');
     
     let pathDiverged = false;
     if (pathA.length !== pathB.length) {
         pathDiverged = true;
     } else {
         for (let i = 0; i < pathA.length; i++) {
             if (pathA[i].type !== pathB[i].type || pathA[i].label !== pathB[i].label) {
                 pathDiverged = true;
                 break;
             }
         }
     }
     if (pathDiverged) {
         violations.push({ category: 'path', message: 'Execution path diverged structurally' });
     }
  }
  
  // evaluate errors
  if (config.assertErrors !== false) {
     const newErrors = diff.errors.filter(e => !e.inA && e.inB);
     for (const e of newErrors) {
         violations.push({ category: 'error', message: `New error introduced: ${e.error}` });
     }
  }
  
  // evaluate files
  if (config.assertFiles !== false) {
     const newFiles = diff.files.filter(f => !f.inA && f.inB);
     const missedFiles = diff.files.filter(f => f.inA && !f.inB);
     if (newFiles.length > 0 || missedFiles.length > 0) {
         violations.push({ category: 'file', message: 'File access patterns changed' });
     }
  }

  // evaluate commands
  if (config.assertCommands !== false) {
     const newCmds = diff.commands.filter(c => !c.inA && c.inB);
     const missedCmds = diff.commands.filter(c => c.inA && !c.inB);
     if (newCmds.length > 0 || missedCmds.length > 0) {
         violations.push({ category: 'command', message: 'Command execution patterns changed' });
     }
  }

  // evaluate model
  if (config.assertModel === true) {
     if (diff.metadata.modelName !== null || diff.metadata.modelProvider !== null) {
         violations.push({ category: 'model', message: 'Model or provider changed' });
     }
  }
  
  // evaluate cost
  if (config.assertCost) {
     const costA = diff.cost.total?.a ?? 0;
     const costB = diff.cost.total?.b ?? 0;
     
     if (config.assertCost.maxTotal !== undefined && costB > config.assertCost.maxTotal) {
         violations.push({ category: 'cost', message: `Cost ${costB.toFixed(4)} exceeded max total ${config.assertCost.maxTotal}` });
     }
     if (config.assertCost.maxIncreasePct !== undefined && costA > 0) {
         const pct = ((costB - costA) / costA) * 100;
         if (pct > config.assertCost.maxIncreasePct) {
             violations.push({ category: 'cost', message: `Cost increased by ${pct.toFixed(1)}%, exceeding max ${config.assertCost.maxIncreasePct}%` });
         }
     }
  }

  // evaluate tokens
  if (config.assertTokens) {
     const tokA = diff.tokens.totalTokens?.a ?? 0;
     const tokB = diff.tokens.totalTokens?.b ?? 0;
     
     if (config.assertTokens.maxTotal !== undefined && tokB > config.assertTokens.maxTotal) {
         violations.push({ category: 'tokens', message: `Total tokens ${tokB} exceeded max ${config.assertTokens.maxTotal}` });
     }
     if (config.assertTokens.maxIncreasePct !== undefined && tokA > 0) {
         const pct = ((tokB - tokA) / tokA) * 100;
         if (pct > config.assertTokens.maxIncreasePct) {
             violations.push({ category: 'tokens', message: `Tokens increased by ${pct.toFixed(1)}%, exceeding max ${config.assertTokens.maxIncreasePct}%` });
         }
     }
  }

  return { passed: violations.length === 0, violations, diff };
}
