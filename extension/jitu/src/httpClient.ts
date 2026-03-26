import { CompletionClient, CompletionOptions, CompletionResponse } from "./types";

export class HttpCompletionClient implements CompletionClient {
  private abortController: AbortController | null = null;

  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {}

  async complete(prompt: string, options: CompletionOptions): Promise<string> {
    this.cancel();
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as CompletionResponse;
    return data.choices?.[0]?.text ?? "";
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  dispose(): void {
    this.cancel();
  }

  updateConfig(endpoint: string, apiKey: string): void {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }
}
