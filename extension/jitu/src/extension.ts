import * as vscode from "vscode";
import { getConfig } from "./config";
import { HttpCompletionClient } from "./httpClient";
import { JituCompletionProvider } from "./completionProvider";
import { StatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {
  const config = getConfig();

  const statusBar = new StatusBar();
  if (!config.enabled) {
    statusBar.setDisabled();
  }

  const client = new HttpCompletionClient(config.endpoint, config.apiKey);
  const provider = new JituCompletionProvider(client, statusBar);

  // Register inline completion provider for all files
  const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider,
  );

  // Toggle command
  const toggleDisposable = vscode.commands.registerCommand("jitu.toggle", () => {
    const current = vscode.workspace.getConfiguration("jitu");
    const enabled = !current.get<boolean>("enabled", true);
    current.update("enabled", enabled, vscode.ConfigurationTarget.Global);
  });

  // Manual trigger command
  const triggerDisposable = vscode.commands.registerCommand(
    "jitu.triggerCompletion",
    () => {
      vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    },
  );

  // React to config changes
  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
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
    { dispose: () => provider.dispose() },
  );
}

export function deactivate() {}
