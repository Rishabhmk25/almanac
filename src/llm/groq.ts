import { Groq } from 'groq-sdk';
import { cfg } from '../config.js';

let groqClient: Groq | null = null;
let lastGroqCallMs = 0;
const GROQ_MIN_INTERVAL_MS = 2200; // Enforces <= 27 RPM, safely below Groq 30 RPM limit
let pacerQueue: Promise<void> = Promise.resolve();

export async function throttleGroq(): Promise<void> {
  const previous = pacerQueue;
  let resolveNext: () => void;
  pacerQueue = new Promise<void>(resolve => {
    resolveNext = resolve;
  });

  try {
    await previous;
    const elapsed = Date.now() - lastGroqCallMs;
    if (elapsed < GROQ_MIN_INTERVAL_MS && lastGroqCallMs > 0) {
      await new Promise(r => setTimeout(r, GROQ_MIN_INTERVAL_MS - elapsed));
    }
    lastGroqCallMs = Date.now();
  } finally {
    resolveNext!();
  }
}

export function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: cfg.groqKey || 'missing', maxRetries: 1 });
  }
  return groqClient;
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface StreamRoundOpts {
  messages: ChatMsg[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  emit: (event: string, payload: unknown) => void;
  signal: AbortSignal;
}

export interface StreamRoundResult {
  content: string;
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export async function checkModels(): Promise<void> {
  if (!cfg.groqKey) return;
  try {
    const client = getGroqClient();
    const list = await client.models.list();
    const ids = new Set(list.data.map(m => m.id));
    if (!ids.has(cfg.model)) {
      console.warn(`[WARN] Configured primary model "${cfg.model}" was not found in Groq model list.`);
    }
  } catch {
    // Non-fatal warning at boot
  }
}

export async function streamRound(opts: StreamRoundOpts): Promise<StreamRoundResult> {
  if (cfg.fault === 'groq_429') {
    throw new Error('429 Rate limit exceeded (FAULT injected)');
  }
  if (!cfg.features.llm) {
    throw new Error('Groq API key is missing');
  }

  const client = getGroqClient();
  const modelsToTry = Array.from(new Set([
    cfg.model,
    cfg.fallbackModel,
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
  ])).filter(Boolean);

  let lastError: unknown = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opts.signal.aborted) throw new Error('Aborted');

      try {
        await throttleGroq();
        const stream = await client.chat.completions.create(
          {
            model,
            messages: opts.messages as any,
            tools: (opts.tools as any) || undefined,
            tool_choice: opts.tool_choice ?? (opts.tools ? 'auto' : undefined),
            temperature: 0.3,
            stream: true,
          },
          { signal: opts.signal }
        );

        let content = '';
        const toolCallsAccumulator: Record<
          number,
          { id: string; name: string; arguments: string }
        > = {};
        let textEmitted = false;

        for await (const chunk of stream) {
          if (opts.signal.aborted) {
            if (content.trim()) {
              // Return partial generated content rather than discarding what was already streamed
              const toolCalls = Object.values(toolCallsAccumulator).map(tc => ({
                id: tc.id || `call_${Math.random().toString(36).slice(2, 9)}`,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }));
              return { content, toolCalls };
            }
            throw new Error('Aborted');
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Handle tool calls accumulation
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            if (textEmitted && content.length > 0) {
              // Tool call arrived after text was emitted -> clear visible partial text
              opts.emit('reset', {});
              content = '';
              textEmitted = false;
            }

            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              const cur = toolCallsAccumulator[idx] || { id: '', name: '', arguments: '' };
              if (tc.id) cur.id += tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.arguments += tc.function.arguments;
              toolCallsAccumulator[idx] = cur;
            }
          }

          // Handle text streaming
          if (delta.content) {
            content += delta.content;
            textEmitted = true;
            opts.emit('token', { t: delta.content });
          }
        }

        const toolCalls = Object.values(toolCallsAccumulator).map(tc => ({
          id: tc.id || `call_${Math.random().toString(36).slice(2, 9)}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));

        return { content, toolCalls };
      } catch (err: any) {
        lastError = err;
        console.error(`[GROQ ERROR] model=${model} status=${err?.status} msg=${err?.message} code=${err?.error?.code || err?.code}`);
        // If aborted, check if we have content
        if (opts.signal.aborted) {
          throw err;
        }

        const status = err?.status || err?.statusCode;
        const msg = String(err?.message || '');
        const isDailyLimit = /tokens per day|TPD/i.test(msg);
        if (isDailyLimit) {
          console.warn(`[WARN] Daily limit reached for ${model}. Falling back to next model immediately.`);
          break;
        }

        if (err?.error?.code === 'tool_use_failed' || /tool call validation failed/i.test(msg)) {
          console.warn(`[WARN] Tool call generation format glitch on ${model}, retrying...`);
          if (attempt === 0) continue;
          break;
        }

        const isRateLimit = status === 429 || status === 413 || err?.error?.code === 'rate_limit_exceeded' || /rate_limit/i.test(msg);
        if (isRateLimit) {
          const hasAlternative = modelsToTry.indexOf(model) < modelsToTry.length - 1;
          if (hasAlternative) {
            console.warn(`[WARN] Rate limit hit for ${model}. Switching immediately to next available model.`);
            break;
          }
          const rawRetry = err?.headers?.get ? err.headers.get('retry-after') : err?.headers?.['retry-after'];
          const retrySec = Number(rawRetry) || 5;
          const waitMs = Math.min(10000, Math.max(2000, retrySec * 1000));
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (attempt === 0) continue;
          break;
        } else if (status >= 500 && status < 600) {
          // Quick retry on 5xx
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        // If other error, break to next model
        break;
      }
    }
  }

  throw lastError || new Error('Failed to run LLM completion');
}

