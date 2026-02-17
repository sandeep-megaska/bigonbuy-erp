import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import type { NextApiRequest, NextApiResponse } from "next";

export type RequireErpUserResult =
  | {
      ok: true;
      supabase: ReturnType<typeof createServerSupabaseClient>;
      userId: string;
      companyId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function requireErpUser(req: NextApiRequest, res: NextApiResponse): Promise<RequireErpUserResult> {
  const supabase = createServerSupabaseClient({ req, res });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const { data: companyId, error: companyError } = await supabase.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return { ok: false, status: 403, error: "Company membership not found" };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    companyId: String(companyId),
  };
}
