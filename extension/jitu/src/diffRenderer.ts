import * as vscode from "vscode";
import { DiffResult } from "./diffEngine";

const HAS_PENDING_DIFF_CONTEXT = "jitu.hasPendingDiff";

export interface PendingDiff {
  documentUri: vscode.Uri;
  diffs: DiffResult[];
  editRange: vscode.Range;
  newContent: string;
}

export class DiffRenderer implements vscode.Disposable {
  private pendingDiff: PendingDiff | null = null;
  private readonly deleteDecoration: vscode.TextEditorDecorationType;
  private readonly insertDecoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.deleteDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 0, 0, 0.1)",
      textDecoration: "line-through",
      color: "rgba(255, 100, 100, 0.8)",
      isWholeLine: true,
    });

    this.insertDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        color: "rgba(100, 255, 100, 0.85)",
        fontStyle: "italic",
      },
      isWholeLine: false,
    });

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.pendingDiff &&
          event.document.uri.toString() === this.pendingDiff.documentUri.toString()
        ) {
          this.clear();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (
          this.pendingDiff &&
          event.textEditor.document.uri.toString() ===
            this.pendingDiff.documentUri.toString()
        ) {
          this.clear();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this.pendingDiff) {
          this.clear();
        }
      }),
    );

    this.setPendingContext(false);
  }

  showDiff(editor: vscode.TextEditor, diff: PendingDiff): void {
    this.clear();

    const deleteRanges: vscode.Range[] = [];
    const insertDecorations: vscode.DecorationOptions[] = [];
    const insertOffsetByAnchor = new Map<number, number>();

    for (const change of diff.diffs) {
      if (
        (change.type === "delete" || change.type === "replace") &&
        change.originalLine !== undefined
      ) {
        const line = this.clampLine(editor.document, change.originalLine);
        const lineLength = editor.document.lineAt(line).text.length;
        deleteRanges.push(
          new vscode.Range(line, 0, line, lineLength),
        );
      }

      if (
        (change.type === "insert" || change.type === "replace") &&
        change.newText
      ) {
        const anchorLine = this.clampLine(
          editor.document,
          change.originalLine ?? diff.editRange.start.line,
        );
        const anchorOffset = insertOffsetByAnchor.get(anchorLine) ?? 0;
        insertOffsetByAnchor.set(anchorLine, anchorOffset + 1);

        const line = this.clampLine(editor.document, anchorLine + anchorOffset);
        const lineLength = editor.document.lineAt(line).text.length;
        insertDecorations.push({
          range: new vscode.Range(line, lineLength, line, lineLength),
          renderOptions: {
            after: {
              contentText: `  + ${change.newText}`,
              color: "rgba(100, 255, 100, 0.85)",
              fontStyle: "italic",
            },
          },
        });
      }
    }

    editor.setDecorations(this.deleteDecoration, deleteRanges);
    editor.setDecorations(this.insertDecoration, insertDecorations);

    if (deleteRanges.length === 0 && insertDecorations.length === 0) {
      this.setPendingContext(false);
      return;
    }

    this.pendingDiff = diff;
    this.setPendingContext(true);
  }

  clear(): void {
    if (!this.pendingDiff) {
      return;
    }

    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.deleteDecoration, []);
      editor.setDecorations(this.insertDecoration, []);
    }

    this.pendingDiff = null;
    this.setPendingContext(false);
  }

  async acceptDiff(editor: vscode.TextEditor): Promise<void> {
    if (
      !this.pendingDiff ||
      editor.document.uri.toString() !== this.pendingDiff.documentUri.toString()
    ) {
      return;
    }

    const diff = this.pendingDiff;
    await editor.edit((editBuilder) => {
      editBuilder.replace(diff.editRange, diff.newContent);
    });
    this.clear();
  }

  hasPendingDiff(): boolean {
    return this.pendingDiff !== null;
  }

  private setPendingContext(value: boolean): void {
    void vscode.commands.executeCommand(
      "setContext",
      HAS_PENDING_DIFF_CONTEXT,
      value,
    );
  }

  private clampLine(document: vscode.TextDocument, line: number): number {
    if (document.lineCount === 0) {
      return 0;
    }
    if (line < 0) {
      return 0;
    }
    if (line >= document.lineCount) {
      return document.lineCount - 1;
    }
    return line;
  }

  dispose(): void {
    this.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.deleteDecoration.dispose();
    this.insertDecoration.dispose();
    this.setPendingContext(false);
  }
}
