import { EvidenceItem, Flag } from '../memory/store.js';

const ORDINARY_WORD_ENTITIES = new Set(['close', 'notion', 'linear', 'front', 'copper']);

export function buildAliases(entities: string[], ev: EvidenceItem[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  const addAlias = (key: string, alias: string) => {
    const k = key.trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(alias.trim());
  };

  for (const ent of entities) {
    if (!ent.trim()) continue;
    addAlias(ent, ent);
    // Strip generic suffixes: CRM, Inc, Sales, Hub, Platform
    const stripped = ent.replace(/\b(CRM|Inc|Sales|Hub|Platform|Software)\b/gi, '').trim();
    if (stripped.length >= 3 && stripped.toLowerCase() !== ent.toLowerCase()) {
      addAlias(ent, stripped);
    }
  }

  for (const item of ev) {
    if (item.entity) {
      addAlias(item.entity, item.entity);
      if (item.domain) {
        const domainLabel = item.domain.split('.')[0] || '';
        if (domainLabel.length >= 3) {
          addAlias(item.entity, domainLabel);
        }
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const [k, set] of map.entries()) {
    out.set(k, Array.from(set).filter(s => s.length >= 2));
  }
  return out;
}

export function citesIn(text: string): string[] {
  const matches = text.matchAll(/[\[【]([WM]\d+)[\]】]/gi);
  return Array.from(matches).map(m => (m[1] ?? '').toUpperCase()).filter(Boolean);
}

export function extractFigures(text: string): string[] {
  const figures: string[] = [];

  // 1. Currency amounts: $20, €15, £50, 20 USD, $1,500.00
  const currencyRegex = /(?:[\$\€\£\¥]\s*\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:USD|EUR|GBP|INR|CAD|AUD)\b)/gi;
  for (const m of text.matchAll(currencyRegex)) {
    figures.push(m[0].trim());
  }

  // 2. Percentages: 15%, 20.5%
  const percentRegex = /\b\d+(?:\.\d+)?\s*%/g;
  for (const m of text.matchAll(percentRegex)) {
    figures.push(m[0].trim());
  }

  // Capture small product limits when the number is paired with a quantitative unit.
  const quantityRegex = /\b(\d+(?:\.\d+)?)\s+(?:seats?|users?|days?|months?|years?|weeks?|teams?|projects?|items?|workspaces?|members?|integrations?|GB|TB)\b/gi;
  for (const m of text.matchAll(quantityRegex)) {
    figures.push(m[1] ?? '');
  }

  // 3. Numbers of 3 or more digits: 100, 1,200, 5000 (excluding years like 2026 if context implies date)
  const numbersRegex = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d{3,}(?:\.\d+)?\b/g;
  for (const m of text.matchAll(numbersRegex)) {
    // Avoid re-adding if already part of currency or percentage
    const raw = m[0].trim();
    if (!figures.some(f => f.includes(raw))) {
      // Don't flag recent calendar years (e.g. 2020-2030) as figures unless prefixed by currency
      const numVal = parseInt(raw.replace(/,/g, ''), 10);
      if (numVal >= 2020 && numVal <= 2035) {
        continue;
      }
      figures.push(raw);
    }
  }

  return figures;
}

export function normalizeFigure(fig: string): string {
  // Strip currency symbols, commas, percent, whitespace
  return fig.replace(/[\$\€\£\¥,%]|USD|EUR|GBP|INR|CAD|AUD/gi, '').trim();
}

export function containsFigure(snippet: string, fig: string): boolean {
  const norm = normalizeFigure(fig);
  if (!norm) return true;

  // Check if original figure is in snippet directly
  if (snippet.includes(fig)) return true;

  // Check if normalized figure is present as a number
  const regex = new RegExp(`(?<!\\d)${norm.replace('.', '\\.')}(?!\\d)`);
  return regex.test(snippet.replace(/,/g, ''));
}

export function entitiesNamedIn(text: string, aliases: Map<string, string[]>): string[] {
  const named: string[] = [];

  for (const [entity, aliasList] of aliases.entries()) {
    const isOrdinary = ORDINARY_WORD_ENTITIES.has(entity.toLowerCase());

    for (const alias of aliasList) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, isOrdinary ? '' : 'i');
      if (regex.test(text)) {
        named.push(entity);
        break;
      }
    }
  }

  return named;
}

export function itemMentions(item: EvidenceItem, aliasList: string[]): boolean {
  const corpus = `${item.title} ${item.domain || ''} ${item.snippet}`;
  for (const alias of aliasList) {
    const isOrdinary = ORDINARY_WORD_ENTITIES.has(alias.toLowerCase());
    if (isOrdinary && item.domain && item.domain.toLowerCase().includes(alias.toLowerCase())) {
      return true;
    }
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, isOrdinary ? '' : 'i');
    if (regex.test(corpus)) return true;
  }
  return false;
}

function splitSentences(text: string): string[] {
  // Split on period/question/exclamation followed by space or newline, without breaking decimals like 1.5
  return text.split(/(?<=[.?!])\s+(?=[A-Z0-9])/g);
}

