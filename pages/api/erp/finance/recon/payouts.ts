import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";
import type { PayoutEvent } from "lib/erp/finance/payoutRecon";

type BankCreditUnmatchedRow = {
  bank_txn_id: string;
  txn_date: string | null;
  description: string | null;
  reference_no: string | null;
  credit: number;
  currency: string | null;
};

type ApiResponse =
  | { ok: true; data: { payouts_unmatched: PayoutEvent[]; bank_credit_unmatched: BankCreditUnmatchedRow[]; counts: { payouts_unmatched_count: number; bank_credit_unmatched_count: number } } }
  | { ok: false; error: string; details?: string | null };

const likelyPayoutDescription = (value: string | null) => {
  const text = (value || "").toLowerCase();
  return /(amazon|razorpay|delhivery|flipkart|myntra|snapdeal|settlement|payout|remittance|cod)/.test(text);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    let amazonQuery = userClient
      .from("erp_marketplace_settlement_batches")
      .select("id,batch_ref,deposit_date,net_payout,currency,status")
      .gt("net_payout", 0)
      .eq("is_void", false)
      .order("deposit_date", { ascending: false })
      .limit(200);

    if (from) amazonQuery = amazonQuery.gte("deposit_date", from);
    if (to) amazonQuery = amazonQuery.lte("deposit_date", to);

    let razorpayQuery = userClient
      .from("erp_razorpay_settlements")
      .select("id,razorpay_settlement_id,settled_at,created_at,amount,currency,status")
      .gt("amount", 0)
      .eq("is_void", false)
      .order("settled_at", { ascending: false })
      .limit(200);

    if (from) razorpayQuery = razorpayQuery.gte("settled_at", `${from}T00:00:00.000Z`);
    if (to) razorpayQuery = razorpayQuery.lte("settled_at", `${to}T23:59:59.999Z`);

    let bankCreditsQuery = userClient
      .from("erp_bank_transactions")
      .select("id,txn_date,description,reference_no,credit,currency")
      .eq("is_void", false)
      .eq("is_matched", false)
      .gt("credit", 0)
      .order("txn_date", { ascending: false })
      .limit(200);

    if (from) bankCreditsQuery = bankCreditsQuery.gte("txn_date", from);
    if (to) bankCreditsQuery = bankCreditsQuery.lte("txn_date", to);

    const [amazonResult, razorpayResult, bankCreditsResult] = await Promise.all([
      amazonQuery,
      razorpayQuery,
      bankCreditsQuery,
    ]);

    if (amazonResult.error) {
      return res.status(400).json({ ok: false, error: amazonResult.error.message, details: amazonResult.error.details });
    }
    if (razorpayResult.error) {
      return res.status(400).json({ ok: false, error: razorpayResult.error.message, details: razorpayResult.error.details });
    }
    if (bankCreditsResult.error) {
      return res.status(400).json({ ok: false, error: bankCreditsResult.error.message, details: bankCreditsResult.error.details });
    }

    const amazonRows = (amazonResult.data || []) as Array<{ id: string; batch_ref: string | null; deposit_date: string | null; net_payout: number | null; currency: string | null; status: string | null }>;
    const razorpayRows = (razorpayResult.data || []) as Array<{ id: string; razorpay_settlement_id: string | null; settled_at: string | null; created_at: string | null; amount: number | null; currency: string | null; status: string | null }>;

    const amazonIds = amazonRows.map((row) => row.id);
    const razorpayIds = razorpayRows.map((row) => row.id);

    const matchedMap = new Map<string, string>();
    if (amazonIds.length || razorpayIds.length) {
      const orFilter = [
        amazonIds.length ? `and(entity_type.eq.amazon_settlement_batch,entity_id.in.(${amazonIds.join(",")}))` : null,
        razorpayIds.length ? `and(entity_type.eq.razorpay_settlement,entity_id.in.(${razorpayIds.join(",")}))` : null,
      ]
        .filter(Boolean)
        .join(",");

      const { data: linksData, error: linksError } = await userClient
        .from("erp_bank_recon_links")
        .select("bank_txn_id,entity_type,entity_id,status,is_void")
        .eq("status", "matched")
        .eq("is_void", false)
        .or(orFilter);

      if (linksError) {
        return res.status(400).json({ ok: false, error: linksError.message, details: linksError.details });
      }

      for (const row of ((linksData || []) as Array<{ bank_txn_id: string; entity_type: string; entity_id: string }>)) {
        matchedMap.set(`${row.entity_type}:${row.entity_id}`, row.bank_txn_id);
      }
    }

    const payouts: PayoutEvent[] = [
      ...amazonRows.map((row) => ({
        source: "amazon" as const,
        event_id: row.id,
        event_ref: row.batch_ref || row.id,
        payout_date: row.deposit_date || new Date().toISOString().slice(0, 10),
        amount: Number(row.net_payout || 0),
        currency: row.currency || "INR",
        status: row.status || undefined,
        linked_bank_txn_id: matchedMap.get(`amazon_settlement_batch:${row.id}`),
      })),
      ...razorpayRows.map((row) => ({
        source: "razorpay" as const,
        event_id: row.id,
        event_ref: row.razorpay_settlement_id || row.id,
        payout_date: (row.settled_at || row.created_at || "").slice(0, 10),
        amount: Number(row.amount || 0),
        currency: row.currency || "INR",
        status: row.status || undefined,
        linked_bank_txn_id: matchedMap.get(`razorpay_settlement:${row.id}`),
      })),
    ]
      .filter((row) => row.amount > 0 && !row.linked_bank_txn_id)
      .sort((a, b) => (a.payout_date < b.payout_date ? 1 : -1));

    const bankCreditUnmatched = ((bankCreditsResult.data || []) as Array<{ id: string; txn_date: string | null; description: string | null; reference_no: string | null; credit: number | null; currency: string | null }>)
      .filter((row) => likelyPayoutDescription(`${row.description || ""} ${row.reference_no || ""}`) || Number(row.credit || 0) > 0)
      .map((row) => ({
        bank_txn_id: row.id,
        txn_date: row.txn_date,
        description: row.description,
        reference_no: row.reference_no,
        credit: Number(row.credit || 0),
        currency: row.currency || "INR",
      }));

    return res.status(200).json({
      ok: true,
      data: {
        payouts_unmatched: payouts,
        bank_credit_unmatched: bankCreditUnmatched,
        counts: {
          payouts_unmatched_count: payouts.length,
          bank_credit_unmatched_count: bankCreditUnmatched.length,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
