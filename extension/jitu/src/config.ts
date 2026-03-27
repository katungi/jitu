import * as vscode from "vscode";
import { JituConfig } from "./types";

export function getConfig(): JituConfig {
  const config = vscode.workspace.getConfiguration("jitu");
  const endpoint = config.get<string>("endpoint", "") || process.env.JITU_ENDPOINT || "";
  const candidateCount = Math.min(
    5,
    Math.max(1, config.get<number>("candidateCount", 3)),
  );
  return {
    endpoint,
    apiKey: config.get<string>("apiKey", ""),
    model: config.get<string>("model", "zeta-2"),
    enabled: config.get<boolean>("enabled", true),
    debounceMs: config.get<number>("debounceMs", 120),
    maxTokens: config.get<number>("maxTokens", 64),
    candidateCount,
    triggerMode: config.get<"onPause" | "always" | "manual">("triggerMode", "onPause"),
    contextLines: config.get<number>("contextLines", 40),
  };
}