export function verify(
  answer: string,
  ev: EvidenceItem[],
  entities: string[] = []
): { text: string; flags: Flag[] } {
  const normalizedAnswer = answer.replace(/[【]([WMU]\d+)[】]/g, '[$1]');
  const byRef = new Map(ev.map(e => [e.ref.toUpperCase(), e]));
  const aliases = buildAliases(entities, ev);
  const flags: Flag[] = [];

  const mark = (reason: string, details?: { claim?: string; sourceRef?: string; stale?: boolean }): string => {
    const id = `U${flags.length + 1}`;
    flags.push({
      id,
      reason,
      claim: details?.claim?.trim(),
      sourceRef: details?.sourceRef,
      stale: details?.stale,
    });
    return ` [${id}]`;
  };

  const lines = normalizedAnswer.split('\n');
  const processedLines: string[] = [];

  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Check if separator line e.g. |---|---|
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) {
        processedLines.push(line);
        inTable = true;
        continue;
      }

      // If header or normal table row
      const cells = trimmed.split('|').slice(1, -1);
      const rowCites = cells.flatMap(c => citesIn(c));
      const rowEntities = Array.from(new Set(cells.flatMap(c => entitiesNamedIn(c, aliases))));

      const processedCells = cells.map(cell => {
        let cellContent = cell.trim();
        const cites = [...citesIn(cellContent), ...(citesIn(cellContent).length === 0 ? rowCites : [])];
        const items = cites.map(r => byRef.get(r));
        const firstCite = cites[0];

        if (items.some(i => i === undefined)) {
          return ` ${cellContent}${mark('Cites a source that does not exist.', { claim: cellContent, sourceRef: firstCite })} `;
        }

        const nums = extractFigures(cellContent);
        if (nums.length > 0 && cites.length === 0) {
          return ` ${cellContent}${mark('Figure without a source.', { claim: cellContent })} `;
        }

        for (const n of nums) {
          if (!items.some(i => i && containsFigure(i.snippet, n))) {
            return ` ${cellContent}${mark(`${n} is not in the cited source.`, { claim: cellContent, sourceRef: firstCite })} `;
          }
        }

        const named = entitiesNamedIn(cellContent, aliases);
        const namedInRow = named.length ? named : rowEntities;
        if (nums.length > 0 && namedInRow.length > 0 && !items.some(i => i && namedInRow.some(e => itemMentions(i, aliases.get(e) ?? [])))) {
          return ` ${cellContent}${mark('The cited source does not mention the product named here.', { claim: cellContent, sourceRef: firstCite })} `;
        }

        // Stale/undated check on change assertions
        if (/\b(changed|increased|decreased|new price|updated pricing|announced)\b/i.test(cellContent)) {
          const webItem = items.find(i => i && i.kind === 'web');
          if (webItem && (!webItem.published || webItem.published === 'unknown')) {
            return ` ${cellContent}${mark('Cited source is undated or stale; cannot verify when the value changed.', { claim: cellContent, sourceRef: webItem.ref, stale: true })} `;
          }
        }

        return ` ${cellContent} `;
      });

      processedLines.push(`|${processedCells.join('|')}|`);
      inTable = true;
      continue;
    }

    inTable = false;

    // Normal paragraph line: process sentences
    const sentences = splitSentences(line);
    const processedSentences = sentences.map(seg => {
      const cites = citesIn(seg);
      const items = cites.map(r => byRef.get(r));
      const firstCite = cites[0];

      if (items.some(i => i === undefined)) {
        return seg + mark('Cites a source that does not exist.', { claim: seg, sourceRef: firstCite });
      }

      const nums = extractFigures(seg);
      if (nums.length > 0 && cites.length === 0) {
        return seg + mark('Figure without a source.', { claim: seg });
      }

      for (const n of nums) {
        if (!items.some(i => i && containsFigure(i.snippet, n))) {
          return seg + mark(`${n} is not in the cited source.`, { claim: seg, sourceRef: firstCite });
        }
      }

      const named = entitiesNamedIn(seg, aliases);
      if (nums.length > 0 && named.length > 0 && !items.some(i => i && named.some(e => itemMentions(i, aliases.get(e) ?? [])))) {
        return seg + mark('The cited source does not mention the product named here.', { claim: seg, sourceRef: firstCite });
      }

      // Stale/undated check on change assertions
      if (/\b(changed|increased|decreased|new price|updated pricing|announced)\b/i.test(seg)) {
        const webItem = items.find(i => i && i.kind === 'web');
        if (webItem && (!webItem.published || webItem.published === 'unknown')) {
          return seg + mark('Cited source is undated or stale; cannot verify when the value changed.', { claim: seg, sourceRef: webItem.ref, stale: true });
        }
      }

      return seg;
    });

    processedLines.push(processedSentences.join(' '));
  }

  return {
    text: processedLines.join('\n'),
    flags,
  };
}

