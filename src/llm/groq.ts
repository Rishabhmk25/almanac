import { Groq } from 'groq-sdk';
import { cfg } from '../config.js';

let groqClient: Groq | null = null;

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
  const modelsToTry = [cfg.model, cfg.fallbackModel];

  let lastError: unknown = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opts.signal.aborted) throw new Error('Aborted');

      try {
        const stream = await client.chat.completions.create(
          {
            model,
            messages: opts.messages as any,
            tools: (opts.tools as any) || undefined,
            tool_choice: opts.tools ? 'auto' : undefined,
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
        // If aborted, check if we have content
        if (opts.signal.aborted) {
          throw err;
        }

        const status = err?.status || err?.statusCode;
        if (status === 429) {
          // On rate limit, break immediately to try fallback model
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

