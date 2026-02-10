import type { NextApiRequest, NextApiResponse } from "next";
import { parseLimitParam, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type AudienceRow = {
  code: string;
  name: string;
  description: string | null;
  audience_type: string;
  refresh_freq: string;
  is_active: boolean;
  last_refreshed_at: string | null;
  active_members: number;
};

type ApiResponse = { ok: true; data: AudienceRow[] } | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const limit = parseLimitParam(req.query.limit, 100);
  const { data: definitions, error: definitionsError } = await context.userClient
    .from("erp_mkt_audience_definitions")
    .select("id, code, name, description, audience_type, refresh_freq, is_active, last_refreshed_at")
    .eq("company_id", context.companyId)
    .order("code", { ascending: true })
    .limit(limit);

  if (definitionsError) {
    return res.status(400).json({ ok: false, error: definitionsError.message, details: definitionsError.details });
  }

  const audienceIds = (definitions ?? []).map((row) => row.id as string);
  let countsByAudience = new Map<string, number>();

  if (audienceIds.length > 0) {
    const { data: activeMembers, error: membersError } = await context.userClient
      .from("erp_mkt_audience_members")
      .select("audience_id")
      .eq("company_id", context.companyId)
      .in("audience_id", audienceIds)
      .is("ended_at", null);

    if (membersError) {
      return res.status(400).json({ ok: false, error: membersError.message, details: membersError.details });
    }

    countsByAudience = (activeMembers ?? []).reduce((acc, row) => {
      const id = String(row.audience_id);
      acc.set(id, (acc.get(id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());
  }

  const data: AudienceRow[] = (definitions ?? []).map((row) => ({
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    audience_type: String(row.audience_type),
    refresh_freq: String(row.refresh_freq),
    is_active: Boolean(row.is_active),
    last_refreshed_at: (row.last_refreshed_at as string | null) ?? null,
    active_members: countsByAudience.get(String(row.id)) ?? 0,
  }));

  return res.status(200).json({ ok: true, data });
}
