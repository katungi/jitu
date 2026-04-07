import * as vscode from "vscode";
import { CompletionClient, CompletionOptions } from "./types";
import { buildPrompt, buildPromptContext } from "./promptBuilder";
import { parseCompletion, ParsedCompletion } from "./responseParser";
import { getConfig } from "./config";
import { StatusBar } from "./statusBar";
import { DiffRenderer } from "./diffRenderer";

const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "go",
  "rust",
]);

type ActiveParsedCompletion = Exclude<ParsedCompletion, { type: "none" }>;

function hasCompletion(
  completion: ParsedCompletion,
): completion is ActiveParsedCompletion {
  return completion.type !== "none";
}

export class JituCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private diagnosticsDebounce: ReturnType<typeof setTimeout> | null = null;
  private diagnosticsDisposable: vscode.Disposable | null = null;

  constructor(
    private client: CompletionClient,
    private statusBar: StatusBar,
    private diffRenderer: DiffRenderer,
  ) {
    this.diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics(
      (e) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const config = getConfig();
        if (!config.enabled || config.triggerMode === "manual") {
          return;
        }
        const docUri = editor.document.uri;
        const affected = e.uris.some((uri) => uri.toString() === docUri.toString());
        if (!affected) {
          return;
        }

        if (this.diagnosticsDebounce) {
          clearTimeout(this.diagnosticsDebounce);
        }
        this.diagnosticsDebounce = setTimeout(() => {
          this.diagnosticsDebounce = null;
          const cursorLine = editor.selection.active.line;
          const diagnostics = vscode.languages.getDiagnostics(docUri);
          const hasNearby = diagnostics.some(
            (d) =>
              Math.abs(d.range.start.line - cursorLine) < 15 &&
              d.severity === vscode.DiagnosticSeverity.Error,
          );
          if (hasNearby) {
            vscode.commands.executeCommand(
              "editor.action.inlineSuggest.trigger",
            );
          }
        }, 200);
      },
    );
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = getConfig();

    if (!config.enabled) {
      this.diffRenderer.clear();
      return undefined;
    }

    if (!SUPPORTED_LANGUAGES.has(document.languageId)) {
      this.diffRenderer.clear();
      return undefined;
    }

    if (position.line > 0) {
      const currentLine = document.lineAt(position.line).text.trim();
      const prevLine = document.lineAt(position.line - 1).text.trim();
      if (currentLine === "" && prevLine === "") {
        this.diffRenderer.clear();
        return undefined;
      }
    }

    if (config.triggerMode === "onPause") {
      const shouldProceed = await this.debounce(config.debounceMs, token);
      if (!shouldProceed) {
        return undefined;
      }
    }

    if (token.isCancellationRequested) {
      return undefined;
    }

    this.diffRenderer.clear();

    const promptCtx = buildPromptContext(
      document,
      position,
      config.contextLines,
    );
    const prompt = buildPrompt(promptCtx);

    const options: CompletionOptions = {
      model: config.model,
      maxTokens: config.maxTokens,
      stop: [">>>>>>> UPDATED"],
      temperature: 0,
      candidateCount: config.candidateCount,
    };

    this.statusBar.setLoading();

    try {
      const rawResponses = await this.client.complete(prompt, options);

      if (token.isCancellationRequested) {
        this.statusBar.setIdle();
        return undefined;
      }

      this.statusBar.setIdle();

      const predictions = rawResponses
        .map((rawResponse) =>
          parseCompletion(
            rawResponse,
            promptCtx.editableRegion,
            promptCtx.editStartLine,
          ),
        )
        .filter(hasCompletion);

      if (predictions.length === 0) {
        this.diffRenderer.clear();
        return undefined;
      }

      const uniquePredictions: ActiveParsedCompletion[] = [];
      const seen = new Set<string>();

      for (const prediction of predictions) {
        const key =
          prediction.type === "insertion"
            ? `insert:${prediction.text}`
            : `edit:${prediction.newContent}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        uniquePredictions.push(prediction);
      }

      if (uniquePredictions.length === 0) {
        this.diffRenderer.clear();
        return undefined;
      }

      const editRange = (() => {
        const endLine = promptCtx.editEndLine;
        const endLineLength = document.lineAt(endLine).text.length;
        return new vscode.Range(
          new vscode.Position(promptCtx.editStartLine, 0),
          new vscode.Position(endLine, endLineLength),
        );
      })();

      const insertRange = new vscode.Range(position, position);

      const completions = uniquePredictions.map((prediction) => {
        if (prediction.type === "insertion") {
          return new vscode.InlineCompletionItem(prediction.text, insertRange);
        }
        const completion = new vscode.InlineCompletionItem(
          prediction.newContent,
          editRange,
        );
        completion.command = {
          command: "jitu.dismissDiff",
          title: "Dismiss pending diff",
        };
        return completion;
      });

      const firstPrediction = uniquePredictions[0];
      const activeEditor = vscode.window.activeTextEditor;
      if (
        firstPrediction &&
        firstPrediction.type === "edit" &&
        activeEditor &&
        activeEditor.document.uri.toString() === document.uri.toString()
      ) {
        this.diffRenderer.showDiff(activeEditor, {
          documentUri: document.uri,
          diffs: firstPrediction.diffs,
          editRange,
          newContent: firstPrediction.newContent,
        });
      } else {
        this.diffRenderer.clear();
      }

      return completions;
    } catch (err: unknown) {
      this.diffRenderer.clear();
      this.statusBar.setIdle();
      if (err instanceof Error && err.name === "AbortError") {
        return undefined;
      }
      console.error("[Jitu] Completion error:", err);
      this.statusBar.setError(
        err instanceof Error ? err.message : "Unknown error",
      );
      return undefined;
    }
  }

  private debounce(
    ms: number,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        resolve(!token.isCancellationRequested);
      }, ms);

      token.onCancellationRequested(() => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        resolve(false);
      });
    });
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.diagnosticsDebounce) {
      clearTimeout(this.diagnosticsDebounce);
    }
    if (this.diagnosticsDisposable) {
      this.diagnosticsDisposable.dispose();
    }
    this.client.dispose();
  }
}
