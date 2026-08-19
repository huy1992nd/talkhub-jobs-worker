import type { JobConfig } from '../types';

export function pickKeyword(config: JobConfig): string {
  const pool = config.keywordPool?.filter(Boolean) ?? [];
  if (!pool.length) throw new Error('keywordPool is empty');
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]!;
}

export function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface SeoResult {
  seoScore: number;
  seoReport: {
    warnings: string[];
    checks: Record<string, boolean>;
  };
}

export function scoreSeo(
  keyword: string,
  title: string,
  body: string,
  metaDescription: string,
  rules: JobConfig['seoRules'],
): SeoResult {
  const warnings: string[] = [];
  const checks: Record<string, boolean> = {};
  let score = 0;

  const maxTitle = rules?.maxTitleLength ?? 60;
  const titleOk = title.length > 0 && title.length <= maxTitle;
  checks.titleLength = titleOk;
  if (titleOk) score += 15;
  else warnings.push(`Title length should be ≤ ${maxTitle}`);

  const metaLen = metaDescription.length;
  const metaOk = metaLen >= 120 && metaLen <= 160;
  checks.metaDescription = metaOk;
  if (metaOk) score += 15;
  else if (metaLen) warnings.push('Meta description should be 120–160 chars');

  const kwLower = keyword.toLowerCase();
  const inTitle = title.toLowerCase().includes(kwLower);
  checks.keywordInTitle = inTitle;
  if (inTitle) score += 20;
  else if (rules?.requireKeywordInTitle !== false) warnings.push('Keyword missing from title');

  const firstPara = body.split('\n\n')[0]?.toLowerCase() ?? '';
  const inFirst = firstPara.includes(kwLower);
  checks.keywordInFirstParagraph = inFirst;
  if (inFirst) score += 15;

  const minWords = rules?.minWordCount ?? 400;
  const words = countWords(body.replace(/[#*_`>\[\]()!-]/g, ' '));
  const wordsOk = words >= minWords;
  checks.wordCount = wordsOk;
  if (wordsOk) score += 20;
  else warnings.push(`Body has ${words} words (min ${minWords})`);

  const hasH2 = /^##\s/m.test(body);
  checks.h2Headings = hasH2;
  if (hasH2) score += 15;

  return { seoScore: Math.min(100, score), seoReport: { warnings, checks } };
}

export const PIPELINE_STEPS = [
  'pick_keyword',
  'generate_article',
  'generate_image',
  'seo_validation',
  'save_draft',
] as const;
