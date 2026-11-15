import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  NOMIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  MODEL: z.string().optional(),
  FALLBACK_MODEL: z.string().optional(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('./data'),
  ADMIN_TOKEN: z.string().optional(),

  MAX_ROUNDS: z.coerce.number().default(2),
  MAX_QUERIES_PER_CALL: z.coerce.number().default(10),
  MAX_QUERIES_PER_TURN: z.coerce.number().default(10),
  MAX_READS: z.coerce.number().default(2),
  MAX_EVIDENCE_CHARS: z.coerce.number().default(12000),
  MEMORY_TOKEN_CAP: z.coerce.number().default(2000),
  DEADLINE_MS: z.coerce.number().default(60000),
  RESERVE_FOR_ANSWER_MS: z.coerce.number().default(25000),
  SEARCH_TIMEOUT_BASIC_MS: z.coerce.number().default(10000),
  SEARCH_TIMEOUT_ADVANCED_MS: z.coerce.number().default(20000),

  NOW_OVERRIDE: z.string().optional(),
  SEED_DEMO: z.string().optional(),
  FAULT: z.enum(['tavily_down', 'gemini_429', 'groq_429', 'query_timeout']).optional(),
});

const parsed = envSchema.parse(process.env);

export interface BudgetCfg {
  maxRounds: number;
  maxPerCall: number;
  maxQueries: number;
  maxReads: number;
  maxEvidenceChars: number;
  deadlineMs: number;
  reserveForAnswerMs: number;
}

const defaultModel = parsed.GEMINI_API_KEY || !parsed.GROQ_API_KEY ? 'gemini-3.5-flash' : 'openai/gpt-oss-120b';
const defaultFallback = parsed.GEMINI_API_KEY || !parsed.GROQ_API_KEY ? 'gemini-3.5-flash-lite' : 'openai/gpt-oss-20b';

const notices: string[] = [];
if (!parsed.GEMINI_API_KEY && !parsed.GROQ_API_KEY) {
  notices.push('The server has no LLM API key yet. Add GEMINI_API_KEY to .env and restart.');
}
if (!parsed.TAVILY_API_KEY) {
  notices.push('Web search is switched off, so I can only use our notes and what you tell me.');
}

const host = parsed.HOST;
const port = parsed.PORT;

const allowedHosts = new Set<string>([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  '127.0.0.1',
  'localhost',
  `[::1]:${port}`,
  '[::1]',
]);
if (host !== '127.0.0.1' && host !== 'localhost') {
  allowedHosts.add(host);
  allowedHosts.add(`${host}:${port}`);
}

const allowedOrigins = new Set<string>([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://[::1]:${port}`,
]);
if (host !== '127.0.0.1' && host !== 'localhost') {
  allowedOrigins.add(`http://${host}:${port}`);
  allowedOrigins.add(`https://${host}:${port}`);
}

export const cfg = {
  geminiKey: parsed.GEMINI_API_KEY || '',
  nomicKey: parsed.NOMIC_API_KEY || '',
  groqKey: parsed.GROQ_API_KEY || '',
  tavilyKey: parsed.TAVILY_API_KEY || '',
  model: parsed.MODEL || defaultModel,
  fallbackModel: parsed.FALLBACK_MODEL || defaultFallback,
  host: parsed.HOST,
  port: parsed.PORT,
  dataDir: parsed.DATA_DIR,
  adminToken: parsed.ADMIN_TOKEN,
  features: {
    search: Boolean(parsed.TAVILY_API_KEY),
    llm: Boolean(parsed.GEMINI_API_KEY || parsed.GROQ_API_KEY),
    embeddings: Boolean(parsed.NOMIC_API_KEY || parsed.GEMINI_API_KEY),
  },
  budget: {
    maxRounds: parsed.MAX_ROUNDS,
    maxPerCall: parsed.MAX_QUERIES_PER_CALL,
    maxQueries: parsed.MAX_QUERIES_PER_TURN,
    maxReads: parsed.MAX_READS,
    maxEvidenceChars: parsed.MAX_EVIDENCE_CHARS,
    deadlineMs: parsed.DEADLINE_MS,
    reserveForAnswerMs: parsed.RESERVE_FOR_ANSWER_MS,
  } as BudgetCfg,
  memoryTokenCap: parsed.MEMORY_TOKEN_CAP,
  timeouts: {
    searchBasic: parsed.SEARCH_TIMEOUT_BASIC_MS,
    searchAdvanced: parsed.SEARCH_TIMEOUT_ADVANCED_MS,
  },
  fault: parsed.FAULT,
  seedDemo: Boolean(parsed.SEED_DEMO && parsed.SEED_DEMO !== '0'),
  notices,
  allowedHosts,
  allowedOrigins,
};
