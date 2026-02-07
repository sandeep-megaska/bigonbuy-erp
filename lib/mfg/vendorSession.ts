import type { NextApiRequest } from "next";
import { getCookieLast } from "../mfgCookies";
import { createAnonClient, getSupabaseEnv } from "../serverSupabase";

export type VendorSession = {
  company_id: string;
  vendor_id: string;
  vendor_code: string;
  must_reset_password: boolean;
};

export async function getVendorSessionFromRequest(req: NextApiRequest): Promise<{
  session: VendorSession | null;
  error: string | null;
  status: number;
}> {
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return { session: null, error: "Server misconfigured", status: 500 };
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) {
    return { session: null, error: "Not authenticated", status: 401 };
  }

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_vendor_me_v1", {
    p_session_token: token,
  });

  if (error) {
    return { session: null, error: error.message || "Not authenticated", status: 401 };
  }

  const me = (data ?? {}) as any;
  if (!me?.ok || !me?.company_id || !me?.vendor_id) {
    return { session: null, error: "Not authenticated", status: 401 };
  }

  return {
    session: {
      company_id: String(me.company_id),
      vendor_id: String(me.vendor_id),
      vendor_code: String(me.vendor_code || ""),
      must_reset_password: Boolean(me.must_reset_password),
    },
    error: null,
    status: 200,
  };
}
