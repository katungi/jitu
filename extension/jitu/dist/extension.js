"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/config.ts
var vscode = __toESM(require("vscode"));
function getConfig() {
  const config = vscode.workspace.getConfiguration("jitu");
  const endpoint = config.get("endpoint", "") || process.env.JITU_ENDPOINT || "";
  const candidateCount = Math.min(
    5,
    Math.max(1, config.get("candidateCount", 3))
  );
  return {
    endpoint,
    apiKey: config.get("apiKey", ""),
    model: config.get("model", "zeta-2"),
    enabled: config.get("enabled", true),
    debounceMs: config.get("debounceMs", 120),
    maxTokens: config.get("maxTokens", 64),
    candidateCount,
    triggerMode: config.get("triggerMode", "onPause"),
    contextLines: config.get("contextLines", 40)
  };
}

// src/httpClient.ts
var HttpCompletionClient = class {
  constructor(endpoint, apiKey, logger) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.logger = logger;
  }
  abortController = null;
  async complete(prompt, options) {
    this.cancel();
    this.abortController = new AbortController();
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const url = `${this.endpoint}/v1/completions`;
    const body = JSON.stringify({
      model: options.model,
      prompt,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stop,
      n: options.candidateCount
    });
    this.logger?.info(
      `POST ${url} (model=${options.model}, maxTokens=${options.maxTokens}, n=${options.candidateCount}, promptChars=${prompt.length})`
    );
    const start = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: this.abortController.signal
    });
    const elapsed = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      this.logger?.error(`Response ${response.status} (${elapsed}ms): ${text}`);
      throw new Error(`API request failed (${response.status}): ${text}`);
    }
    const data = await response.json();
    const choices = (data.choices ?? []).map((choice) => choice.text ?? "").filter((choice) => choice.length > 0);
    this.logger?.info(
      `Response 200 (${elapsed}ms): ${choices.length} choice(s)`
    );
    if (choices.length === 0) {
      return [""];
    }
    return choices;
  }
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  dispose() {
    this.cancel();
  }
  updateConfig(endpoint, apiKey) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }
};

// src/completionProvider.ts
var vscode3 = __toESM(require("vscode"));

