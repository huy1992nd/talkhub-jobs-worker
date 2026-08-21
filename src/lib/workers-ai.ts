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
