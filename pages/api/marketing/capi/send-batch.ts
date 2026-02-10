import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { resolveInternalApiAuth } from "../../../../lib/erp/internalApiAuth";
import { createUserClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

const bodySchema = z.object({
  batch_size: z.coerce.number().int().min(1).max(1000).optional(),
});

type ApiResponse =
  | {
      ok: true;
      summary: {
        processed: number;
        sent: number;
        retry: number;
        failed: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await resolveInternalApiAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const parsedBody = bodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ ok: false, error: "Invalid request body" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, auth.token);
  const { data, error } = await userClient.rpc("erp_mkt_capi_send_batch_v1", {
    p_actor_user_id: auth.userId,
    p_batch_size: parsedBody.data.batch_size ?? 200,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to send CAPI batch" });
  }

  const summary = (data ?? {}) as Partial<{ processed: number; sent: number; retry: number; failed: number }>;
  return res.status(200).json({
    ok: true,
    summary: {
      processed: Number(summary.processed ?? 0),
      sent: Number(summary.sent ?? 0),
      retry: Number(summary.retry ?? 0),
      failed: Number(summary.failed ?? 0),
    },
  });
}
