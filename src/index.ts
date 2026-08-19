import { corsHeaders, errorResponse, jsonResponse, parseAllowedOrigins } from './cors';
import { createAdminClient } from './lib/supabase-admin';
import { assertCanEditProject } from './lib/supabase-admin';
import { createRun, runPipeline } from './pipeline/orchestrator';
import { publishToFacebookPage } from './publish/facebook-page';
import type { Env, JobRow } from './types';

function extractBearer(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function handleRun(env: Env, jobId: string, jwt: string, cors: HeadersInit) {
  const admin = createAdminClient(env);
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw error;
  if (!job) return errorResponse('Job not found', 404, cors);

  const row = job as JobRow;
  await assertCanEditProject(env, jwt, row.project_id);

  const run = await createRun(admin, row, 'manual');
  try {
    const result = await runPipeline(env, row, run.id, 'manual');
    return jsonResponse({ ok: true, ...result }, { cors });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Run failed', 500, cors);
  }
}

async function handlePublish(env: Env, draftId: string, jwt: string, cors: HeadersInit) {
  try {
    const result = await publishToFacebookPage(env, jwt, draftId);
    return jsonResponse({ ok: true, ...result }, { cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish failed';
    const status = message === 'Forbidden' || message === 'Unauthorized' ? 403 : 500;
    return errorResponse(message, status, cors);
  }
}

export async function handleScheduled(env: Env) {
  const admin = createAdminClient(env);
  const { data: jobs, error } = await admin.from('jobs').select('*').eq('status', 'active');
  if (error) {
    console.error('Cron: failed to list jobs', error.message);
    return;
  }

  for (const job of jobs ?? []) {
    const row = job as JobRow;
    try {
      const run = await createRun(admin, row, 'cron');
      await runPipeline(env, row, run.id, 'cron');
    } catch (err) {
      console.error(`Cron: job ${row.id} failed`, err);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && path === '/v1/health') {
      return jsonResponse({ ok: true, service: 'talkhub-jobs-worker' }, { cors });
    }

    const runMatch = path.match(/^\/v1\/run\/([0-9a-f-]{36})$/i);
    if (request.method === 'POST' && runMatch) {
      const jwt = extractBearer(request);
      if (!jwt) return errorResponse('Unauthorized', 401, cors);
      try {
        return await handleRun(env, runMatch[1]!, jwt, cors);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Run failed';
        const status = message === 'Forbidden' || message === 'Unauthorized' ? 403 : 500;
        return errorResponse(message, status, cors);
      }
    }

    const publishMatch = path.match(/^\/v1\/publish\/([0-9a-f-]{36})$/i);
    if (request.method === 'POST' && publishMatch) {
      const jwt = extractBearer(request);
      if (!jwt) return errorResponse('Unauthorized', 401, cors);
      return handlePublish(env, publishMatch[1]!, jwt, cors);
    }

    return errorResponse('Not found', 404, cors);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await handleScheduled(env);
  },
};
