/**
 * Parse the model response and extract the meaningful edit.
 *
 * The model returns the replacement for the editable region,
 * potentially terminated by ">>>>>>> UPDATED".
 * We compare it against the original editable region and return
 * the changed content, or null if nothing changed.
 */
export function parseResponse(
  modelOutput: string,
  originalEditableRegion: string,
): string | null {
  // Strip the UPDATED marker if present
  let cleaned = modelOutput;
  const updatedIdx = cleaned.indexOf(">>>>>>> UPDATED");
  if (updatedIdx !== -1) {
    cleaned = cleaned.slice(0, updatedIdx);
  }

  // Remove trailing newline that the model may add
  cleaned = cleaned.trimEnd();

  // Strip the cursor marker from the original for comparison
  const originalClean = originalEditableRegion
    .replace("<|user_cursor|>", "")
    .trimEnd();

  // If the model returned identical content, there's no edit
  if (cleaned === originalClean) {
    return null;
  }

  return cleaned;
}

/**
 * Given the full model output (replacement for the editable region)
 * and the original editable region, compute the inline completion text
 * that should be inserted at the cursor position.
 *
 * The strategy: find where the cursor marker was in the original region,
 * then diff forward from that point to find what the model inserted/changed.
 */
export function extractInlineCompletion(
  modelOutput: string,
  originalEditableRegion: string,
): string | null {
  const cursorMarker = "<|user_cursor|>";
  const cursorIdx = originalEditableRegion.indexOf(cursorMarker);
  if (cursorIdx === -1) {
    return parseResponse(modelOutput, originalEditableRegion);
  }

  // Text before and after cursor in original
  const beforeCursor = originalEditableRegion.slice(0, cursorIdx);
  const afterCursor = originalEditableRegion.slice(cursorIdx + cursorMarker.length);

  // Strip UPDATED marker from model output
  let cleaned = modelOutput;
  const updatedIdx = cleaned.indexOf(">>>>>>> UPDATED");
  if (updatedIdx !== -1) {
    cleaned = cleaned.slice(0, updatedIdx);
  }
  cleaned = cleaned.trimEnd();

  const originalClean = (beforeCursor + afterCursor).trimEnd();
  if (cleaned === originalClean) {
    return null;
  }

  // The model rewrites the full editable region. Find the insertion point
  // by matching the before-cursor prefix in the model output.
  if (!cleaned.startsWith(beforeCursor)) {
    // Model changed content before cursor — return full replacement
    return cleaned;
  }

  // The part after the before-cursor prefix in the model output
  const modelAfterPrefix = cleaned.slice(beforeCursor.length);

  // Find the common suffix between modelAfterPrefix and afterCursor
  // to isolate what the model inserted
  const afterTrimmed = afterCursor.trimEnd();
  if (modelAfterPrefix.endsWith(afterTrimmed) && afterTrimmed.length > 0) {
    const inserted = modelAfterPrefix.slice(
      0,
      modelAfterPrefix.length - afterTrimmed.length,
    );
    return inserted || null;
  }

  // Fallback: return everything after the prefix
  return modelAfterPrefix || null;
}