// src/promptBuilder.ts
var vscode2 = __toESM(require("vscode"));
var EDITABLE_REGION_LINES = 8;
var MAX_PREFIX_CHARS = 3500;
var MAX_SUFFIX_CHARS = 2500;
var MAX_DIAGNOSTIC_ENTRIES = 6;
function buildPromptContext(document, position, contextLines) {
  const totalLines = document.lineCount;
  const cursorLine = position.line;
  const editStart = Math.max(0, cursorLine - EDITABLE_REGION_LINES);
  const editEnd = Math.min(totalLines - 1, cursorLine + EDITABLE_REGION_LINES);
  const prefixStart = Math.max(0, editStart - contextLines);
  const prefix = buildBoundedPrefixContext(
    document,
    prefixStart,
    editStart - 1,
    MAX_PREFIX_CHARS
  );
  const suffixEnd = Math.min(totalLines - 1, editEnd + contextLines);
  const suffix = buildBoundedSuffixContext(
    document,
    editEnd + 1,
    suffixEnd,
    MAX_SUFFIX_CHARS
  );
  const editableLines = [];
  for (let i = editStart; i <= editEnd; i++) {
    const lineText = document.lineAt(i).text;
    if (i === cursorLine) {
      const col = position.character;
      editableLines.push(
        lineText.slice(0, col) + "<|user_cursor|>" + lineText.slice(col)
      );
    } else {
      editableLines.push(lineText);
    }
  }
  const editableRegion = editableLines.join("\n");
  const diagnostics = buildDiagnosticContext(document.uri, cursorLine);
  const workspaceFolder = vscode2.workspace.getWorkspaceFolder(document.uri);
  const filePath = workspaceFolder ? vscode2.workspace.asRelativePath(document.uri) : document.uri.fsPath;
  return {
    prefix,
    suffix,
    editableRegion,
    filePath,
    editStartLine: editStart,
    editEndLine: editEnd,
    diagnostics
  };
}
function buildBoundedPrefixContext(document, startLine, endLine, maxChars) {
  if (endLine < startLine) {
    return "";
  }
  const lines = [];
  let chars = 0;
  for (let line = endLine; line >= startLine; line--) {
    const content = document.lineAt(line).text;
    const lineWithBreak = `${content}
`;
    if (chars + lineWithBreak.length > maxChars) {
      break;
    }
    lines.unshift(content);
    chars += lineWithBreak.length;
  }
  return lines.join("\n");
}
function buildBoundedSuffixContext(document, startLine, endLine, maxChars) {
  if (endLine < startLine) {
    return "";
  }
  const lines = [];
  let chars = 0;
  for (let line = startLine; line <= endLine; line++) {
    const content = document.lineAt(line).text;
    const lineWithBreak = `${content}
`;
    if (chars + lineWithBreak.length > maxChars) {
      break;
    }
    lines.push(content);
    chars += lineWithBreak.length;
  }
  return lines.join("\n");
}
function buildDiagnosticContext(uri, cursorLine) {
  const diagnostics = vscode2.languages.getDiagnostics(uri);
  const nearby = diagnostics.filter(
    (d) => Math.abs(d.range.start.line - cursorLine) < 15 && (d.severity === vscode2.DiagnosticSeverity.Error || d.severity === vscode2.DiagnosticSeverity.Warning)
  ).slice(0, MAX_DIAGNOSTIC_ENTRIES).map((d) => `// ${d.severity === vscode2.DiagnosticSeverity.Error ? "Error" : "Warning"} line ${d.range.start.line + 1}: ${d.message}`);
  return nearby.join("\n");
}
function buildPrompt(ctx) {
  const suffixBlock = ctx.suffix ? `${ctx.suffix}
` : "";
  const prefixBlock = ctx.prefix ? `${ctx.prefix}
` : "";
  let prompt = `<[fim-suffix]>
${suffixBlock}<[fim-prefix]>`;
  if (ctx.diagnostics) {
    prompt += `<filename>diagnostics
${ctx.diagnostics}

`;
  }
  prompt += `<filename>${ctx.filePath}
${prefixBlock}<<<<<<< CURRENT
${ctx.editableRegion}
=======
<[fim-middle]>`;
  return prompt;
}

// src/responseParser.ts
function cleanModelOutput(modelOutput) {
  let cleaned = modelOutput;
  const updatedIdx = cleaned.indexOf(">>>>>>> UPDATED");
  if (updatedIdx !== -1) {
    cleaned = cleaned.slice(0, updatedIdx);
  }
  cleaned = cleaned.replaceAll("<|user_cursor|>", "");
  return cleaned.trimEnd();
}
function extractEditPrediction(modelOutput, originalEditableRegion) {
  const cursorMarker = "<|user_cursor|>";
  const cleaned = cleanModelOutput(modelOutput);
  const originalClean = originalEditableRegion.replace(cursorMarker, "").trimEnd();
  if (cleaned === originalClean) {
    return null;
  }
  const cursorIdx = originalEditableRegion.indexOf(cursorMarker);
  if (cursorIdx === -1) {
    return { text: cleaned, isEdit: true };
  }
  const beforeCursor = originalEditableRegion.slice(0, cursorIdx);
  const afterCursor = originalEditableRegion.slice(
    cursorIdx + cursorMarker.length
  );
  if (cleaned.startsWith(beforeCursor)) {
    const modelAfterPrefix = cleaned.slice(beforeCursor.length);
    const afterTrimmed = afterCursor.trimEnd();
    if (afterTrimmed.length > 0 && modelAfterPrefix.endsWith(afterTrimmed)) {
      const inserted = modelAfterPrefix.slice(
        0,
        modelAfterPrefix.length - afterTrimmed.length
      );
      if (inserted) {
        return { text: inserted, isEdit: false };
      }
      return null;
    }
  }
  return { text: cleaned, isEdit: true };
}

