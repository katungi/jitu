import * as vscode from "vscode";
import { PromptContext } from "./types";

const EDITABLE_REGION_LINES = 8;
const MAX_PREFIX_CHARS = 3500;
const MAX_SUFFIX_CHARS = 2500;
const MAX_DIAGNOSTIC_ENTRIES = 6;

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
  const prefix = buildBoundedPrefixContext(
    document,
    prefixStart,
    editStart - 1,
    MAX_PREFIX_CHARS,
  );

  const suffixEnd = Math.min(totalLines - 1, editEnd + contextLines);
  const suffix = buildBoundedSuffixContext(
    document,
    editEnd + 1,
    suffixEnd,
    MAX_SUFFIX_CHARS,
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

function buildBoundedPrefixContext(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  maxChars: number,
): string {
  if (endLine < startLine) {
    return "";
  }

  const lines: string[] = [];
  let chars = 0;

  for (let line = endLine; line >= startLine; line--) {
    const content = document.lineAt(line).text;
    const lineWithBreak = `${content}\n`;
    if (chars + lineWithBreak.length > maxChars) {
      break;
    }
    lines.unshift(content);
    chars += lineWithBreak.length;
  }

  return lines.join("\n");
}

function buildBoundedSuffixContext(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  maxChars: number,
): string {
  if (endLine < startLine) {
    return "";
  }

  const lines: string[] = [];
  let chars = 0;

  for (let line = startLine; line <= endLine; line++) {
    const content = document.lineAt(line).text;
    const lineWithBreak = `${content}\n`;
    if (chars + lineWithBreak.length > maxChars) {
      break;
    }
    lines.push(content);
    chars += lineWithBreak.length;
  }

  return lines.join("\n");
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
    .slice(0, MAX_DIAGNOSTIC_ENTRIES)
    .map((d) => `// ${d.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"} line ${d.range.start.line + 1}: ${d.message}`);

  return nearby.join("\n");
}

export function buildPrompt(ctx: PromptContext): string {
  const suffixBlock = ctx.suffix ? `${ctx.suffix}\n` : "";
  const prefixBlock = ctx.prefix ? `${ctx.prefix}\n` : "";

  let prompt = `<[fim-suffix]>\n${suffixBlock}<[fim-prefix]>`;

  if (ctx.diagnostics) {
    prompt += `<filename>diagnostics\n${ctx.diagnostics}\n\n`;
  }

  prompt +=
    `<filename>${ctx.filePath}\n` +
    `${prefixBlock}` +
    `<<<<<<< CURRENT\n` +
    `${ctx.editableRegion}\n` +
    `=======\n` +
    `<[fim-middle]>`;

  return prompt;
}
