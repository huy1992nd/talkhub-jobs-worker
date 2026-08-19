import { assertCanEditProject, createAdminClient } from '../lib/supabase-admin';
import type { ContentDraftRow, Env } from '../types';

const GRAPH_VERSION = 'v21.0';

export async function publishToFacebookPage(env: Env, jwt: string, draftId: string) {
  const admin = createAdminClient(env);

  const { data: draft, error: draftError } = await admin
    .from('content_drafts')
    .select('*, jobs(id, project_id, config)')
    .eq('id', draftId)
    .maybeSingle();

  if (draftError) throw draftError;
  if (!draft) throw new Error('Draft not found');

  const row = draft as ContentDraftRow & { jobs: { project_id: string; config: { channels?: { facebookPage?: { pageId?: string } } } } };
  await assertCanEditProject(env, jwt, row.project_id);

  if (row.status !== 'approved') {
    throw new Error('Draft must be approved before publish');
  }

  const pageId =
    row.jobs?.config?.channels?.facebookPage?.pageId?.trim() ||
    env.FACEBOOK_PAGE_ID?.trim();
  const token = env.FACEBOOK_PAGE_TOKEN?.trim();

  if (!pageId) throw new Error('Facebook Page ID not configured');
  if (!token) throw new Error('FACEBOOK_PAGE_TOKEN secret not configured');

  const captionParts = [row.title, row.meta_description, 'https://talkhub.pro'].filter(Boolean);
  const caption = captionParts.join('\n\n');

  let externalPostId: string | null = null;
  let permalink: string | null = null;
  let pagePostUrl: string | null = null;

  try {
    if (row.image_storage_path) {
      const { data: file, error: dlError } = await admin.storage
        .from('job-assets')
        .download(row.image_storage_path);
      if (dlError || !file) throw dlError ?? new Error('Could not download hero image');

      const form = new FormData();
      form.append('source', new Blob([await file.arrayBuffer()], { type: 'image/png' }), 'hero.png');
      form.append('caption', caption);
      form.append('access_token', token);

      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
        method: 'POST',
        body: form,
      });
      const body = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Facebook API error (${res.status})`);
      externalPostId = body.post_id ?? body.id ?? null;
    } else {
      const params = new URLSearchParams({
        message: caption,
        link: 'https://talkhub.pro',
        access_token: token,
      });
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`, {
        method: 'POST',
        body: params,
      });
      const body = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Facebook API error (${res.status})`);
      externalPostId = body.id ?? null;
    }

    if (externalPostId) {
      permalink = `https://www.facebook.com/${externalPostId}`;
      pagePostUrl = permalink;
    }

    await admin
      .from('content_drafts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', draftId);

    await admin.from('publish_queue').insert({
      draft_id: draftId,
      channel: 'facebook_page',
      status: 'sent',
      external_post_id: externalPostId,
      permalink,
      page_post_url: pagePostUrl,
      attempted_at: new Date().toISOString(),
    });

    return { draftId, externalPostId, permalink, pagePostUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish failed';
    await admin.from('content_drafts').update({ status: 'publish_failed' }).eq('id', draftId);
    await admin.from('publish_queue').insert({
      draft_id: draftId,
      channel: 'facebook_page',
      status: 'failed',
      error_message: message,
      attempted_at: new Date().toISOString(),
    });
    throw new Error(message);
  }
}
