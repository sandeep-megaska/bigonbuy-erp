import type { NextApiRequest } from "next";
import { createUserClient, getCookieAccessToken, getSupabaseEnv } from "../serverSupabase";

export type InternalManagerSession = {
  userId: string;
  isManager: boolean;
};

export async function getInternalManagerSession(
  req: NextApiRequest,
): Promise<InternalManagerSession | null> {
  const token = getCookieAccessToken(req);
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!token || !supabaseUrl || !anonKey || missing.length > 0) return null;

  const userClient = createUserClient(supabaseUrl, anonKey, token);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) return null;

  const { data: isManager, error: managerError } = await userClient.rpc("is_erp_manager", {
    uid: userData.user.id,
  });
  if (managerError || !isManager) return null;

  return { userId: userData.user.id, isManager: true };
}
