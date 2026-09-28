export type DiffOperation = 
  | { type: 'equal'; aIndex: number; bIndex: number; item: string }
  | { type: 'insert'; bIndex: number; item: string }
  | { type: 'delete'; aIndex: number; item: string };

/**
 * Computes a basic Longest Common Subsequence (LCS) to align two arrays of strings.
 * Returns the sequence of operations (equal, insert, delete) to transform A into B.
 */
export function alignSequences(a: string[], b: string[]): DiffOperation[] {
  const m = a.length;
  const n = b.length;
  
  // dp[i][j] stores the length of LCS of a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the operations
  let i = m;
  let j = n;
  const result: DiffOperation[] = [];

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push({ type: 'equal', aIndex: i - 1, bIndex: j - 1, item: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      result.push({ type: 'delete', aIndex: i - 1, item: a[i - 1] });
      i--;
    } else {
      result.push({ type: 'insert', bIndex: j - 1, item: b[j - 1] });
      j--;
    }
  }

  while (i > 0) {
    result.push({ type: 'delete', aIndex: i - 1, item: a[i - 1] });
    i--;
  }

  while (j > 0) {
    result.push({ type: 'insert', bIndex: j - 1, item: b[j - 1] });
    j--;
  }

  // The backtracking gives us the diff in reverse order
  return result.reverse();
}
