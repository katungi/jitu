/**
 * Result of parsing a model response for edit prediction.
 *
 * `text` is the full replacement for the editable region.
 * `isEdit` is true when the model changed content outside the cursor point
 * (replacement or deletion), meaning we need to replace the full region
 * rather than just inserting at the cursor.
 */
export interface EditPrediction {
  text: string;
  isEdit: boolean;
}

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
 * Extract an edit prediction from the model response.
 *
 * Compares the model's rewritten editable region against the original
 * to determine whether this is:
 * - An insertion (model only added new text at cursor)
 * - A replacement/deletion (model changed existing text in the region)
 *
 * Returns null if the model returned identical content (no change).
 */
export function extractEditPrediction(
  modelOutput: string,
  originalEditableRegion: string,
): EditPrediction | null {
  const cursorMarker = "<|user_cursor|>";
  const cleaned = cleanModelOutput(modelOutput);

  // Strip cursor marker from original for comparison
  const originalClean = originalEditableRegion
    .replace(cursorMarker, "")
    .trimEnd();

  // No change
  if (cleaned === originalClean) {
    return null;
  }

  const cursorIdx = originalEditableRegion.indexOf(cursorMarker);
  if (cursorIdx === -1) {
    // No cursor marker — treat entire output as a region replacement
    return { text: cleaned, isEdit: true };
  }

  const beforeCursor = originalEditableRegion.slice(0, cursorIdx);
  const afterCursor = originalEditableRegion.slice(
    cursorIdx + cursorMarker.length,
  );

  // Check if the model only inserted text at the cursor position
  // (i.e. text before and after cursor is unchanged)
  if (cleaned.startsWith(beforeCursor)) {
    const modelAfterPrefix = cleaned.slice(beforeCursor.length);
    const afterTrimmed = afterCursor.trimEnd();

    if (afterTrimmed.length > 0 && modelAfterPrefix.endsWith(afterTrimmed)) {
      // Pure insertion at cursor
      const inserted = modelAfterPrefix.slice(
        0,
        modelAfterPrefix.length - afterTrimmed.length,
      );
      if (inserted) {
        return { text: inserted, isEdit: false };
      }
      return null;
    }
  }

  // Model changed content before/after cursor — full region replacement
  return { text: cleaned, isEdit: true };
}
