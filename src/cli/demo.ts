import chalk from 'chalk';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifact } from '../validate.js';
import { diffRuns } from '../diff.js';
import { renderDiff } from '../format.js';
import { runRegressionTest } from '../test-engine.js';
import { renderTestResult } from '../test-format.js';
import * as fs from 'node:fs';
import { DEFAULT_CONFIG } from '../test-config.js';

export async function runDemo() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const examplesDir = path.resolve(__dirname, '../../examples');

  const baselinePath = path.join(examplesDir, 'run-a.json');
  const currentPath = path.join(examplesDir, 'run-b.json');

  if (!fs.existsSync(baselinePath) || !fs.existsSync(currentPath)) {
    console.error(chalk.red('Demo artifacts not found. Please ensure examples/run-a.json and examples/run-b.json exist.'));
    process.exit(2);
  }

  console.log(chalk.blue.bold('\nWelcome to the AgentDiff Demo!'));
  console.log('This will show you what happens when an AI agent changes its behavior.\n');
  
  console.log(chalk.dim('Scenario:'));
  console.log('  1. You recorded a baseline agent execution (run-a).');
  console.log('  2. You updated your prompt or model.');
  console.log('  3. You ran the agent again (run-b).\n');
  
  console.log(chalk.bold('Executing: ') + chalk.cyan('agentdiff diff run-a.agentrun run-b.agentrun\n'));

  // Load and diff
  const baselineRaw = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const currentRaw = JSON.parse(fs.readFileSync(currentPath, 'utf-8'));

  const baseline = validateArtifact(baselineRaw, 'run-a.json');
  const current = validateArtifact(currentRaw, 'run-b.json');

  const diff = diffRuns(baseline, current);

  // Render diff
  console.log(renderDiff(diff));

  console.log(chalk.dim('\n------------------------------------------------------------\n'));
  
  console.log(chalk.bold('Executing: ') + chalk.cyan('agentdiff test\n'));
  console.log(chalk.dim('AgentDiff uses this diff in CI to catch unexpected behavioral changes.\n'));

  const testResult = runRegressionTest(diff, DEFAULT_CONFIG);
  console.log(renderTestResult(testResult));

  console.log(chalk.green('\n✓ Demo complete!'));
  console.log('To try it yourself:');
  console.log('  ' + chalk.cyan('agentdiff init'));
}
