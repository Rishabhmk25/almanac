import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/migrate.js';
import {
  generateDeterministicEmbedding,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
  normalizeVector,
  embedText,
} from '../src/memory/embeddings.js';
import {
  storeEmbedding,
  getEmbedding,
  vectorSearch,
  hybridSearch,
  addMessage,
  getOrCreateConversation,
} from '../src/memory/store.js';

describe('Embeddings & Hybrid Search (embeddings.ts & store.ts)', () => {
  beforeEach(() => {
    getDb(':memory:');
  });

  it('normalizes vector to unit L2 norm', () => {
    const raw = new Float32Array([3, 4]); // 3^2 + 4^2 = 25 -> sqrt = 5 -> [0.6, 0.8]
    const norm = normalizeVector(raw);
    expect(norm[0]).toBeCloseTo(0.6, 5);
    expect(norm[1]).toBeCloseTo(0.8, 5);

    // Magnitude should be 1
    const mag = Math.sqrt(norm[0]! * norm[0]! + norm[1]! * norm[1]!);
    expect(mag).toBeCloseTo(1.0, 5);
  });

  it('computes cosine similarity accurately', () => {
    const v1 = normalizeVector(new Float32Array([1, 0, 0]));
    const v2 = normalizeVector(new Float32Array([1, 0, 0]));
    const v3 = normalizeVector(new Float32Array([0, 1, 0]));

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0, 5);
  });

  it('serializes vector to SQLite BLOB and reconstructs with exact precision', () => {
    const original = generateDeterministicEmbedding('managed Postgres database');
    const blob = vectorToBlob(original);
    const restored = blobToVector(blob);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBe(original[i]);
    }
  });

  it('stores and retrieves embeddings from SQLite', () => {
    const conv = getOrCreateConversation(null, 'UTC', 'Test Embedding Chat');
    const msg = addMessage(conv.id, 'user', 'Postgres hosting on Supabase and Neon');
    const vec = generateDeterministicEmbedding(msg.content);
    storeEmbedding(msg.id, vec);

    const stored = getEmbedding(msg.id);
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(vec.length);
    expect(cosineSimilarity(vec, stored!)).toBeCloseTo(1.0, 5);
  });

  it('vector search retrieves semantically similar message', () => {
    const conv = getOrCreateConversation(null, 'UTC', 'Search Test');
    const m1 = addMessage(conv.id, 'user', 'What are good Postgres database hosting options?');
    const m2 = addMessage(conv.id, 'user', 'How to bake sourdough bread at home?');

    storeEmbedding(m1.id, generateDeterministicEmbedding(m1.content));
    storeEmbedding(m2.id, generateDeterministicEmbedding(m2.content));

    const queryVec = generateDeterministicEmbedding('database provider options');
    const results = vectorSearch(queryVec, undefined, 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe(m1.id);
  });

  it('hybrid search combines BM25 keyword matching and vector semantic similarity via RRF', () => {
    const conv = getOrCreateConversation(null, 'UTC', 'Hybrid Test');
    const m1 = addMessage(conv.id, 'user', 'Discussion on Monday shortlisting CRM tools for sales');
    const m2 = addMessage(conv.id, 'user', 'Comparison of managed Postgres providers');

    storeEmbedding(m1.id, generateDeterministicEmbedding(m1.content));
    storeEmbedding(m2.id, generateDeterministicEmbedding(m2.content));

    // Keyword match on CRM
    const keywordHits = hybridSearch('CRM', null);
    expect(keywordHits.some(h => h.id === m1.id)).toBe(true);

    // Semantic match on database
    const queryVec = generateDeterministicEmbedding('database providers');
    const semanticHits = hybridSearch(null, queryVec);
    expect(semanticHits.some(h => h.id === m2.id)).toBe(true);
  });

  it('embedText returns a 768-dimensional normalized vector', async () => {
    const vec = await embedText('HubSpot, Pipedrive, and Zoho CRM pricing', 'search_document');
    expect(vec.length).toBe(768);
    const mag = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 3);
  });
});
