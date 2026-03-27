import { CompletionClient, CompletionOptions, CompletionResponse } from "./types";
import { Logger } from "./logger";

export class HttpCompletionClient implements CompletionClient {
  private abortController: AbortController | null = null;

  constructor(
    private endpoint: string,
    private apiKey: string,
    private logger?: Logger,
  ) {}

  async complete(
    prompt: string,
    options: CompletionOptions,
  ): Promise<string[]> {
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
      n: options.candidateCount,
    });

    this.logger?.info(
      `POST ${url} (model=${options.model}, maxTokens=${options.maxTokens}, n=${options.candidateCount}, promptChars=${prompt.length})`,
    );
    const start = Date.now();

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: this.abortController.signal,
    });

    const elapsed = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      this.logger?.error(`Response ${response.status} (${elapsed}ms): ${text}`);
      throw new Error(`API request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as CompletionResponse;
    const choices = (data.choices ?? [])
      .map((choice) => choice.text ?? "")
      .filter((choice) => choice.length > 0);

    this.logger?.info(
      `Response 200 (${elapsed}ms): ${choices.length} choice(s)`,
    );

    if (choices.length === 0) {
      return [""];
    }

    return choices;
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
