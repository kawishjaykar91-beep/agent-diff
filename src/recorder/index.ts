import { v4 as uuidv4 } from 'uuid';
import type { RunArtifact, RunEvent, AgentInfo } from '../schema.js';
import * as fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config.js';
export class AgentRecorder {
  private artifact: RunArtifact;
  private hasEnded: boolean = false;

  constructor(agent: AgentInfo, input?: string) {
    this.artifact = {
      version: '0.1',
      runId: `run-${uuidv4()}`,
      timestamp: new Date().toISOString(),
      agent,
      input,
      events: [],
      metadata: {}
    };
    this.addEvent({ type: 'agent_start' });
  }

  /**
   * Adds an event to the current run.
   */
  addEvent(event: Omit<RunEvent, 'id' | 'timestamp'> & { timestamp?: string }) {
    if (this.hasEnded && event.type !== 'error') {
      // Allow trailing errors, but otherwise warn or ignore
      console.warn(`[AgentDiff] Warning: Event ${event.type} added after run ended.`);
    }
    this.artifact.events.push({
      id: `evt-${uuidv4()}`,
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event
    });
  }

  /**
   * Records an error that occurred outside of the model wrapper.
   */
  recordError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const type = error instanceof Error ? error.name : 'UnknownError';
    this.addEvent({
      type: 'error',
      error: message,
      errorType: type,
      recoverable: false
    });
  }

  /**
   * Marks the run as complete and records the final duration.
   * This method is idempotent.
   */
  endRun(status: string = 'success', output?: unknown) {
    if (this.hasEnded) return;

    this.artifact.result = { status, output };
    this.addEvent({ type: 'agent_end', status });
    this.artifact.durationMs = new Date().getTime() - new Date(this.artifact.timestamp).getTime();
    
    this.hasEnded = true;
  }

  /**
   * Returns the current state of the artifact.
   */
  getArtifact(): RunArtifact {
    return this.artifact;
  }

  /**
   * Saves the artifact to the specified filepath as JSON.
   */
  async save(filepath?: string) {
    // Attempt graceful completion if not explicitly ended
    if (!this.hasEnded) {
      // We don't mark success, we mark incomplete if saved before end
      this.endRun('incomplete'); 
    }

    if (!filepath) {
      const config = loadConfig();
      if (!existsSync(config.runsDir)) {
        mkdirSync(config.runsDir, { recursive: true });
      }
      const timestamp = new Date(this.artifact.timestamp).toISOString().replace(/[:.]/g, '-');
      filepath = path.join(config.runsDir, `${this.artifact.runId}.agentrun`);
    }
    
    // Save atomically to avoid malformed states on crash
    const tempFile = `${filepath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(this.artifact, null, 2), 'utf-8');
    await fs.rename(tempFile, filepath);
  }
}
