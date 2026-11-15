import { GoogleGenAI } from '@google/genai';
import { cfg } from '../config.js';
import { streamRoundGroq } from './groq.js';

let geminiClient: GoogleGenAI | null = null;
let lastGeminiCallMs = 0;
const GEMINI_MIN_INTERVAL_MS = 1000; // Pacer ensuring compliance with rate limits
let pacerQueue: Promise<void> = Promise.resolve();

export async function throttleGemini(): Promise<void> {
  const previous = pacerQueue;
  let resolveNext: () => void;
  pacerQueue = new Promise<void>(resolve => {
    resolveNext = resolve;
  });

  try {
    await previous;
    const elapsed = Date.now() - lastGeminiCallMs;
    if (elapsed < GEMINI_MIN_INTERVAL_MS && lastGeminiCallMs > 0) {
      await new Promise(r => setTimeout(r, GEMINI_MIN_INTERVAL_MS - elapsed));
    }
    lastGeminiCallMs = Date.now();
  } finally {
    resolveNext!();
  }
}

export function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: cfg.geminiKey || 'missing' });
  }
  return geminiClient;
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
    thoughtSignature?: string;
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
    thoughtSignature?: string;
  }>;
}

export async function checkModels(): Promise<void> {
  if (cfg.geminiKey) {
    try {
      getGeminiClient();
      console.log(`[BOOT] Gemini LLM engine initialized: primary=${cfg.model}, fallback=${cfg.fallbackModel}`);
    } catch {
      // Non-fatal warning at boot
    }
  } else if (cfg.groqKey) {
    console.log(`[BOOT] Groq LLM engine initialized: model=${cfg.model}`);
  }
}

const GEMINI_WEB_SEARCH_TOOL = {
  functionDeclarations: [
    {
      name: 'web_search',
      description: 'Search the web. Send a batch of queries, one per product or topic. The server runs them in parallel and returns tagged evidence. Optionally read the top result pages for exact pricing or spec figures.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          queries: {
            type: 'ARRAY' as const,
            description: '1 to 10 queries, one per product or entity.',
            items: {
              type: 'OBJECT' as const,
              properties: {
                q: { type: 'STRING' as const, description: 'Short keyword query with the product name.' },
                entity: { type: 'STRING' as const, description: 'The product or topic this query is about.' },
                kind: {
                  type: 'STRING' as const,
                  enum: ['current', 'news', 'changelog', 'other'],
                  description: 'current = pricing/status page; news = recent announcements; changelog = vendor blog or release notes.'
                },
                since: { type: 'STRING' as const, description: 'YYYY-MM-DD. Only for changelog queries after a date.' },
                read: { type: 'BOOLEAN' as const, description: 'Whether to read the top result pages.' }
              },
              required: ['q']
            }
          }
        },
        required: ['queries']
      }
    }
  ]
};

