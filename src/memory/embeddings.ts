import { cfg } from '../config.js';
import { GoogleGenAI } from '@google/genai';

export const EMBEDDING_DIMENSIONS = 768;

// In-memory cache for embeddings (query / text -> Float32Array)
const embeddingCache = new Map<string, Float32Array>();
const MAX_CACHE_SIZE = 1000;

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && cfg.geminiKey) {
    geminiClient = new GoogleGenAI({ apiKey: cfg.geminiKey });
  }
  return geminiClient;
}

/**
 * Normalizes a Float32Array vector to unit length (L2 norm = 1).
 */
export function normalizeVector(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) {
    vec[i] = vec[i]! / norm;
  }
  return vec;
}

/**
 * Computes cosine similarity between two unit-normalized Float32Array vectors.
 * For normalized vectors, cosine similarity equals the dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Deterministic local semantic feature embedding generator (768 dimensions).
 * Used when running offline, in test suites, or when external API keys are not provided.
 * Builds a dense subword n-gram and token hash vector with L2 normalization.
 */
export function generateDeterministicEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIMENSIONS);
  const cleaned = text.toLowerCase().trim();
  if (!cleaned) return vec;

  // Token hash distribution
  const words = cleaned.split(/\s+/);
  for (const w of words) {
    if (!w) continue;
    let hash = 5381;
    for (let i = 0; i < w.length; i++) {
      hash = ((hash << 5) + hash + w.charCodeAt(i)) >>> 0;
    }
    const idx = hash % EMBEDDING_DIMENSIONS;
    vec[idx] = (vec[idx] ?? 0) + 1.0;

    // Character trigrams
    for (let i = 0; i < w.length - 2; i++) {
      const tri = (w.charCodeAt(i) * 31 + w.charCodeAt(i + 1) * 17 + w.charCodeAt(i + 2)) >>> 0;
      const triIdx = tri % EMBEDDING_DIMENSIONS;
      vec[triIdx] = (vec[triIdx] ?? 0) + 0.4;
    }
  }

  return normalizeVector(vec);
}

/**
 * Calls Nomic Embed API (nomic-embed-text-v1.5).
 */
async function fetchNomicEmbedding(
  text: string,
  taskType: 'search_query' | 'search_document' = 'search_document',
  signal?: AbortSignal
): Promise<Float32Array> {
  const prefixedText = taskType === 'search_query' ? `search_query: ${text}` : `search_document: ${text}`;
  const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.nomicKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'nomic-embed-text-v1.5',
      texts: [prefixedText],
      task_type: taskType,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Nomic API error HTTP ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { embeddings?: number[][] };
  const values = data.embeddings?.[0];
  if (!values || !Array.isArray(values)) {
    throw new Error('Nomic API returned empty embeddings');
  }

  return normalizeVector(new Float32Array(values));
}

/**
 * Calls Gemini text-embedding-004.
 */
async function fetchGeminiEmbedding(text: string): Promise<Float32Array> {
  const client = getGeminiClient();
  if (!client) throw new Error('Gemini client unavailable');

  const res = await client.models.embedContent({
    model: 'text-embedding-004',
    contents: [text],
  });

  const values = res.embeddings?.[0]?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('Gemini API returned empty embeddings');
  }

  return normalizeVector(new Float32Array(values));
}

/**
 * Embeds text using Nomic Embed API (primary), Gemini Embeddings (secondary),
 * or deterministic semantic feature vectors (offline / test).
 */
export async function embedText(
  text: string,
  taskType: 'search_query' | 'search_document' = 'search_document',
  signal?: AbortSignal
): Promise<Float32Array> {
  const cacheKey = `${taskType}:${text.trim().toLowerCase()}`;
  const cached = embeddingCache.get(cacheKey);
  if (cached) return cached;

  let resultVec: Float32Array;

  if (cfg.nomicKey) {
    try {
      resultVec = await fetchNomicEmbedding(text, taskType, signal);
    } catch (err) {
      console.warn(`[WARN] Nomic embed failed, falling back to secondary:`, err instanceof Error ? err.message : err);
      if (cfg.geminiKey) {
        try {
          resultVec = await fetchGeminiEmbedding(text);
        } catch {
          resultVec = generateDeterministicEmbedding(text);
        }
      } else {
        resultVec = generateDeterministicEmbedding(text);
      }
    }
  } else if (cfg.geminiKey) {
    try {
      resultVec = await fetchGeminiEmbedding(text);
    } catch {
      resultVec = generateDeterministicEmbedding(text);
    }
  } else {
    resultVec = generateDeterministicEmbedding(text);
  }

  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey) embeddingCache.delete(oldestKey);
  }
  embeddingCache.set(cacheKey, resultVec);

  return resultVec;
}
