import { createAdminClient } from '../lib/supabase-admin';
import { generateImageBytes, generateText, parseArticleJson } from '../lib/workers-ai';
import { applyTemplate, pickKeyword, PIPELINE_STEPS, scoreSeo } from './helpers';
import type { Env, JobConfig, JobRow } from '../types';

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMAGE_MODEL = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const JOB_ASSETS_BUCKET = 'job-assets';

async function startStep(admin: ReturnType<typeof createAdminClient>, runId: string, stepKey: string, sortOrder: number) {
  const { data, error } = await admin
    .from('job_run_steps')
    .insert({
      run_id: runId,
      step_key: stepKey,
      status: 'running',
      started_at: new Date().toISOString(),
      sort_order: sortOrder,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function finishStep(
  admin: ReturnType<typeof createAdminClient>,
  stepId: string,
  status: 'completed' | 'failed' | 'skipped',
  output?: Record<string, unknown>,
  errorMessage?: string,
) {
  await admin
    .from('job_run_steps')
    .update({
      status,
      output: output ?? null,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', stepId);
}

export async function runPipeline(env: Env, job: JobRow, runId: string, trigger: 'cron' | 'manual') {
  const admin = createAdminClient(env);
  const config = job.config ?? {};
  const textModel = config.textModel?.model ?? TEXT_MODEL;
  const imageModel = config.imageModel?.model ?? IMAGE_MODEL;

  await admin
    .from('job_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', runId);

  let keyword = '';
  let article = { title: '', body: '', metaDescription: '' };
  let imagePath: string | null = null;
  let imageAlt: string | null = null;
  let seo = { seoScore: 0, seoReport: { warnings: [] as string[], checks: {} as Record<string, boolean> } };

  try {
    // pick_keyword
    const step0 = await startStep(admin, runId, 'pick_keyword', 0);
    try {
      keyword = pickKeyword(config);
      await finishStep(admin, step0, 'completed', { keyword });
    } catch (err) {
      await finishStep(admin, step0, 'failed', undefined, err instanceof Error ? err.message : 'pick_keyword failed');
      throw err;
    }

    // generate_article
    const step1 = await startStep(admin, runId, 'generate_article', 1);
    try {
      const system =
        config.prompts?.articleSystem ??
        'You are a marketing writer. Output valid JSON only: {"title":"...","body":"markdown...","metaDescription":"..."}';
      const userTemplate =
        config.prompts?.articleUser ?? 'Write an SEO article about: {{keyword}}';
      const user = applyTemplate(userTemplate, { keyword });
      const raw = await generateText(env, textModel, system, user);
      article = parseArticleJson(raw);
      await finishStep(admin, step1, 'completed', { title: article.title, metaDescription: article.metaDescription });
    } catch (err) {
      await finishStep(admin, step1, 'failed', undefined, err instanceof Error ? err.message : 'generate_article failed');
      throw err;
    }

    // generate_image
    const step2 = await startStep(admin, runId, 'generate_image', 2);
    try {
      const promptTemplate =
        config.prompts?.imagePrompt ?? 'Blog hero image about {{keyword}}, modern friendly style';
      const prompt = applyTemplate(promptTemplate, { keyword });
      const bytes = await generateImageBytes(env, imageModel, prompt);
      imageAlt = `Hero image for ${keyword}`;

      const draftPlaceholderId = crypto.randomUUID();
      imagePath = `${job.project_id}/${draftPlaceholderId}/hero.png`;

      const { error: uploadError } = await admin.storage
        .from(JOB_ASSETS_BUCKET)
        .upload(imagePath, bytes, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;

      await finishStep(admin, step2, 'completed', { storagePath: imagePath, alt: imageAlt });
    } catch (err) {
      await finishStep(admin, step2, 'failed', undefined, err instanceof Error ? err.message : 'generate_image failed');
      imagePath = null;
    }

    // seo_validation
    const step3 = await startStep(admin, runId, 'seo_validation', 3);
    try {
      seo = scoreSeo(keyword, article.title, article.body, article.metaDescription, config.seoRules);
      await finishStep(admin, step3, 'completed', seo as unknown as Record<string, unknown>);
    } catch (err) {
      await finishStep(admin, step3, 'failed', undefined, err instanceof Error ? err.message : 'seo_validation failed');
      throw err;
    }

    // save_draft
    const step4 = await startStep(admin, runId, 'save_draft', 4);
    try {
      const { data: draft, error: draftError } = await admin
        .from('content_drafts')
        .insert({
          project_id: job.project_id,
          job_id: job.id,
          run_id: runId,
          keyword,
          title: article.title,
          body: article.body,
          meta_description: article.metaDescription,
          seo_score: seo.seoScore,
          seo_report: seo.seoReport,
          image_storage_path: imagePath,
          image_alt: imageAlt,
          status: 'pending_review',
        })
        .select('id')
        .single();
      if (draftError) throw draftError;

      if (imagePath && draft?.id) {
        const newPath = `${job.project_id}/${draft.id}/hero.png`;
        if (imagePath !== newPath) {
          const { data: file } = await admin.storage.from(JOB_ASSETS_BUCKET).download(imagePath);
          if (file) {
            await admin.storage.from(JOB_ASSETS_BUCKET).upload(newPath, file, { contentType: 'image/png', upsert: true });
            await admin.storage.from(JOB_ASSETS_BUCKET).remove([imagePath]);
            await admin.from('content_drafts').update({ image_storage_path: newPath }).eq('id', draft.id);
          }
        }
      }

      await finishStep(admin, step4, 'completed', { draftId: draft?.id });
      await admin
        .from('job_runs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), error_message: null })
        .eq('id', runId);

      return { runId, draftId: draft?.id, trigger, steps: PIPELINE_STEPS.length };
    } catch (err) {
      await finishStep(admin, step4, 'failed', undefined, err instanceof Error ? err.message : 'save_draft failed');
      throw err;
    }
  } catch (err) {
    await admin
      .from('job_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : 'Pipeline failed',
      })
      .eq('id', runId);
    throw err;
  }
}

export async function createRun(admin: ReturnType<typeof createAdminClient>, job: JobRow, trigger: 'cron' | 'manual') {
  const { data, error } = await admin
    .from('job_runs')
    .insert({
      job_id: job.id,
      project_id: job.project_id,
      trigger_type: trigger,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
