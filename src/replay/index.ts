import * as fs from 'node:fs';
import { validateArtifact } from '../validate.js';
import { AgentRecorder } from '../recorder/index.js';
import type { RunArtifact, RunEvent } from '../schema.js';

export class ReplayMismatchError extends Error {
  constructor(message: string) {
    super(`Replay mismatch: ${message}`);
    this.name = 'ReplayMismatchError';
  }
}

export class AgentReplay {
  private fixture: RunArtifact;
  private recorder: AgentRecorder;
  private modelCallEvents: RunEvent[];
  private currentIndex = 0;

  constructor(fixturePathOrArtifact: string | RunArtifact, existingRecorder?: AgentRecorder) {
    if (typeof fixturePathOrArtifact === 'string') {
      const raw = fs.readFileSync(fixturePathOrArtifact, 'utf-8');
      this.fixture = validateArtifact(JSON.parse(raw), fixturePathOrArtifact);
    } else {
      this.fixture = fixturePathOrArtifact;
    }

    // We only index model_calls because that's what the replay intercepts.
    // In the future, this could include other interceptable operations.
    this.modelCallEvents = this.fixture.events.filter(e => e.type === 'model_call');
    
    this.recorder = existingRecorder || new AgentRecorder(this.fixture.agent, this.fixture.input);
  }

  /**
   * Retrieves the underlying recorder, which is building the NEW run artifact.
   */
  getRecorder(): AgentRecorder {
    return this.recorder;
  }

  /**
   * Advances the replay index and returns the expected model_call event and its corresponding model_response.
   * Throws a ReplayMismatchError if the actual request doesn't match the expected structural sequence.
   */
  consumeModelCall(actualModel: string, actualMessages: any[]): { call: RunEvent, response: RunEvent | undefined } {
    if (this.currentIndex >= this.modelCallEvents.length) {
      throw new ReplayMismatchError(
        `Unexpected extra model call.\nExpected: end of execution\nReceived: model call to ${actualModel}`
      );
    }

    const expectedCall = this.modelCallEvents[this.currentIndex];
    this.currentIndex++;

    // 1. Match the model
    if (expectedCall.model && expectedCall.model !== actualModel) {
      throw new ReplayMismatchError(
        `Model mismatch at request #${this.currentIndex}.\nExpected: ${expectedCall.model}\nReceived: ${actualModel}`
      );
    }

    // 2. Match the message sequence (basic structural check)
    // For M3, we check length and roles. Deep content comparison can be too brittle, 
    // but structure is important.
    const expectedMessages = expectedCall.messages || [];
    if (expectedMessages.length !== actualMessages.length) {
      throw new ReplayMismatchError(
        `Message count mismatch at request #${this.currentIndex}.\nExpected: ${expectedMessages.length} messages\nReceived: ${actualMessages.length} messages`
      );
    }

    for (let i = 0; i < expectedMessages.length; i++) {
      if (expectedMessages[i].role !== actualMessages[i].role) {
        throw new ReplayMismatchError(
          `Message role mismatch at request #${this.currentIndex}, message [${i}].\nExpected role: ${expectedMessages[i].role}\nReceived role: ${actualMessages[i].role}`
        );
      }
      // Strict matching for initial prompts to catch prompt divergence (Case B)
      if (i === 0 && expectedMessages[i].role === 'user' && typeof expectedMessages[i].content === 'string') {
         if (expectedMessages[i].content !== actualMessages[i].content) {
            throw new ReplayMismatchError(
              `Initial prompt mismatch at request #${this.currentIndex}.\nExpected: ${expectedMessages[i].content}\nReceived: ${actualMessages[i].content}`
            );
         }
      }
    }

    // Find the associated response in the fixture (the first model_response AFTER this model_call)
    const callIndex = this.fixture.events.findIndex(e => e.id === expectedCall.id);
    const subsequentEvents = this.fixture.events.slice(callIndex + 1);
    const expectedResponse = subsequentEvents.find(e => e.type === 'model_response');

    return { call: expectedCall, response: expectedResponse };
  }

  async save(filepath?: string) {
    this.recorder.endRun('success');
    await this.recorder.save(filepath);
  }
}
