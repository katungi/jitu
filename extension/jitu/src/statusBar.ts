import * as vscode from "vscode";

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "jitu.toggle";
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text = "$(sparkle) Jitu";
    this.item.tooltip = "Jitu - Click to toggle";
  }

  setLoading(): void {
    this.item.text = "$(sync~spin) Jitu";
    this.item.tooltip = "Jitu - Fetching completion...";
  }

  setDisabled(): void {
    this.item.text = "$(sparkle) Jitu (off)";
    this.item.tooltip = "Jitu - Disabled. Click to enable.";
  }

  setError(msg: string): void {
    this.item.text = "$(error) Jitu";
    this.item.tooltip = `Jitu - Error: ${msg}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
