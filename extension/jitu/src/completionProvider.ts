import * as vscode from "vscode";
import { CompletionClient, CompletionOptions } from "./types";
import { buildPrompt, buildPromptContext } from "./promptBuilder";
import { extractInlineCompletion } from "./responseParser";
import { getConfig } from "./config";
import { StatusBar } from "./statusBar";

const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "go",
  "rust",
]);

export class JituCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private client: CompletionClient,
    private statusBar: StatusBar,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = getConfig();

    if (!config.enabled) {
      return undefined;
    }

    if (!SUPPORTED_LANGUAGES.has(document.languageId)) {
      return undefined;
    }

    // Skip empty lines preceded by empty lines
    if (position.line > 0) {
      const currentLine = document.lineAt(position.line).text.trim();
      const prevLine = document.lineAt(position.line - 1).text.trim();
      if (currentLine === "" && prevLine === "") {
        return undefined;
      }
    }

    // Debounce: wait for the configured delay
    if (config.triggerMode === "onPause") {
      const shouldProceed = await this.debounce(config.debounceMs, token);
      if (!shouldProceed) {
        return undefined;
      }
    }

    if (token.isCancellationRequested) {
      return undefined;
    }

    // Build prompt
    const promptCtx = buildPromptContext(document, position, config.contextLines);
    const prompt = buildPrompt(promptCtx);

    const options: CompletionOptions = {
      model: config.model,
      maxTokens: config.maxTokens,
      stop: [">>>>>>> UPDATED"],
      temperature: 0,
    };

    this.statusBar.setLoading();

    try {
      const rawResponse = await this.client.complete(prompt, options);

      if (token.isCancellationRequested) {
        this.statusBar.setIdle();
        return undefined;
      }

      const completion = extractInlineCompletion(
        rawResponse,
        promptCtx.editableRegion,
      );

      this.statusBar.setIdle();

      if (!completion) {
        return undefined;
      }

      return [
        new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position),
        ),
      ];
    } catch (err: unknown) {
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
    this.client.dispose();
  }
}
