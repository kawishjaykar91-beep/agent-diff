import * as fs from 'node:fs';
import * as path from 'node:path';
import { type TestConfig, DEFAULT_CONFIG } from './test-config.js';

export interface AgentDiffConfig {
  runsDir: string;
  fixturesDir: string;
  testRules: TestConfig;
}

export const DEFAULT_PROJECT_CONFIG: AgentDiffConfig = {
  runsDir: '.agentdiff/runs',
  fixturesDir: '.agentdiff/fixtures',
  testRules: DEFAULT_CONFIG
};

export function loadConfig(cwd: string = process.cwd()): AgentDiffConfig {
  const configPath = path.join(cwd, 'agentdiff.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        runsDir: parsed.runsDir || DEFAULT_PROJECT_CONFIG.runsDir,
        fixturesDir: parsed.fixturesDir || DEFAULT_PROJECT_CONFIG.fixturesDir,
        testRules: { ...DEFAULT_CONFIG, ...(parsed.testRules || {}) }
      };
    } catch (err) {
      console.error(`Warning: Failed to parse agentdiff.config.json. Using defaults.`);
    }
  }
  return DEFAULT_PROJECT_CONFIG;
}

export function initProject(cwd: string = process.cwd()) {
  const configPath = path.join(cwd, 'agentdiff.config.json');
  if (fs.existsSync(configPath)) {
    throw new Error('agentdiff.config.json already exists.');
  }

  const runsDir = path.join(cwd, DEFAULT_PROJECT_CONFIG.runsDir);
  const fixturesDir = path.join(cwd, DEFAULT_PROJECT_CONFIG.fixturesDir);

  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });

  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2));
}

/** Utility to find the most recent run in the runs directory */
export function getLatestRun(config: AgentDiffConfig, cwd: string = process.cwd()): string | null {
  const runsDir = path.join(cwd, config.runsDir);
  if (!fs.existsSync(runsDir)) return null;

  const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.agentrun') || f.endsWith('.json'));
  if (files.length === 0) return null;

  // Sort by modification time descending
  files.sort((a, b) => {
    const statA = fs.statSync(path.join(runsDir, a));
    const statB = fs.statSync(path.join(runsDir, b));
    return statB.mtimeMs - statA.mtimeMs;
  });

  return path.join(runsDir, files[0]);
}

/** Utility to list runs */
export function listArtifacts(dir: string, cwd: string = process.cwd()): string[] {
  const fullDir = path.join(cwd, dir);
  if (!fs.existsSync(fullDir)) return [];
  const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.agentrun') || f.endsWith('.json'));
  files.sort((a, b) => {
    const statA = fs.statSync(path.join(fullDir, a));
    const statB = fs.statSync(path.join(fullDir, b));
    return statB.mtimeMs - statA.mtimeMs;
  });
  return files.map(f => path.join(fullDir, f));
}
