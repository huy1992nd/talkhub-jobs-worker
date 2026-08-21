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

  // RPC uses auth.uid() — must call with the user's JWT, not service_role.
  const { data: canEdit, error: rpcError } = await client.rpc('can_edit_project', {
    p_project_id: projectId,
  });
  if (!rpcError && canEdit) return userData.user;

  const admin = createAdminClient(env);
  const { data: member } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (member?.role === 'owner' || member?.role === 'editor') {
    return userData.user;
  }

  const { data: project } = await admin
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle();
  if (project?.owner_id === userData.user.id) {
    return userData.user;
  }

  throw new Error('Forbidden');
}
