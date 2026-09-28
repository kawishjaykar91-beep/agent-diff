# Coding Agent Example

This is a tiny, self-contained AI agent demonstrating how to use `agentdiff` in a real workflow.

## The First-Run Experience

1. **Initialize AgentDiff** in your repository:
   ```bash
   npx agentdiff init
   ```
   *This creates `.agentdiff/runs` and `.agentdiff/fixtures` for you.*

2. **Run your agent normally**:
   ```bash
   npx tsx agent.ts
   ```
   *AgentDiff automatically intercepts the OpenAI calls and saves the trace to `.agentdiff/runs/run-XYZ.agentrun`.*

3. **Inspect the execution**:
   ```bash
   npx agentdiff inspect
   ```
   *Shows a clean summary of what your agent just did (cost, files modified, tools used).*

4. **Turn it into a regression fixture**:
   ```bash
   cp .agentdiff/runs/run-XYZ.agentrun .agentdiff/fixtures/auth-bugfix.agentrun
   ```

5. **Replay deterministically offline**:
   ```bash
   npx agentdiff replay .agentdiff/fixtures/auth-bugfix.agentrun npx tsx agent.ts
   ```
   *Your agent will run again instantaneously, intercepting network requests to supply the recorded responses from the fixture.*

6. **Test for structural regressions**:
   ```bash
   npx agentdiff test
   ```
   *Compares the most recent run against the fixture. If your agent's behavior changed (e.g. unexpected tool calls or diverged path), the test will fail!*
