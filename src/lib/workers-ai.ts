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

export async function generateImageBytes(env: Env, model: string, prompt: string): Promise<ArrayBuffer> {
  const response = (await env.AI.run(model, { prompt })) as ArrayBuffer | Blob | { image?: string };

  if (response instanceof ArrayBuffer) return response;
  if (response instanceof Blob) return response.arrayBuffer();

  const b64 = (response as { image?: string }).image;
  if (b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  throw new Error('Unexpected Workers AI image response');
}

export function parseArticleJson(raw: string): { title: string; body: string; metaDescription: string } {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch?.[0] ?? trimmed;
  const parsed = JSON.parse(jsonText) as {
    title?: string;
    body?: string;
    metaDescription?: string;
    meta_description?: string;
  };
  return {
    title: parsed.title?.trim() || 'Untitled',
    body: parsed.body?.trim() || trimmed,
    metaDescription: (parsed.metaDescription ?? parsed.meta_description ?? '').trim(),
  };
}
