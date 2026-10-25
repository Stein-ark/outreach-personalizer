/**
 * The one small interface the rest of the server uses to talk to an AI model, plus an implementation for any
 * OpenAI compatible endpoint (Groq by default). Swapping providers means changing AI_BASE_URL, AI_API_KEY and
 * AI_MODEL, or adding another class that implements AiProvider.
 */
import OpenAI from 'openai';

export interface JsonCompletionRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface JsonCompletionResult {
  /** Raw JSON text from the model. Callers validate it with zod before using it. */
  content: string;
  usage: TokenUsage;
}

/** Errors are classified so the gateway can decide whether to retry. */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'transient' | 'invalid_output' | 'fatal',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Throws when the configured model is not available to this key. Called once at boot. */
  checkModel(): Promise<void>;
  completeJson(req: JsonCompletionRequest): Promise<JsonCompletionResult>;
}

export interface OpenAiCompatibleConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  reasoningEffort: 'low' | 'medium' | 'high' | 'none';
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
    // SDK retries are off: the gateway owns retry policy so 429 handling and the limiter stay consistent.
    this.client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0 });
  }

  async checkModel(): Promise<void> {
    try {
      await this.client.models.retrieve(this.model);
    } catch (err) {
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      if (status === 404) {
        throw new Error(
          `AI model "${this.model}" is not available from ${this.name}. It may have been retired. ` +
            `Check the provider's supported models and deprecations pages and set AI_MODEL.`,
        );
      }
      if (status === 401 || status === 403) throw new Error(`AI_API_KEY was rejected by ${this.name} (HTTP ${status}).`);
      throw new Error(`Could not verify AI model "${this.model}" with ${this.name}: ${(err as Error).message}`);
    }
  }

  async completeJson(req: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const reasoning =
      this.config.reasoningEffort === 'none'
        ? {}
        : // include_reasoning is a Groq extension for gpt-oss models. Hidden reasoning still counts toward usage,
          // so effort stays low and the reasoning text is never returned.
          { reasoning_effort: this.config.reasoningEffort, include_reasoning: false };
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_completion_tokens: req.maxOutputTokens,
        temperature: 0.4,
        response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        ...(reasoning as object),
      });
    } catch (err) {
      throw this.classify(err);
    }
    const choice = completion.choices[0];
    const content = choice?.message.content;
    if (!content || choice.finish_reason === 'length') {
      throw new ProviderError('invalid_output', `Model returned no usable content (finish_reason ${choice?.finish_reason ?? 'none'})`);
    }
    const u = completion.usage;
    return {
      content,
      usage: { prompt: u?.prompt_tokens ?? 0, completion: u?.completion_tokens ?? 0, total: u?.total_tokens ?? 0 },
    };
  }

  private classify(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIConnectionError) return new ProviderError('transient', 'AI provider connection failed or timed out');
    if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 0;
      if (status === 429) return new ProviderError('rate_limited', 'AI provider rate limit', parseRetryAfter(err.headers));
      if (status >= 500) return new ProviderError('transient', `AI provider error ${status}`);
      // Groq answers 400 when the model fails to produce output matching the schema.
      if (status === 400 && /json|schema|validat/i.test(err.message)) return new ProviderError('invalid_output', 'Model output failed schema');
      return new ProviderError('fatal', `AI provider rejected the request (${status})`);
    }
    return new ProviderError('fatal', 'Unexpected AI provider error');
  }
}
