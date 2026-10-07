/**
 * Accuracy check for the AI photo analysis against weighed meals.
 *
 *   pnpm --filter @ft/api ai:eval <folder>
 *
 * <folder> contains photos plus `truth.json`:
 *   [{ "file": "pasta.jpg", "text": "optional note", "kcal": 780,
 *      "items": [{ "name": "Spaghetti gekocht", "grams": 250 }, { "name": "Bolognese", "grams": 180 }] }]
 * `kcal` is optional (e.g. computed from package labels); grams are what you weighed.
 *
 * For every photo the real pipeline runs (Claude + BLS/OFF matching with the first candidate),
 * then total grams and kcal are compared. Prints a table and writes `report.json` into the folder.
 * Costs real API tokens (≈ $0.03 per photo with the default model); needs ANTHROPIC_API_KEY.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { get, N, round } from '@ft/shared';
import { createClaudeAnalyzer, type ImageMediaType } from '../src/ai/analyze.js';
import { matchItem } from '../src/ai/match.js';
import { blsToFood, loadBls } from '../src/foods/catalog.js';
import { indexItem, search } from '@ft/shared';

interface Truth {
  file: string;
  text?: string;
  kcal?: number;
  items: { name: string; grams: number }[];
}

const folder = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: ai-eval <folder with photos and truth.json>');
  process.exit(2);
}
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set');
  process.exit(2);
}

const truths = JSON.parse(readFileSync(join(folder, 'truth.json'), 'utf8')) as Truth[];
const bls = loadBls().foods.map(blsToFood);
const index = bls.map(indexItem);
const searchLocal = (q: string, n: number) =>
  search(index, q, n).map((h) => ({ food: h.item, score: h.score }));
const analyzer = createClaudeAnalyzer({
  apiKey: key,
  model: process.env.AI_MODEL ?? 'claude-opus-5-5',
  effort: (process.env.AI_EFFORT as 'medium') ?? 'medium',
});
const types: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const rows: Record<string, unknown>[] = [];
let cost = 0;
for (const t of truths) {
  const mediaType = types[extname(t.file).toLowerCase()];
  if (!mediaType) {
    console.warn(`skip ${t.file}: unsupported type`);
    continue;
  }
  const out = await analyzer.analyze({
    imageBase64: readFileSync(join(folder, t.file)).toString('base64'),
    mediaType,
    text: t.text ?? null,
  });
  cost += out.usage.costUsd;
  let kcal = 0;
  for (const item of out.items) {
    const best = matchItem(item, searchLocal)[0];
    if (best) kcal += (get(best.food.nutrients, N.kcal) * item.grams) / 100;
  }
  const gramsTrue = t.items.reduce((s, i) => s + i.grams, 0);
  const gramsAi = out.items.reduce((s, i) => s + i.grams, 0);
  rows.push({
    file: t.file,
    items: `${out.items.length}/${t.items.length}`,
    gramsTrue,
    gramsAi: round(gramsAi, 0),
    gramsErrPct: round(((gramsAi - gramsTrue) / gramsTrue) * 100, 1),
    kcalTrue: t.kcal ?? null,
    kcalAi: round(kcal, 0),
    kcalErrPct: t.kcal ? round(((kcal - t.kcal) / t.kcal) * 100, 1) : null,
    recognized: out.items.map((i) => `${i.name} ${round(i.grams, 0)}g`).join(', '),
  });
}
console.table(rows.map(({ recognized: _r, ...r }) => r));
const abs = (k: string) => {
  const v = rows.map((r) => r[k]).filter((x): x is number => typeof x === 'number');
  return v.length ? round(v.reduce((s, x) => s + Math.abs(x), 0) / v.length, 1) : null;
};
const summary = {
  photos: rows.length,
  meanAbsGramsErrPct: abs('gramsErrPct'),
  meanAbsKcalErrPct: abs('kcalErrPct'),
  costUsd: round(cost, 3),
};
console.log(summary);
writeFileSync(
  join(folder, 'report.json'),
  JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2),
);
