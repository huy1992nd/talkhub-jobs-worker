import type { Env } from '../types';

export async function generateText(env: Env, model: string, system: string, user: string): Promise<string> {
  const response = (await env.AI.run(model, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 4096,
  })) as { response?: string };

  if (typeof response?.response === 'string') return response.response;

  const alt = response as { result?: { response?: string } };
  if (typeof alt.result?.response === 'string') return alt.result.response;

  throw new Error('Unexpected Workers AI text response');
}

async function toArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  if (data instanceof Blob) return data.arrayBuffer();
  if (data instanceof ReadableStream) return new Response(data).arrayBuffer();
  if (data instanceof Response) return data.arrayBuffer();

  const obj = data as Record<string, unknown> | null;
  if (obj && typeof obj.image === 'string') {
    const binary = atob(obj.image);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  return null;
}

export async function generateImageBytes(env: Env, model: string, prompt: string): Promise<ArrayBuffer> {
  const response = await env.AI.run(model, { prompt });
  const bytes = await toArrayBuffer(response);
  if (bytes) return bytes;

  const kind = response === null ? 'null' : typeof response;
  const ctor = (response as object)?.constructor?.name ?? 'unknown';
  throw new Error(`Unexpected Workers AI image response (${kind}, ${ctor})`);
}

function stripMarkdownFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/** Read a JSON string value even when the model omitted \\n escapes (common LLM mistake). */
function extractQuotedField(json: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"`, 'i');
  const match = re.exec(json);
  if (!match) return null;

  let i = match.index + match[0].length;
  let out = '';
  while (i < json.length) {
    const ch = json[i]!;
    if (ch === '\\' && i + 1 < json.length) {
      const next = json[i + 1]!;
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return out;
}

function normalizeArticle(parsed: {
  title?: string;
  body?: string;
  metaDescription?: string;
  meta_description?: string;
}): { title: string; body: string; metaDescription: string } {
  return {
    title: parsed.title?.trim() || 'Untitled',
    body: parsed.body?.trim() || '',
    metaDescription: (parsed.metaDescription ?? parsed.meta_description ?? '').trim(),
  };
}

export function parseArticleJson(raw: string): { title: string; body: string; metaDescription: string } {
  const trimmed = stripMarkdownFence(raw);
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch?.[0] ?? trimmed;

  try {
    const parsed = JSON.parse(jsonText) as Parameters<typeof normalizeArticle>[0];
    const article = normalizeArticle(parsed);
    if (article.body) return article;
  } catch {
    // fall through — LLM often puts raw newlines inside "body"
  }

  const title = extractQuotedField(jsonText, 'title');
  const body = extractQuotedField(jsonText, 'body');
  const metaDescription =
    extractQuotedField(jsonText, 'metaDescription') ?? extractQuotedField(jsonText, 'meta_description');

  if (title || body) {
    return {
      title: title?.trim() || 'Untitled',
      body: body?.trim() || trimmed,
      metaDescription: metaDescription?.trim() || '',
    };
  }

  return {
    title: 'Untitled',
    body: trimmed,
    metaDescription: '',
  };
}
