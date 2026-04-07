import { computeDiff, DiffResult } from "./diffEngine";

export interface ParsedCompletionInsertion {
  type: "insertion";
  text: string;
}

export interface ParsedCompletionEdit {
  type: "edit";
  newContent: string;
  diffs: DiffResult[];
  deletedLines: Array<{ line: number; text: string }>;
  insertedLines: Array<{ line: number; text: string }>;
}

export type ParsedCompletion =
  | { type: "none" }
  | ParsedCompletionInsertion
  | ParsedCompletionEdit;

/**
 * Clean the raw model output by stripping the UPDATED marker
 * and trailing whitespace.
 */
function cleanModelOutput(modelOutput: string): string {
  let cleaned = modelOutput;
  const updatedIdx = cleaned.indexOf(">>>>>>> UPDATED");
  if (updatedIdx !== -1) {
    cleaned = cleaned.slice(0, updatedIdx);
  }
  cleaned = cleaned.replaceAll("<|user_cursor|>", "");
  return cleaned.trimEnd();
}

/**
 * Parse a model completion into one of:
 * - insertion: model only inserted at cursor
 * - edit: model replaced/deleted/inserted within editable region
 * - none: no material change
 */
export function parseCompletion(
  modelOutput: string,
  originalEditableRegion: string,
  editStartLine: number,
): ParsedCompletion {
  const cursorMarker = "<|user_cursor|>";
  const cleaned = cleanModelOutput(modelOutput);

  const originalClean = originalEditableRegion
    .replace(cursorMarker, "")
    .trimEnd();

  if (cleaned === originalClean) {
    return { type: "none" };
  }

  const cursorIdx = originalEditableRegion.indexOf(cursorMarker);
  if (cursorIdx === -1) {
    return buildEditCompletion(cleaned, originalClean, editStartLine);
  }

  const beforeCursor = originalEditableRegion.slice(0, cursorIdx);
  const afterCursor = originalEditableRegion.slice(
    cursorIdx + cursorMarker.length,
  );

  if (cleaned.startsWith(beforeCursor)) {
    const modelAfterPrefix = cleaned.slice(beforeCursor.length);
    const afterTrimmed = afterCursor.trimEnd();

    if (modelAfterPrefix.endsWith(afterTrimmed)) {
      const inserted = modelAfterPrefix.slice(
        0,
        modelAfterPrefix.length - afterTrimmed.length,
      );
      if (inserted) {
        return { type: "insertion", text: inserted };
      }
      return { type: "none" };
    }
  }

  return buildEditCompletion(cleaned, originalClean, editStartLine);
}

function buildEditCompletion(
  newContent: string,
  originalContent: string,
  editStartLine: number,
): ParsedCompletionEdit {
  const originalLines = splitLines(originalContent);
  const newLines = splitLines(newContent);
  const diffs = computeDiff(originalLines, newLines, editStartLine);

  const deletedLines = diffs
    .filter(
      (d): d is DiffResult & { originalLine: number; originalText: string } =>
        (d.type === "delete" || d.type === "replace") &&
        d.originalLine !== undefined &&
        d.originalText !== undefined,
    )
    .map((d) => ({ line: d.originalLine, text: d.originalText }));

  const insertedLines = diffs
    .filter(
      (d): d is DiffResult & { originalLine: number; newText: string } =>
        (d.type === "insert" || d.type === "replace") &&
        d.originalLine !== undefined &&
        d.newText !== undefined,
    )
    .map((d) => ({ line: d.originalLine, text: d.newText }));

  return {
    type: "edit",
    newContent,
    diffs,
    deletedLines,
    insertedLines,
  };
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split("\n");
}
