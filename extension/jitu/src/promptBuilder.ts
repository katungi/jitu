import * as vscode from "vscode";
import { PromptContext } from "./types";

const EDITABLE_REGION_LINES = 5;

export function buildPromptContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextLines: number,
): PromptContext {
  const totalLines = document.lineCount;
  const cursorLine = position.line;

  // Editable region: N lines above and below cursor
  const editStart = Math.max(0, cursorLine - EDITABLE_REGION_LINES);
  const editEnd = Math.min(totalLines - 1, cursorLine + EDITABLE_REGION_LINES);

  // Prefix: lines before the editable region (up to contextLines)
  const prefixStart = Math.max(0, editStart - contextLines);
  const prefix = document.getText(
    new vscode.Range(prefixStart, 0, editStart, 0),
  );

  // Suffix: lines after the editable region (up to contextLines)
  const suffixEnd = Math.min(totalLines, editEnd + 1 + contextLines);
  const suffix = document.getText(
    new vscode.Range(editEnd + 1, 0, suffixEnd, 0),
  );

  // Editable region with cursor marker
  const editableLines: string[] = [];
  for (let i = editStart; i <= editEnd; i++) {
    const lineText = document.lineAt(i).text;
    if (i === cursorLine) {
      // Insert cursor marker at the cursor column
      const col = position.character;
      editableLines.push(
        lineText.slice(0, col) + "<|user_cursor|>" + lineText.slice(col),
      );
    } else {
      editableLines.push(lineText);
    }
  }
  const editableRegion = editableLines.join("\n");

  // Relative file path
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const filePath = workspaceFolder
    ? vscode.workspace.asRelativePath(document.uri)
    : document.uri.fsPath;

  return { prefix, suffix, editableRegion, filePath };
}

export function buildPrompt(ctx: PromptContext): string {
  return (
    `<[fim-suffix]>\n` +
    `${ctx.suffix}` +
    `<[fim-prefix]><filename>${ctx.filePath}\n` +
    `${ctx.prefix}` +
    `<<<<<<< CURRENT\n` +
    `${ctx.editableRegion}\n` +
    `=======\n` +
    `<[fim-middle]>`
  );
}