export async function streamRound(opts: StreamRoundOpts): Promise<StreamRoundResult> {
  if (cfg.fault === 'gemini_429' || (cfg.fault === 'groq_429' && !cfg.geminiKey)) {
    throw new Error('429 Rate limit exceeded (FAULT injected)');
  }
  if (!cfg.features.llm) {
    throw new Error('No LLM API key configured (neither GEMINI_API_KEY nor GROQ_API_KEY). Add GEMINI_API_KEY to .env.');
  }

  // If GEMINI_API_KEY is not set but GROQ_API_KEY is, delegate seamlessly to Groq
  if (!cfg.geminiKey && cfg.groqKey) {
    return streamRoundGroq(opts);
  }

  const client = getGeminiClient();
  const modelsToTry = Array.from(new Set([
    cfg.model,
    'gemini-3.6-flash',
    cfg.fallbackModel,
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
  ])).filter(Boolean);

  // Extract system instruction and convert messages to Gemini contents format
  const systemMsg = opts.messages.find(m => m.role === 'system');
  const systemInstruction = systemMsg?.content || undefined;

  const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

  for (const m of opts.messages) {
    if (m.role === 'system') continue;

    if (m.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text: m.content || '' }],
      });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {}
          const fcPart: Record<string, unknown> = {
            functionCall: {
              name: tc.function.name,
              args,
            },
          };
          if (tc.thoughtSignature) {
            fcPart.thoughtSignature = tc.thoughtSignature;
          }
          parts.push(fcPart);
        }
      }
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
    } else if (m.role === 'tool') {
      let parsedResponse: Record<string, unknown> = {};
      try {
        parsedResponse = JSON.parse(m.content || '{}');
      } catch {
        parsedResponse = { output: m.content || '' };
      }
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: 'web_search',
            response: parsedResponse,
          },
        }],
      });
    }
  }

  const tools = [GEMINI_WEB_SEARCH_TOOL];
  let toolConfig: any = undefined;

  if (opts.tools) {
    if (opts.tool_choice === 'required') {
      toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['web_search'],
        },
      };
    } else if (opts.tool_choice === 'none') {
      toolConfig = {
        functionCallingConfig: {
          mode: 'NONE',
        },
      };
    } else {
      toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      };
    }
  } else {
    toolConfig = {
      functionCallingConfig: {
        mode: 'NONE',
      },
    };
  }

  let lastError: unknown = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opts.signal.aborted) throw new Error('Aborted');

      try {
        await throttleGemini();

        const responseStream = await client.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
            tools: tools as any,
            toolConfig,
            temperature: 0.3,
            abortSignal: opts.signal,
          },
        });

        let content = '';
        const toolCalls: StreamRoundResult['toolCalls'] = [];
        let textEmitted = false;

        for await (const chunk of responseStream) {
          if (opts.signal.aborted) {
            if (content.trim() || toolCalls.length > 0) {
              return { content, toolCalls };
            }
            throw new Error('Aborted');
          }

          const chunkParts = (chunk.candidates?.[0]?.content?.parts || []) as Array<{
            functionCall?: { name?: string; args?: Record<string, unknown>; id?: string };
            thoughtSignature?: string;
          }>;

          let hadFcPart = false;
          for (const p of chunkParts) {
            if (p.functionCall) {
              hadFcPart = true;
              if (textEmitted && content.length > 0) {
                opts.emit('reset', {});
                content = '';
                textEmitted = false;
              }
              toolCalls.push({
                id: p.functionCall.id || `call_${Math.random().toString(36).slice(2, 9)}`,
                type: 'function',
                function: {
                  name: p.functionCall.name || 'web_search',
                  arguments: JSON.stringify(p.functionCall.args || {}),
                },
                thoughtSignature: p.thoughtSignature,
              });
            }
          }

          if (!hadFcPart && chunk.functionCalls && chunk.functionCalls.length > 0) {
            if (textEmitted && content.length > 0) {
              opts.emit('reset', {});
              content = '';
              textEmitted = false;
            }

            for (const fc of chunk.functionCalls) {
              toolCalls.push({
                id: `call_${Math.random().toString(36).slice(2, 9)}`,
                type: 'function',
                function: {
                  name: fc.name || 'web_search',
                  arguments: JSON.stringify(fc.args || {}),
                },
              });
            }
          }

          if (chunk.text) {
            content += chunk.text;
            textEmitted = true;
            opts.emit('token', { t: chunk.text });
          }
        }

        return { content, toolCalls };
      } catch (err: any) {
        lastError = err;
        console.error(`[GEMINI ERROR] model=${model} status=${err?.status} msg=${err?.message}`);

        if (opts.signal.aborted) throw err;

        const status = err?.status || err?.statusCode;
        const msg = String(err?.message || '');

        if (status === 429 || /quota|rate limit/i.test(msg)) {
          console.warn(`[WARN] Gemini rate limit hit for ${model}. Switching to fallback model.`);
          break;
        } else if (status >= 500 && status < 600) {
          await new Promise(resolve => setTimeout(resolve, 800));
          if (attempt === 0) continue;
          break;
        }
        break;
      }
    }
  }

  // If Gemini failed or is exhausted and Groq key is available, attempt Groq fallback
  if (cfg.groqKey) {
    console.warn('[WARN] Gemini attempts exhausted; attempting Groq fallback.');
    try {
      return await streamRoundGroq(opts);
    } catch {}
  }

  throw lastError || new Error('Failed to run LLM completion');
}
