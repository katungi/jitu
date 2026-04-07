import * as vscode from "vscode";
import { getConfig } from "./config";
import { HttpCompletionClient } from "./httpClient";
import { JituCompletionProvider } from "./completionProvider";
import { StatusBar } from "./statusBar";
import { Logger } from "./logger";
import { DiffRenderer } from "./diffRenderer";

const COPILOT_EXTENSION_IDS = [
  "github.copilot",
  "github.copilot-chat",
];

async function checkCopilotConflict(): Promise<void> {
  const activeCopilot = COPILOT_EXTENSION_IDS.find((id) => {
    const ext = vscode.extensions.getExtension(id);
    return ext?.isActive;
  });

  if (!activeCopilot) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    "GitHub Copilot is active and may conflict with Jitu's inline completions. Disable Copilot for the best experience.",
    "Open Extensions",
    "Ignore",
  );

  if (choice === "Open Extensions") {
    vscode.commands.executeCommand(
      "workbench.extensions.search",
      "@installed copilot",
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  const logger = new Logger();
  logger.info("Extension activating...");
  const config = getConfig();

  const statusBar = new StatusBar();
  const diffRenderer = new DiffRenderer();
  if (!config.enabled) {
    statusBar.setDisabled();
  }

  const client = new HttpCompletionClient(config.endpoint, config.apiKey, logger);
  const provider = new JituCompletionProvider(client, statusBar, diffRenderer);

  const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider,
  );

  const toggleDisposable = vscode.commands.registerCommand("jitu.toggle", () => {
    const current = vscode.workspace.getConfiguration("jitu");
    const enabled = !current.get<boolean>("enabled", true);
    current.update("enabled", enabled, vscode.ConfigurationTarget.Global);
  });

  const triggerDisposable = vscode.commands.registerCommand(
    "jitu.triggerCompletion",
    () => {
      vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    },
  );

  const acceptDiffDisposable = vscode.commands.registerCommand(
    "jitu.acceptDiff",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      void diffRenderer.acceptDiff(editor);
    },
  );

  const dismissDiffDisposable = vscode.commands.registerCommand(
    "jitu.dismissDiff",
    () => {
      diffRenderer.clear();
    },
  );

  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("jitu")) {
      const updated = getConfig();
      client.updateConfig(updated.endpoint, updated.apiKey);
      if (updated.enabled) {
        statusBar.setIdle();
      } else {
        statusBar.setDisabled();
        diffRenderer.clear();
      }
    }
  });

  context.subscriptions.push(
    providerDisposable,
    toggleDisposable,
    triggerDisposable,
    acceptDiffDisposable,
    dismissDiffDisposable,
    configDisposable,
    diffRenderer,
    statusBar,
    logger,
    { dispose: () => provider.dispose() },
  );

  checkCopilotConflict();
}

export function deactivate() {}
