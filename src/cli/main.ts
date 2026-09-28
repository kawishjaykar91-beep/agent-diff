#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'node:fs';
import { validateArtifact } from '../validate.js';
import { diffRuns } from '../diff.js';
import { renderDiff, renderDiffJson } from '../format.js';
import chalk from 'chalk';
import * as path from 'node:path';
import { loadConfig, initProject, listArtifacts, getLatestRun } from '../config.js';
import type { RunArtifact } from '../schema.js';

function loadArtifact(filepath: string): RunArtifact {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    return validateArtifact(JSON.parse(content), filepath);
  } catch (err: any) {
    console.error(chalk.red(`Failed to load artifact ${filepath}: ${err.message}`));
    process.exit(2);
  }
}

async function main() {
  const program = new Command();
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  const config = loadConfig();

  program
    .name('agentdiff')
    .description('Git + pytest + debugger for AI-agent execution.')
    .version(pkg.version);

  program
    .command('init')
    .description('Initialize the current directory with AgentDiff configuration')
    .action(() => {
      try {
        initProject();
        console.log(chalk.green('✓ Created agentdiff configuration.'));
        console.log('\nNext steps:');
        console.log(`  1. Record an execution: ${chalk.cyan('Run your agent (wrapped with AgentRecorder)')}`);
        console.log(`  2. Inspect the artifact: ${chalk.cyan('agentdiff inspect')}`);
        console.log(`  3. Save a baseline:      ${chalk.cyan('agentdiff fixture save <run> baseline')}`);
        console.log(`  4. Run a regression:     ${chalk.cyan('agentdiff test')}`);
        console.log(`  5. CI integration:       ${chalk.cyan('agentdiff test --json')}`);
      } catch (err: any) {
        console.error(chalk.red('Failed to initialize:'), err.message);
        process.exit(2);
      }
    });

  program
    .command('list')
    .description('List recently recorded runs and test fixtures')
    .action(() => {
      console.log(chalk.bold('Recorded Runs:'));
      const runs = listArtifacts(config.runsDir);
      if (runs.length === 0) console.log(chalk.dim('  (No runs found. Record an agent execution first.)'));
      for (const r of runs.slice(0, 5)) {
         const artifact = loadArtifact(r);
         console.log(`  ${chalk.cyan(path.relative(process.cwd(), r))} - ${new Date(artifact.timestamp).toLocaleString()}`);
      }
      
      console.log(chalk.bold('\nRegression Fixtures:'));
      const fixtures = listArtifacts(config.fixturesDir);
      if (fixtures.length === 0) console.log(chalk.dim('  (No fixtures found. Use `agentdiff fixture save` to create one.)'));
      for (const f of fixtures) {
         const artifact = loadArtifact(f);
         console.log(`  ${chalk.cyan(path.relative(process.cwd(), f))} - ${new Date(artifact.timestamp).toLocaleString()}`);
      }
    });

  const fixtureCmd = program.command('fixture').description('Manage regression test fixtures');
  
  fixtureCmd
    .command('save <run> [name]')
    .description('Save a run as a regression fixture')
    .action((runPath: string, name?: string) => {
      try {
         const artifact = loadArtifact(runPath); // ensures it exists and is valid
         if (!fs.existsSync(config.fixturesDir)) {
            fs.mkdirSync(config.fixturesDir, { recursive: true });
         }
         const destName = name ? (name.endsWith('.agentrun') ? name : `${name}.agentrun`) : path.basename(runPath);
         const destPath = path.join(config.fixturesDir, destName);
         fs.copyFileSync(runPath, destPath);
         console.log(chalk.green(`✓ Saved fixture to ${destPath}`));
      } catch (err: any) {
         console.error(chalk.red(`Failed to save fixture: ${err.message}`));
         process.exit(2);
      }
    });

  program
    .command('diff <run-a> <run-b>')
    .description('Structurally compare two agent executions (run-a vs run-b)')
    .option('--json', 'Output raw JSON diff instead of terminal UI')
    .action((runAPath: string, runBPath: string, options: any) => {
      const a = loadArtifact(runAPath);
      const b = loadArtifact(runBPath);
      const result = diffRuns(a, b);
      if (options.json) {
        console.log(renderDiffJson(result));
      } else {
        console.log(renderDiff(result));
      }
    });

  program
    .command('inspect [run]')
    .description('View details of a single agent execution artifact (defaults to most recent run)')
    .option('--json', 'Output raw artifact JSON instead of terminal UI')
    .action((runPath?: string, options?: any) => {
      const target = runPath || getLatestRun(config);
      if (!target) {
        console.error(chalk.red('✗ No run found to inspect.'));
        console.error(chalk.dim('\nWhat happened?'));
        console.error('AgentDiff looked for recent runs in your configuration directory but found nothing.');
        console.error(chalk.dim('\nWhat to do next:'));
        console.error(`1. Run your agent wrapped with AgentRecorder to generate an execution trace.`);
        console.error(`2. Run ${chalk.cyan('agentdiff list')} to verify it was saved.`);
        process.exit(2);
      }

      const artifact = loadArtifact(target);
      
      if (options?.json) {
         console.log(JSON.stringify(artifact, null, 2));
         return;
      }
      console.log(`\n${chalk.bold('Artifact:')} ${target}`);
      console.log(`${chalk.bold('Run ID:')}   ${artifact.runId}`);
      console.log(`${chalk.bold('Date:')}     ${new Date(artifact.timestamp).toLocaleString()}`);
      console.log(`${chalk.bold('Agent:')}    ${artifact.agent.name} ${artifact.agent.version || ''}`);
      if (artifact.model) {
        console.log(`${chalk.bold('Model:')}    ${artifact.model.provider} / ${artifact.model.name}`);
      }
      
      const statusColor = artifact.result?.status === 'success' ? chalk.green : artifact.result?.status === 'error' ? chalk.red : chalk.yellow;
      console.log(`${chalk.bold('Status:')}   ${statusColor(artifact.result?.status || 'unknown')}`);
      console.log(`${chalk.bold('Duration:')} ${((artifact.durationMs || 0) / 1000).toFixed(1)}s`);
      if (artifact.tokenUsage) {
        console.log(`${chalk.bold('Tokens:')}   ${artifact.tokenUsage.total}`);
      }
      if (artifact.cost) {
        console.log(`${chalk.bold('Cost:')}     $${artifact.cost.total}`);
      }
      
      const toolCalls = artifact.events.filter((e: any) => e.type === 'tool_call');
      const fileReads = artifact.events.filter((e: any) => e.type === 'file_read');
      const fileWrites = artifact.events.filter((e: any) => e.type === 'file_write');
      const errors = artifact.events.filter((e: any) => e.type === 'error');
      
      console.log(`\n${chalk.bold('Summary:')}`);
      console.log(`  Tools called: ${toolCalls.length}`);
      console.log(`  Files read:   ${fileReads.length}`);
      console.log(`  Files written:${fileWrites.length}`);
      console.log(`  Errors:       ${errors.length}`);
      console.log('');
    });

  program
    .command('test [expected-run] [actual-run]')
    .description('Run a structural regression test (defaults to fixtures vs latest run)')
    .option('--json', 'Output test result as JSON')
    .action(async (expectedPath?: string, actualPath?: string, options?: any) => {
      let expected = expectedPath;
      if (!expected) {
        const fixtures = listArtifacts(config.fixturesDir);
        if (fixtures.length === 0) {
           console.error(chalk.red('✗ No regression fixture found.'));
           console.error(chalk.dim('\nWhat happened?'));
           console.error('You tried to run a regression test, but AgentDiff needs a baseline fixture to compare against.');
           console.error(chalk.dim('\nWhat to do next:'));
           console.error(`1. Find a successful recent run: ${chalk.cyan('agentdiff list')}`);
           console.error(`2. Save it as a baseline:        ${chalk.cyan('agentdiff fixture save <run> baseline')}`);
           console.error(`3. Run the test again:           ${chalk.cyan('agentdiff test')}`);
           process.exit(2);
        }
        expected = fixtures[0];
      }

      let actual = actualPath;
      if (!actual) {
        actual = getLatestRun(config) || undefined;
        if (!actual) {
           console.error(chalk.red('✗ No recent run found to test against the fixture.'));
           console.error(chalk.dim('\nWhat happened?'));
           console.error('AgentDiff found your baseline fixture, but could not find a new run to test it against.');
           console.error(chalk.dim('\nWhat to do next:'));
           console.error(`1. Execute your agent to generate a new run.`);
           console.error(`2. Run the test again: ${chalk.cyan('agentdiff test')}`);
           process.exit(2);
        }
      }

      console.log(chalk.dim(`Testing: ${actual} against fixture ${expected}...`));

      const expectedArtifact = loadArtifact(expected);
      const actualArtifact = loadArtifact(actual!);
      
      const diff = diffRuns(expectedArtifact, actualArtifact);
      
      const { runRegressionTest } = await import('../test-engine.js');
      const { renderTestResult } = await import('../test-format.js');
      
      const testResult = runRegressionTest(diff, config.testRules);
      
      if (options?.json) {
         console.log(JSON.stringify({ 
           passed: testResult.passed, 
           violations: testResult.violations,
           diff: {
             executionPath: {
               baseline: diff.pathA.map(p => p.label),
               current: diff.pathB.map(p => p.label)
             },
             toolUsage: diff.toolUsage,
             errors: {
               baseline: diff.errors.filter(e => e.inA).length,
               current: diff.errors.filter(e => e.inB).length
             },
             cost: {
               baseline: diff.cost.total?.a,
               current: diff.cost.total?.b
             }
           }
         }, null, 2));
      } else {
         console.log(renderTestResult(testResult));
      }
      
      if (!testResult.passed) {
        process.exit(1);
      }
    });

  program
    .command('replay <fixture> [command...]')
    .description('Execute agent code offline by supplying deterministic model responses from a fixture')
    .action(async (fixture: string, command: string[]) => {
      if (!command || command.length === 0) {
        console.error(chalk.red('✗ Missing command to replay.'));
        console.error(chalk.dim('\nWhat happened?'));
        console.error('You provided a fixture, but no command to execute.');
        console.error(chalk.dim('\nWhat to do next:'));
        console.error(`Provide the command you use to run your agent, e.g.:`);
        console.error(`  ${chalk.cyan(`agentdiff replay ${fixture} npx tsx my-agent.ts`)}`);
        process.exit(2);
      }

      try {
        loadArtifact(fixture);
      } catch (err: any) {
        console.error('Failed to validate fixture:', err.message);
        process.exit(2);
      }

      console.log(`\n${chalk.blue.bold('--- DETERMINISTIC REPLAY MODE ---')}`);
      console.log(`Initializing replay using fixture: ${fixture}`);
      console.log(`Executing offline: ${command.join(' ')}\n`);

      const { spawn } = await import('node:child_process');
      const child = spawn(command[0], command.slice(1), {
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          AGENTDIFF_REPLAY_FIXTURE: fixture
        }
      });

      child.on('exit', (code) => {
        if (code === 0) {
          console.log(chalk.green('\nReplay finished successfully.'));
        } else {
          console.log(chalk.red(`\nReplay failed with exit code ${code}. Check for ReplayMismatchErrors.`));
        }
        process.exit(code ?? 1);
      });
    });

  program
    .command('doctor')
    .description('Check AgentDiff installation, configuration, and environment')
    .action(() => {
      console.log(chalk.bold('AgentDiff Doctor\n'));
      
      let issues = 0;
      
      console.log('Environment:');
      console.log(`  Node.js: ${process.version}`);
      console.log(`  AgentDiff: v${pkg.version}`);
      console.log(`  Platform: ${process.platform}\n`);

      console.log('Configuration:');
      try {
         const configPath = path.join(process.cwd(), '.agentdiff');
         if (fs.existsSync(configPath)) {
            console.log(`  ✓ .agentdiff directory exists`);
            if (fs.existsSync(path.join(configPath, 'runs'))) {
               console.log(`  ✓ .agentdiff/runs exists`);
            } else {
               console.log(chalk.yellow(`  ! .agentdiff/runs missing (Will be created automatically)`));
            }
            if (fs.existsSync(path.join(configPath, 'fixtures'))) {
               console.log(`  ✓ .agentdiff/fixtures exists`);
            } else {
               console.log(chalk.yellow(`  ! .agentdiff/fixtures missing (Will be created when you save a fixture)`));
            }
         } else {
            console.log(chalk.red(`  ✗ .agentdiff directory missing`));
            console.log(chalk.dim(`    Run 'agentdiff init' to create it.`));
            issues++;
         }
      } catch (err: any) {
         console.log(chalk.red(`  ✗ Failed to read config: ${err.message}`));
         issues++;
      }

      console.log('\nDiagnostic summary:');
      if (issues === 0) {
         console.log(chalk.green('  ✓ Your AgentDiff environment looks healthy.'));
      } else {
         console.log(chalk.red(`  ✗ Found ${issues} potential issue(s).`));
      }
    });

  program.action(() => {
    console.log(chalk.bold('AgentDiff'));
    console.log('Git diff for AI-agent behavior.\n');
    console.log(chalk.bold('Quick start:'));
    console.log('  agentdiff init');
    console.log('  agentdiff demo');
    console.log('  agentdiff inspect');
    console.log('  agentdiff fixture save <run> baseline');
    console.log('  agentdiff test\n');
    console.log(chalk.bold('Useful commands:'));
    console.log('  agentdiff diff');
    console.log('  agentdiff list');
    console.log('  agentdiff replay');
  });

  program
    .command('demo')
    .description('Run an offline 30-second demo of AgentDiff')
    .action(async () => {
      const { runDemo } = await import('./demo.js');
      await runDemo();
    });

  await program.parseAsync(process.argv);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
