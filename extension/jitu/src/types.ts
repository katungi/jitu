export interface CompletionOptions {
  model: string;
  maxTokens: number;
  stop: string[];
  temperature: number;
}

export interface CompletionClient {
  complete(prompt: string, options: CompletionOptions): Promise<string>;
  cancel(): void;
  dispose(): void;
}

export interface CompletionResponse {
  id: string;
  choices: Array<{
    text: string;
    finish_reason: string | null;
  }>;
}

export interface JituConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  debounceMs: number;
  maxTokens: number;
  triggerMode: "onPause" | "always" | "manual";
  contextLines: number;
}

export interface PromptContext {
  prefix: string;
  suffix: string;
  editableRegion: string;
  filePath: string;
  editStartLine: number;
  editEndLine: number;
  diagnostics: string;
}
