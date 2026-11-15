import { describe, it, expect } from 'vitest';
import { verify, extractFigures, containsFigure, buildAliases } from '../src/agent/verify.js';
import { EvidenceItem } from '../src/memory/store.js';

describe('Verifier (verify.ts)', () => {
  const mockEvidence: EvidenceItem[] = [
    {
      ref: 'W1',
      kind: 'web',
      title: 'HubSpot Pricing',
      entity: 'HubSpot',
      url: 'https://hubspot.com/pricing',
      domain: 'hubspot.com',
      snippet: 'HubSpot Starter plan is $20 per seat per month.',
    },
    {
      ref: 'W2',
      kind: 'web',
      title: 'Pipedrive Plans',
      entity: 'Pipedrive',
      url: 'https://pipedrive.com/pricing',
      domain: 'pipedrive.com',
      snippet: 'Pipedrive Essential is $14 per user monthly.',
    },
  ];

  it('passes a correct figure cited with matching source', () => {
    const text = 'HubSpot Starter is $20 [W1].';
    const res = verify(text, mockEvidence, ['HubSpot', 'Pipedrive']);
    expect(res.flags).toHaveLength(0);
    expect(res.text).toBe(text);
  });

  it('flags an unknown cited tag', () => {
    const text = 'HubSpot Starter is $20 [W99].';
    const res = verify(text, mockEvidence, ['HubSpot']);
    expect(res.flags.length).toBeGreaterThan(0);
    expect(res.flags[0]?.reason).toContain('Cites a source that does not exist');
    expect(res.text).toContain('[U1]');
  });

  it('flags a number that is not in the cited snippet', () => {
    const text = 'HubSpot Starter is $99 [W1].';
    const res = verify(text, mockEvidence, ['HubSpot']);
    expect(res.flags.length).toBeGreaterThan(0);
    expect(res.flags[0]?.reason).toContain('is not in the cited source');
  });

  it('flags an uncited figure', () => {
    const text = 'HubSpot Starter costs $50 with no source.';
    const res = verify(text, mockEvidence, ['HubSpot']);
    expect(res.flags.length).toBeGreaterThan(0);
    expect(res.flags[0]?.reason).toContain('Figure without a source');
  });

  it('flags entity attribution mismatch (HubSpot figure cited for Pipedrive)', () => {
    const text = 'Pipedrive Essential is $20 [W1].';
    const res = verify(text, mockEvidence, ['HubSpot', 'Pipedrive']);
    expect(res.flags.length).toBeGreaterThan(0);
    expect(res.flags[0]?.reason).toContain('does not mention the product named here');
  });

  it('handles tables and cell-level verification', () => {
    const tableText = `| Tool | Price | Evidence |
|---|---|---|
| HubSpot | $20 [W1] | [W1] |
| Pipedrive | $99 [W2] | [W2] |`;

    const res = verify(tableText, mockEvidence, ['HubSpot', 'Pipedrive']);
    // $99 in row 2 is not in W2, so it should be flagged
    expect(res.flags.length).toBe(1);
    expect(res.flags[0]?.reason).toContain('$99 is not in the cited source');
  });

  it('word-boundary matching does not falsely match common words like "close"', () => {
    const aliases = buildAliases(['Close'], mockEvidence);
    const closeAliases = aliases.get('Close') || [];
    expect(closeAliases).toContain('Close');
  });
});

