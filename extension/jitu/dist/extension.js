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
var vscode5 = __toESM(require("vscode"));

// src/config.ts
var vscode = __toESM(require("vscode"));
function getConfig() {
  const config = vscode.workspace.getConfiguration("jitu");
  const endpoint = config.get("endpoint", "") || process.env.JITU_ENDPOINT || "";
  return {
    endpoint,
    apiKey: config.get("apiKey", ""),
    model: config.get("model", "zeta-2"),
    enabled: config.get("enabled", true),
    debounceMs: config.get("debounceMs", 300),
    maxTokens: config.get("maxTokens", 128),
    triggerMode: config.get("triggerMode", "onPause"),
    contextLines: config.get("contextLines", 100)
  };
}

// src/httpClient.ts
var HttpCompletionClient = class {
  constructor(endpoint, apiKey) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
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
      stop: options.stop
    });
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: this.abortController.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed (${response.status}): ${text}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.text ?? "";
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
var EDITABLE_REGION_LINES = 5;
function buildPromptContext(document, position, contextLines) {
  const totalLines = document.lineCount;
  const cursorLine = position.line;
  const editStart = Math.max(0, cursorLine - EDITABLE_REGION_LINES);
  const editEnd = Math.min(totalLines - 1, cursorLine + EDITABLE_REGION_LINES);
  const prefixStart = Math.max(0, editStart - contextLines);
  const prefix = document.getText(
    new vscode2.Range(prefixStart, 0, editStart, 0)
  );
  const suffixEnd = Math.min(totalLines, editEnd + 1 + contextLines);
  const suffix = document.getText(
    new vscode2.Range(editEnd + 1, 0, suffixEnd, 0)
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
  const workspaceFolder = vscode2.workspace.getWorkspaceFolder(document.uri);
  const filePath = workspaceFolder ? vscode2.workspace.asRelativePath(document.uri) : document.uri.fsPath;
  return { prefix, suffix, editableRegion, filePath };
}
function buildPrompt(ctx) {
  return `<[fim-suffix]>
${ctx.suffix}<[fim-prefix]><filename>${ctx.filePath}
${ctx.prefix}<<<<<<< CURRENT
${ctx.editableRegion}
=======
<[fim-middle]>`;
}

// src/responseParser.ts
function parseResponse(modelOutput, originalEditableRegion) {
  let cleaned = modelOutput;
  const updatedIdx = cleaned.indexOf(">>>>>>> UPDATED");
  if (updatedIdx !== -1) {
    cleaned = cleaned.slice(0, updatedIdx);
  }
  cleaned = cleaned.trimEnd();
  const originalClean = originalEditableRegion.replace("<|user_cursor|>", "").trimEnd();
  if (cleaned === originalClean) {
    return null;
  }
  return cleaned;
}
function extractInlineCompletion(modelOutput, originalEditableRegion) {
  const cursorMarker = "<|user_cursor|>";
  const cursorIdx = originalEditableRegion.indexOf(cursorMarker);
  if (cursorIdx === -1) {
    return parseResponse(modelOutput, originalEditableRegion);
  }
  const beforeCursor = originalEditableRegion.slice(0, cursorIdx);
  const afterCursor = originalEditableRegion.slice(cursorIdx + cursorMarker.length);
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
  if (!cleaned.startsWith(beforeCursor)) {
    return cleaned;
  }
  const modelAfterPrefix = cleaned.slice(beforeCursor.length);
  const afterTrimmed = afterCursor.trimEnd();
  if (modelAfterPrefix.endsWith(afterTrimmed) && afterTrimmed.length > 0) {
    const inserted = modelAfterPrefix.slice(
      0,
      modelAfterPrefix.length - afterTrimmed.length
    );
    return inserted || null;
  }
  return modelAfterPrefix || null;
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
  }
  debounceTimer = null;
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
    const promptCtx = buildPromptContext(document, position, config.contextLines);
    const prompt = buildPrompt(promptCtx);
    const options = {
      model: config.model,
      maxTokens: config.maxTokens,
      stop: [">>>>>>> UPDATED"],
      temperature: 0
    };
    this.statusBar.setLoading();
    try {
      const rawResponse = await this.client.complete(prompt, options);
      if (token.isCancellationRequested) {
        this.statusBar.setIdle();
        return void 0;
      }
      const completion = extractInlineCompletion(
        rawResponse,
        promptCtx.editableRegion
      );
      this.statusBar.setIdle();
      if (!completion) {
        return void 0;
      }
      return [
        new vscode3.InlineCompletionItem(
          completion,
          new vscode3.Range(position, position)
        )
      ];
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
    this.item.text = "$(loading~spin) Jitu";
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

// src/extension.ts
function activate(context) {
  const config = getConfig();
  const statusBar = new StatusBar();
  if (!config.enabled) {
    statusBar.setDisabled();
  }
  const client = new HttpCompletionClient(config.endpoint, config.apiKey);
  const provider = new JituCompletionProvider(client, statusBar);
  const providerDisposable = vscode5.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider
  );
  const toggleDisposable = vscode5.commands.registerCommand("jitu.toggle", () => {
    const current = vscode5.workspace.getConfiguration("jitu");
    const enabled = !current.get("enabled", true);
    current.update("enabled", enabled, vscode5.ConfigurationTarget.Global);
  });
  const triggerDisposable = vscode5.commands.registerCommand(
    "jitu.triggerCompletion",
    () => {
      vscode5.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }
  );
  const configDisposable = vscode5.workspace.onDidChangeConfiguration((e) => {
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
    { dispose: () => provider.dispose() }
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
