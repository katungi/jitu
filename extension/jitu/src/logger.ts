import * as vscode from "vscode";

export class Logger {
  private channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("Jitu");
  }

  info(msg: string): void {
    this.channel.appendLine(`[INFO] ${new Date().toISOString()} - ${msg}`);
  }

  error(msg: string): void {
    this.channel.appendLine(`[ERROR] ${new Date().toISOString()} - ${msg}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
