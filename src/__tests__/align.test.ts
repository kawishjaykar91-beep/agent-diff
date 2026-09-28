import { describe, it, expect } from 'vitest';
import { alignSequences } from '../align.js';

describe('Sequence Alignment (LCS)', () => {
  it('aligns identical sequences', () => {
    const a = ['A', 'B', 'C'];
    const result = alignSequences(a, a);
    expect(result).toHaveLength(3);
    expect(result.every(op => op.type === 'equal')).toBe(true);
  });

  it('detects one event inserted', () => {
    const a = ['A', 'B', 'C'];
    const b = ['A', 'B', 'X', 'C'];
    const result = alignSequences(a, b);
    expect(result).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0, item: 'A' },
      { type: 'equal', aIndex: 1, bIndex: 1, item: 'B' },
      { type: 'insert', bIndex: 2, item: 'X' },
      { type: 'equal', aIndex: 2, bIndex: 3, item: 'C' },
    ]);
  });

  it('detects one event removed', () => {
    const a = ['A', 'B', 'X', 'C'];
    const b = ['A', 'B', 'C'];
    const result = alignSequences(a, b);
    expect(result).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0, item: 'A' },
      { type: 'equal', aIndex: 1, bIndex: 1, item: 'B' },
      { type: 'delete', aIndex: 2, item: 'X' },
      { type: 'equal', aIndex: 3, bIndex: 2, item: 'C' },
    ]);
  });

  it('detects one event replaced', () => {
    const a = ['A', 'B', 'C'];
    const b = ['A', 'X', 'C'];
    const result = alignSequences(a, b);
    expect(result).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0, item: 'A' },
      { type: 'delete', aIndex: 1, item: 'B' },
      { type: 'insert', bIndex: 1, item: 'X' },
      { type: 'equal', aIndex: 2, bIndex: 2, item: 'C' },
    ]);
  });

  it('handles repeated identical tools correctly', () => {
    const a = ['search', 'search', 'search'];
    const b = ['search', 'search', 'search', 'search'];
    const result = alignSequences(a, b);
    expect(result.filter(op => op.type === 'equal').length).toBe(3);
    expect(result.filter(op => op.type === 'insert').length).toBe(1);
    expect(result.filter(op => op.type === 'delete').length).toBe(0);
  });

  it('handles completely divergent paths', () => {
    const a = ['X', 'Y', 'Z'];
    const b = ['A', 'B', 'C'];
    const result = alignSequences(a, b);
    expect(result.every(op => op.type === 'insert' || op.type === 'delete')).toBe(true);
  });

  it('handles empty execution paths', () => {
    expect(alignSequences([], [])).toEqual([]);
    expect(alignSequences(['A'], [])).toEqual([{ type: 'delete', aIndex: 0, item: 'A' }]);
    expect(alignSequences([], ['B'])).toEqual([{ type: 'insert', bIndex: 0, item: 'B' }]);
  });
});
