export interface DiffResult {
  type: "equal" | "delete" | "insert" | "replace";
  originalLine?: number;
  originalText?: string;
  newText?: string;
}

export function computeDiff(
  originalLines: string[],
  newLines: string[],
  startLine: number,
): DiffResult[] {
  const diffs: DiffResult[] = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < newLines.length) {
    if (
      i < originalLines.length &&
      j < newLines.length &&
      originalLines[i] === newLines[j]
    ) {
      diffs.push({
        type: "equal",
        originalLine: startLine + i,
        originalText: originalLines[i],
        newText: newLines[j],
      });
      i++;
      j++;
      continue;
    }

    if (
      i < originalLines.length &&
      (j >= newLines.length ||
        (i + 1 < originalLines.length && originalLines[i + 1] === newLines[j]))
    ) {
      diffs.push({
        type: "delete",
        originalLine: startLine + i,
        originalText: originalLines[i],
      });
      i++;
      continue;
    }

    if (
      j < newLines.length &&
      (i >= originalLines.length ||
        (j + 1 < newLines.length && originalLines[i] === newLines[j + 1]))
    ) {
      const anchorLine =
        i > 0
          ? startLine + i - 1
          : Math.max(0, startLine - 1);
      diffs.push({
        type: "insert",
        originalLine: anchorLine,
        newText: newLines[j],
      });
      j++;
      continue;
    }

    if (i < originalLines.length && j < newLines.length) {
      diffs.push({
        type: "replace",
        originalLine: startLine + i,
        originalText: originalLines[i],
        newText: newLines[j],
      });
      i++;
      j++;
      continue;
    }

    if (i < originalLines.length) {
      diffs.push({
        type: "delete",
        originalLine: startLine + i,
        originalText: originalLines[i],
      });
      i++;
      continue;
    }

    const anchorLine =
      i > 0
        ? startLine + i - 1
        : Math.max(0, startLine - 1);
    diffs.push({
      type: "insert",
      originalLine: anchorLine,
      newText: newLines[j],
    });
    j++;
  }

  return diffs;
}
