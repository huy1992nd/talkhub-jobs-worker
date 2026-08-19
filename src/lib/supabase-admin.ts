import { createClient } from '@supabase/supabase-js';
import type { Env } from '../types';

export function createAdminClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(env: Env, jwt: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function assertCanEditProject(env: Env, jwt: string, projectId: string) {
  const client = createUserClient(env, jwt);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error('Unauthorized');

  const admin = createAdminClient(env);
  const { data, error } = await admin.rpc('can_edit_project', { p_project_id: projectId });
  if (error) {
    const { data: member } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
      throw new Error('Forbidden');
    }
    return userData.user;
  }
  if (!data) throw new Error('Forbidden');
  return userData.user;
}