// src/completionProvider.ts
var SUPPORTED_LANGUAGES = /* @__PURE__ */ new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "go",
  "rust"
]);
var JituCompletionProvider = class {
  constructor(client, statusBar) {
    this.client = client;
    this.statusBar = statusBar;
    this.diagnosticsDisposable = vscode3.languages.onDidChangeDiagnostics(
      (e) => {
        const editor = vscode3.window.activeTextEditor;
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
          const diagnostics = vscode3.languages.getDiagnostics(docUri);
          const hasNearby = diagnostics.some(
            (d) => Math.abs(d.range.start.line - cursorLine) < 15 && d.severity === vscode3.DiagnosticSeverity.Error
          );
          if (hasNearby) {
            vscode3.commands.executeCommand(
              "editor.action.inlineSuggest.trigger"
            );
          }
        }, 200);
      }
    );
  }
  debounceTimer = null;
  diagnosticsDebounce = null;
  diagnosticsDisposable = null;
  async provideInlineCompletionItems(document, position, _context, token) {
    const config = getConfig();
    if (!config.enabled) {
      return void 0;
    }
    if (!SUPPORTED_LANGUAGES.has(document.languageId)) {
      return void 0;
    }
    if (position.line > 0) {
      const currentLine = document.lineAt(position.line).text.trim();
      const prevLine = document.lineAt(position.line - 1).text.trim();
      if (currentLine === "" && prevLine === "") {
        return void 0;
      }
    }
    if (config.triggerMode === "onPause") {
      const shouldProceed = await this.debounce(config.debounceMs, token);
      if (!shouldProceed) {
        return void 0;
      }
    }
    if (token.isCancellationRequested) {
      return void 0;
    }
    const promptCtx = buildPromptContext(
      document,
      position,
      config.contextLines
    );
    const prompt = buildPrompt(promptCtx);
    const options = {
      model: config.model,
      maxTokens: config.maxTokens,
      stop: [">>>>>>> UPDATED"],
      temperature: 0,
      candidateCount: config.candidateCount
    };
    this.statusBar.setLoading();
    try {
      const rawResponses = await this.client.complete(prompt, options);
      if (token.isCancellationRequested) {
        this.statusBar.setIdle();
        return void 0;
      }
      this.statusBar.setIdle();
      const predictions = rawResponses.map(
        (rawResponse) => extractEditPrediction(rawResponse, promptCtx.editableRegion)
      ).filter((prediction) => Boolean(prediction));
      if (predictions.length === 0) {
        return void 0;
      }
      const uniquePredictions = [];
      const seen = /* @__PURE__ */ new Set();
      for (const prediction of predictions) {
        const key = `${prediction.isEdit ? "edit" : "insert"}:${prediction.text}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        uniquePredictions.push(prediction);
      }
      if (uniquePredictions.length === 0) {
        return void 0;
      }
      const editRange = (() => {
        const endLine = promptCtx.editEndLine;
        const endLineLength = document.lineAt(endLine).text.length;
        return new vscode3.Range(
          new vscode3.Position(promptCtx.editStartLine, 0),
          new vscode3.Position(endLine, endLineLength)
        );
      })();
      const insertRange = new vscode3.Range(position, position);
      return uniquePredictions.map((prediction) => {
        const range = prediction.isEdit ? editRange : insertRange;
        return new vscode3.InlineCompletionItem(prediction.text, range);
      });
    } catch (err) {
      this.statusBar.setIdle();
      if (err instanceof Error && err.name === "AbortError") {
        return void 0;
      }
      console.error("[Jitu] Completion error:", err);
      this.statusBar.setError(
        err instanceof Error ? err.message : "Unknown error"
      );
      return void 0;
    }
  }
  debounce(ms, token) {
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
  dispose() {
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
};

// src/statusBar.ts
var vscode4 = __toESM(require("vscode"));
var StatusBar = class {
  item;
  constructor() {
    this.item = vscode4.window.createStatusBarItem(
      vscode4.StatusBarAlignment.Right,
      100
    );
    this.item.command = "jitu.toggle";
    this.setIdle();
    this.item.show();
  }
  setIdle() {
    this.item.text = "$(sparkle) Jitu";
    this.item.tooltip = "Jitu - Click to toggle";
  }
  setLoading() {
    this.item.text = "$(sync~spin) Jitu";
    this.item.tooltip = "Jitu - Fetching completion...";
  }
  setDisabled() {
    this.item.text = "$(sparkle) Jitu (off)";
    this.item.tooltip = "Jitu - Disabled. Click to enable.";
  }
  setError(msg) {
    this.item.text = "$(error) Jitu";
    this.item.tooltip = `Jitu - Error: ${msg}`;
  }
  dispose() {
    this.item.dispose();
  }
};

// src/logger.ts
var vscode5 = __toESM(require("vscode"));
var Logger = class {
  channel;
  constructor() {
    this.channel = vscode5.window.createOutputChannel("Jitu");
  }
  info(msg) {
    this.channel.appendLine(`[INFO] ${(/* @__PURE__ */ new Date()).toISOString()} - ${msg}`);
  }
  error(msg) {
    this.channel.appendLine(`[ERROR] ${(/* @__PURE__ */ new Date()).toISOString()} - ${msg}`);
  }
  dispose() {
    this.channel.dispose();
  }
};

// src/extension.ts
var COPILOT_EXTENSION_IDS = [
  "github.copilot",
  "github.copilot-chat"
];
async function checkCopilotConflict() {
  const activeCopilot = COPILOT_EXTENSION_IDS.find((id) => {
    const ext = vscode6.extensions.getExtension(id);
    return ext?.isActive;
  });
  if (!activeCopilot) {
    return;
  }
  const choice = await vscode6.window.showWarningMessage(
    "GitHub Copilot is active and may conflict with Jitu's inline completions. Disable Copilot for the best experience.",
    "Open Extensions",
    "Ignore"
  );
  if (choice === "Open Extensions") {
    vscode6.commands.executeCommand(
      "workbench.extensions.search",
      "@installed copilot"
    );
  }
}
function activate(context) {
  const logger = new Logger();
  logger.info("Extension activating...");
  const config = getConfig();
  const statusBar = new StatusBar();
  if (!config.enabled) {
    statusBar.setDisabled();
  }
  const client = new HttpCompletionClient(config.endpoint, config.apiKey, logger);
  const provider = new JituCompletionProvider(client, statusBar);
  const providerDisposable = vscode6.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider
  );
  const toggleDisposable = vscode6.commands.registerCommand("jitu.toggle", () => {
    const current = vscode6.workspace.getConfiguration("jitu");
    const enabled = !current.get("enabled", true);
    current.update("enabled", enabled, vscode6.ConfigurationTarget.Global);
  });
  const triggerDisposable = vscode6.commands.registerCommand(
    "jitu.triggerCompletion",
    () => {
      vscode6.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }
  );
  const configDisposable = vscode6.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("jitu")) {
      const updated = getConfig();
      client.updateConfig(updated.endpoint, updated.apiKey);
      if (updated.enabled) {
        statusBar.setIdle();
      } else {
        statusBar.setDisabled();
      }
    }
  });
  context.subscriptions.push(
    providerDisposable,
    toggleDisposable,
    triggerDisposable,
    configDisposable,
    statusBar,
    logger,
    { dispose: () => provider.dispose() }
  );
  checkCopilotConflict();
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
