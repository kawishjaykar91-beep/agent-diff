import type { DiffResult, PathStep } from './diff.js';
import type { DiffOperation } from './align.js';

// ── Color support ──────────────────────────────────────────────────────────

let useColor = true;

let red = (s: string) => s;
let green = (s: string) => s;
let yellow = (s: string) => s;
let cyan = (s: string) => s;
let dim = (s: string) => s;
let bold = (s: string) => s;
let gray = (s: string) => s;
let magenta = (s: string) => s;

export async function initColors(force?: boolean): Promise<void> {
  if (process.env.NO_COLOR || (!force && !process.stdout.isTTY)) {
    useColor = false;
    return;
  }
  try {
    const chalk = await import('chalk');
    const c = chalk.default;
    red = (s) => c.red(s);
    green = (s) => c.green(s);
    yellow = (s) => c.yellow(s);
    cyan = (s) => c.cyan(s);
    dim = (s) => c.dim(s);
    bold = (s) => c.bold(s);
    gray = (s) => c.gray(s);
    magenta = (s) => c.magenta(s);
    useColor = true;
  } catch {
    useColor = false;
  }
}

export function disableColors(): void {
  useColor = false;
  red = green = yellow = cyan = dim = bold = gray = magenta = (s: string) => s;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function header(title: string): string {
  const bar = '─'.repeat(40);
  return `\n${bold(title)}\n${dim(bar)}`;
}

function changeIndicator(a: number, b: number): string {
  const diff = b - a;
  if (diff === 0) return dim('(no change)');
  const pct = a !== 0 ? Math.round((diff / a) * 100) : NaN;
  const pctStr = !isNaN(pct) ? ` (${diff > 0 ? '+' : ''}${pct}%)` : '';
  if (diff > 0) return red(`↑ +${diff}${pctStr}`);
  return green(`↓ ${diff}${pctStr}`);
}

function numberChangeStr(a?: number, b?: number): string {
  if (a === undefined && b === undefined) return dim('—');
  const va = a ?? 0;
  const vb = b ?? 0;
  if (va === vb) return `${va} ${dim('(no change)')}`;
  return `${va} → ${vb} ${changeIndicator(va, vb)}`;
}

function formatCurrency(n: number, currency: string): string {
  if (currency === 'USD') return `$${n.toFixed(4)}`;
  return `${n.toFixed(4)} ${currency}`;
}

function colorizeStep(item: string): string {
  if (item === 'model' || item === 'response') return yellow(item);
  if (item === 'error') return red(item);
  if (item === '→result') return dim(item);
  if (item.startsWith('read(') || item.startsWith('write(') || item.startsWith('cmd(')) return gray(item);
  return cyan(item);
}

function formatAlignedPath(alignment: DiffOperation[]): string {
  const lines: string[] = [];
  
  let equalBuffer: string[] = [];
  
  const flushEquals = () => {
     if (equalBuffer.length > 3) {
        lines.push(`    ${dim(`... (${equalBuffer.length} unchanged steps)`)}`);
     } else if (equalBuffer.length > 0) {
        for (const item of equalBuffer) {
           lines.push(`    ${dim(item)}`);
        }
     }
     equalBuffer = [];
  };

  for (const op of alignment) {
    if (op.item === 'start' || op.item === 'end') continue;
    
    if (op.type === 'equal') {
       equalBuffer.push(op.item);
    } else {
       flushEquals();
       const text = colorizeStep(op.item);
       if (op.type === 'insert') lines.push(green(`  + ${text}`));
       if (op.type === 'delete') lines.push(red(`  - ${text}`));
    }
  }
  flushEquals();
  
  if (lines.length === 0) return dim('  (empty path)');
  return lines.join('\n');
}

// ── Main render function ───────────────────────────────────────────────────

export function renderDiff(diff: DiffResult): string {
  const lines: string[] = [];

  // Title
  lines.push('');
  lines.push(bold('Agent Execution Diff'));
  lines.push(dim('═'.repeat(40)));

  // Run IDs
  lines.push(`  ${dim('Baseline:')} ${diff.runIdA}`);
  lines.push(`  ${dim('Current: ')} ${diff.runIdB}`);

  if (diff.identical) {
    lines.push('');
    lines.push(green('  ✓ Runs are structurally identical'));
    lines.push('');
    return lines.join('\n');
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────
  lines.push(header('SUMMARY'));

  const execAdded = diff.pathAlignment.filter(o => o.type === 'insert' && o.item !== 'start' && o.item !== 'end').length;
  const execRemoved = diff.pathAlignment.filter(o => o.type === 'delete' && o.item !== 'start' && o.item !== 'end').length;
  const toolChanges = diff.toolUsage.filter(t => t.change !== 0).length;
  const fileChanges = diff.files.filter(f => f.inA !== f.inB || f.types.length > 0).length; // Approximated
  const cmdChanges = diff.commands.filter(c => c.inA !== c.inB).length;
  
  const onlyB = diff.errors.filter(e => !e.inA && e.inB).length;
  const onlyA = diff.errors.filter(e => e.inA && !e.inB).length;

  if (execAdded + execRemoved > 0) lines.push(`  ${execAdded} added, ${execRemoved} removed execution steps`);
  if (toolChanges > 0) lines.push(`  ${toolChanges} tool-count change(s)`);
  if (fileChanges > 0) lines.push(`  ${fileChanges} file difference(s)`);
  if (cmdChanges > 0) lines.push(`  ${cmdChanges} command difference(s)`);
  
  if (onlyB > 0) lines.push(`  ${onlyB} newly introduced error(s)`);
  if (onlyA > 0) lines.push(`  ${onlyA} resolved error(s)`);

  if (lines[lines.length - 1] === header('SUMMARY')) {
    lines.push(dim('  No significant structural changes'));
  }

  // ── EXECUTION PATH ─────────────────────────────────────────────────────
  if (execAdded + execRemoved > 0) {
     lines.push(header('EXECUTION PATH'));
     lines.push(formatAlignedPath(diff.pathAlignment));
  }

  // ── TOOLS ─────────────────────────────────────────────────────────
  if (diff.toolUsage.length > 0) {
    lines.push(header('TOOLS'));
    const maxLen = Math.max(...diff.toolUsage.map(t => t.tool.length));
    for (const t of diff.toolUsage) {
      const name = t.tool.padEnd(maxLen + 2);
      const indicator =
        t.countA === 0 ? green('+ NEW') :
        t.countB === 0 ? red('- REMOVED') :
        t.change === 0 ? dim('(same)') :
        changeIndicator(t.countA, t.countB);

      lines.push(`  ${name}${t.countA} → ${t.countB}  ${indicator}`);
    }
  }

  // ── FILES ──────────────────────────────────────────────────────────────
  if (diff.files.length > 0) {
    lines.push(header('FILES'));
    for (const f of diff.files) {
      const indicator =
        f.inA && !f.inB ? red('- only in baseline') :
        !f.inA && f.inB ? green('+ only in current') :
        dim('(both)');
      lines.push(`  ${f.file}  ${dim(`[${f.types.join(', ')}]`)}  ${indicator}`);
    }
  }

  // ── COMMANDS ───────────────────────────────────────────────────────────
  if (diff.commands.length > 0) {
    lines.push(header('COMMANDS'));
    for (const c of diff.commands) {
      const indicator =
        c.inA && !c.inB ? red('- only in baseline') :
        !c.inA && c.inB ? green('+ only in current') :
        dim('(both)');
      lines.push(`  ${c.command}  ${indicator}`);
    }
  }

  // ── ERRORS ─────────────────────────────────────────────────────────────
  if (diff.errors.length > 0) {
    lines.push(header('ERRORS'));
    lines.push(`  Baseline errors: ${diff.errors.filter(e => e.inA).length}`);
    lines.push(`  Current errors:  ${diff.errors.filter(e => e.inB).length}\n`);

    for (const e of diff.errors) {
      const indicator =
        e.inA && !e.inB ? green('✓ resolved') :
        !e.inA && e.inB ? red('✗ new') :
        dim('(unchanged)');
      const typeStr = e.type ? dim(` [${e.type}]`) : '';
      lines.push(`  ${e.error}${typeStr}  ${indicator}`);
    }
  }

  // ── TOKENS & COST ───────────────────────────────────────────────────────
  if (diff.tokens.totalTokens || diff.tokens.inputTokens || diff.tokens.outputTokens || diff.cost.total) {
    lines.push(header('TOKENS & COST'));

    if (diff.tokens.inputTokens) {
      lines.push(`  Input tokens:  ${numberChangeStr(diff.tokens.inputTokens.a, diff.tokens.inputTokens.b)}`);
    }
    if (diff.tokens.outputTokens) {
      lines.push(`  Output tokens: ${numberChangeStr(diff.tokens.outputTokens.a, diff.tokens.outputTokens.b)}`);
    }
    if (diff.tokens.totalTokens) {
      lines.push(`  Total tokens:  ${numberChangeStr(diff.tokens.totalTokens.a, diff.tokens.totalTokens.b)}`);
    }
    if (diff.cost.total) {
      const cA = diff.cost.total.a ?? 0;
      const cB = diff.cost.total.b ?? 0;
      const costChange = cA === cB ? dim('(no change)') : changeIndicator(Math.round(cA * 10000), Math.round(cB * 10000));
      lines.push(`  Cost:          ${formatCurrency(cA, diff.cost.currency)} → ${formatCurrency(cB, diff.cost.currency)}  ${costChange}`);
    }
  }

  // ── MODEL ──────────────────────────────────────────────────────
  if (diff.metadata.modelProvider || diff.metadata.modelName) {
    lines.push(header('MODEL'));
    if (diff.metadata.modelProvider) {
      lines.push(`  Provider: ${diff.metadata.modelProvider.a ?? dim('—')} → ${diff.metadata.modelProvider.b ?? dim('—')}`);
    }
    if (diff.metadata.modelName) {
      lines.push(`  Model:    ${diff.metadata.modelName.a ?? dim('—')} → ${diff.metadata.modelName.b ?? dim('—')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render the diff as a machine-readable JSON string.
 */
export function renderDiffJson(diff: DiffResult): string {
  // Convert Maps to plain objects for JSON serialization
  const byType: Record<string, { a: number; b: number }> = {};
  for (const [k, v] of diff.eventCounts.byType) {
    byType[k] = v;
  }
  return JSON.stringify(
    { ...diff, eventCounts: { ...diff.eventCounts, byType } },
    null,
    2,
  );
}
