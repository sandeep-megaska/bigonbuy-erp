import type { NextApiRequest, NextApiResponse } from "next";
import { parseLimitParam, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse =
  | {
      ok: true;
      data: {
        audience: {
          code: string;
          name: string;
          description: string | null;
          last_refreshed_at: string | null;
        };
        members: {
          customer_key: string;
          em_hash: string | null;
          ph_hash: string | null;
          member_since: string;
          member_rank: number | null;
          member_score: number | null;
          meta: Record<string, unknown>;
          updated_at: string;
        }[];
      };
    }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const audienceCode = typeof req.query.audienceCode === "string" ? req.query.audienceCode.trim() : "";
  if (!audienceCode) {
    return res.status(400).json({ ok: false, error: "audienceCode is required" });
  }

  const limit = parseLimitParam(req.query.limit, 200);

  const { data: audience, error: audienceError } = await context.userClient
    .from("erp_mkt_audience_definitions")
    .select("id, code, name, description, last_refreshed_at")
    .eq("company_id", context.companyId)
    .eq("code", audienceCode)
    .maybeSingle();

  if (audienceError) {
    return res.status(400).json({ ok: false, error: audienceError.message, details: audienceError.details });
  }

  if (!audience) {
    return res.status(404).json({ ok: false, error: "Audience not found" });
  }

  const { data: members, error: membersError } = await context.userClient
    .from("erp_mkt_audience_members")
    .select("customer_key, em_hash, ph_hash, member_since, member_rank, member_score, meta, updated_at")
    .eq("company_id", context.companyId)
    .eq("audience_id", audience.id)
    .is("ended_at", null)
    .order("member_rank", { ascending: true, nullsFirst: false })
    .order("member_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (membersError) {
    return res.status(400).json({ ok: false, error: membersError.message, details: membersError.details });
  }

  return res.status(200).json({
    ok: true,
    data: {
      audience: {
        code: String(audience.code),
        name: String(audience.name),
        description: (audience.description as string | null) ?? null,
        last_refreshed_at: (audience.last_refreshed_at as string | null) ?? null,
      },
      members: (members ?? []).map((row) => ({
        customer_key: String(row.customer_key),
        em_hash: (row.em_hash as string | null) ?? null,
        ph_hash: (row.ph_hash as string | null) ?? null,
        member_since: String(row.member_since),
        member_rank: typeof row.member_rank === "number" ? row.member_rank : null,
        member_score: row.member_score === null ? null : Number(row.member_score),
        meta: (row.meta as Record<string, unknown>) ?? {},
        updated_at: String(row.updated_at),
      })),
    },
  });
}
