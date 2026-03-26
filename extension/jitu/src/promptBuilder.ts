import * as vscode from "vscode";
import { PromptContext } from "./types";

const EDITABLE_REGION_LINES = 12;

export function buildPromptContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextLines: number,
): PromptContext {
  const totalLines = document.lineCount;
  const cursorLine = position.line;

  const editStart = Math.max(0, cursorLine - EDITABLE_REGION_LINES);
  const editEnd = Math.min(totalLines - 1, cursorLine + EDITABLE_REGION_LINES);

  const prefixStart = Math.max(0, editStart - contextLines);
  const prefix = document.getText(
    new vscode.Range(prefixStart, 0, editStart, 0),
  );

  const suffixEnd = Math.min(totalLines, editEnd + 1 + contextLines);
  const suffix = document.getText(
    new vscode.Range(editEnd + 1, 0, suffixEnd, 0),
  );

  const editableLines: string[] = [];
  for (let i = editStart; i <= editEnd; i++) {
    const lineText = document.lineAt(i).text;
    if (i === cursorLine) {
      const col = position.character;
      editableLines.push(
        lineText.slice(0, col) + "<|user_cursor|>" + lineText.slice(col),
      );
    } else {
      editableLines.push(lineText);
    }
  }
  const editableRegion = editableLines.join("\n");

  const diagnostics = buildDiagnosticContext(document.uri, cursorLine);

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const filePath = workspaceFolder
    ? vscode.workspace.asRelativePath(document.uri)
    : document.uri.fsPath;

  return {
    prefix,
    suffix,
    editableRegion,
    filePath,
    editStartLine: editStart,
    editEndLine: editEnd,
    diagnostics,
  };
}

function buildDiagnosticContext(uri: vscode.Uri, cursorLine: number): string {
  const diagnostics = vscode.languages.getDiagnostics(uri);
  const nearby = diagnostics
    .filter(
      (d) =>
        Math.abs(d.range.start.line - cursorLine) < 15 &&
        (d.severity === vscode.DiagnosticSeverity.Error ||
          d.severity === vscode.DiagnosticSeverity.Warning),
    )
    .map((d) => `// ${d.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"} line ${d.range.start.line + 1}: ${d.message}`);

  return nearby.join("\n");
}

export function buildPrompt(ctx: PromptContext): string {
  let prompt = `<[fim-suffix]>\n${ctx.suffix}<[fim-prefix]>`;

  if (ctx.diagnostics) {
    prompt += `<filename>diagnostics\n${ctx.diagnostics}\n\n`;
  }

  prompt +=
    `<filename>${ctx.filePath}\n` +
    `${ctx.prefix}` +
    `<<<<<<< CURRENT\n` +
    `${ctx.editableRegion}\n` +
    `=======\n` +
    `<[fim-middle]>`;

  return prompt;
}
