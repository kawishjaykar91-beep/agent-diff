import type { TestResult } from './test-engine.js';
import chalk from 'chalk';

export function renderTestResult(result: TestResult): string {
  if (result.passed) {
    return chalk.green.bold('✓ Regression test passed (0 violations)\n');
  }

  let out = chalk.bold('AgentDiff') + '\n';
  out += chalk.dim('────────────────────────────') + '\n\n';
  out += chalk.red.bold('✗ Behavioral regression') + '\n\n';

  const diff = result.diff;
  
  // Execution path comparison
  out += chalk.bold('Execution path:') + '\n';
  out += `  baseline: ${chalk.dim(diff.pathA.map(p => p.label).join(' → ') || 'none')}\n`;
  out += `  current:  ${chalk.dim(diff.pathB.map(p => p.label).join(' → ') || 'none')}\n\n`;

  // Tool Usage
  out += chalk.bold('Tool usage:') + '\n';
  if (diff.toolUsage.length === 0) {
    out += chalk.dim('  (no tools used)\n');
  } else {
    for (const t of diff.toolUsage) {
      if (t.countA !== t.countB) {
         out += `  ${t.tool}: ${t.countA} → ${t.countB}\n`;
      }
    }
  }
  out += '\n';

  // Errors
  out += chalk.bold('Errors:') + '\n';
  out += `  ${diff.errors.filter(e => e.inA).length} → ${diff.errors.filter(e => e.inB).length}\n\n`;

  // Cost
  out += chalk.bold('Cost:') + '\n';
  out += `  $${(diff.cost.total?.a || 0).toFixed(2)} → $${(diff.cost.total?.b || 0).toFixed(2)}\n\n`;

  out += chalk.dim('────────────────────────────') + '\n\n';
  out += `Run:\n\n  ${chalk.cyan('agentdiff diff baseline.agentrun current.agentrun')}\n\nfor the complete structural diff.\n`;

  return out;
}
