const DEFAULT_ORIGINS = [
  'https://talkhub-manager-web.onrender.com',
  'http://localhost:5174',
];

export function parseAllowedOrigins(raw?: string): string[] {
  if (!raw?.trim()) return DEFAULT_ORIGINS;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit & { cors?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.cors) {
    for (const [k, v] of Object.entries(init.cors)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(
  message: string,
  status: number,
  cors: HeadersInit,
): Response {
  return jsonResponse({ error: message }, { status, cors });
}
