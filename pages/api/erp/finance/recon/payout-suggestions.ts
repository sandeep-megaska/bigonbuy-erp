import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";
import { isPayoutSource, PAYOUT_ENTITY_TYPES, type PayoutSource } from "lib/erp/finance/payoutRecon";

type ApiResponse =
  | { ok: true; data: { candidates?: Record<string, unknown>[]; payouts?: Record<string, unknown>[]; stubs?: { source: string; message: string }[] } }
  | { ok: false; error: string; details?: string | null };

const absDiff = (a: number, b: number) => Math.abs(a - b);

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

    const sourceParam = typeof req.query.source === "string" ? req.query.source : "";
    const eventId = typeof req.query.event_id === "string" ? req.query.event_id : "";
    const bankTxnId = typeof req.query.bank_txn_id === "string" ? req.query.bank_txn_id : "";

    if (bankTxnId) {
      const { data: txn, error: txnError } = await userClient
        .from("erp_bank_transactions")
        .select("id,txn_date,value_date,description,reference_no,credit")
        .eq("id", bankTxnId)
        .eq("is_void", false)
        .maybeSingle();

      if (txnError || !txn) {
        return res.status(400).json({ ok: false, error: txnError?.message || "Bank transaction not found" });
      }

      const payouts: Record<string, unknown>[] = [];
      const stubs = ["delhivery_cod", "flipkart", "myntra", "snapdeal"].map((source) => ({
        source,
        message: "Not yet integrated",
      }));

      const { data: razorpaySuggestions } = await userClient.rpc("erp_razorpay_settlements_suggest_for_bank_txn", {
        p_bank_txn_id: bankTxnId,
        p_query: null,
      });

      for (const suggestion of (razorpaySuggestions || []) as Array<Record<string, unknown>>) {
        payouts.push({ ...suggestion, source: "razorpay", entity_type: PAYOUT_ENTITY_TYPES.razorpay, entity_id: suggestion.settlement_db_id });
      }

      const amount = Number(txn.credit || 0);
      const txnDate = (txn.value_date || txn.txn_date || "").slice(0, 10);

      let amazonQuery = userClient
        .from("erp_marketplace_settlement_batches")
        .select("id,batch_ref,deposit_date,net_payout,currency")
        .gt("net_payout", 0)
        .eq("is_void", false)
        .order("deposit_date", { ascending: false })
        .limit(20);
      if (txnDate) {
        const d = new Date(txnDate);
        const from = new Date(d);
        from.setDate(from.getDate() - 5);
        const to = new Date(d);
        to.setDate(to.getDate() + 5);
        amazonQuery = amazonQuery.gte("deposit_date", from.toISOString().slice(0, 10)).lte("deposit_date", to.toISOString().slice(0, 10));
      }

      const { data: amazonRows } = await amazonQuery;
      for (const row of (amazonRows || []) as Array<{ id: string; batch_ref: string | null; deposit_date: string | null; net_payout: number | null; currency: string | null }>) {
        const payoutAmount = Number(row.net_payout || 0);
        const score = Math.max(0, 100 - Math.round(absDiff(payoutAmount, amount)));
        payouts.push({
          source: "amazon",
          entity_type: PAYOUT_ENTITY_TYPES.amazon,
          entity_id: row.id,
          event_ref: row.batch_ref || row.id,
          payout_date: row.deposit_date,
          amount: payoutAmount,
          currency: row.currency || "INR",
          score,
          reason: absDiff(payoutAmount, amount) <= 1 ? "Amount match" : "Near amount match",
        });
      }

      payouts.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      return res.status(200).json({ ok: true, data: { payouts: payouts.slice(0, 25), stubs } });
    }

    if (!isPayoutSource(sourceParam) || !eventId) {
      return res.status(400).json({ ok: false, error: "source and event_id are required" });
    }

    const source = sourceParam as PayoutSource;
    if (!["amazon", "razorpay"].includes(source)) {
      return res.status(200).json({
        ok: true,
        data: { candidates: [], stubs: [{ source, message: "Not yet integrated" }] },
      });
    }

    let payoutDate = "";
    let payoutAmount = 0;

    if (source === "amazon") {
      const { data: batch, error } = await userClient
        .from("erp_marketplace_settlement_batches")
        .select("id,deposit_date,net_payout")
        .eq("id", eventId)
        .eq("is_void", false)
        .maybeSingle();
      if (error || !batch) {
        return res.status(400).json({ ok: false, error: error?.message || "Amazon payout not found" });
      }
      payoutDate = batch.deposit_date || "";
      payoutAmount = Number(batch.net_payout || 0);
    }

    if (source === "razorpay") {
      const { data: settlement, error } = await userClient
        .from("erp_razorpay_settlements")
        .select("id,settled_at,created_at,amount")
        .eq("id", eventId)
        .eq("is_void", false)
        .maybeSingle();
      if (error || !settlement) {
        return res.status(400).json({ ok: false, error: error?.message || "Razorpay payout not found" });
      }
      payoutDate = (settlement.settled_at || settlement.created_at || "").slice(0, 10);
      payoutAmount = Number(settlement.amount || 0);
    }

    const baseDate = payoutDate ? new Date(payoutDate) : new Date();
    const from = new Date(baseDate);
    from.setDate(from.getDate() - 3);
    const to = new Date(baseDate);
    to.setDate(to.getDate() + 3);

    const { data: bankRows, error: bankError } = await userClient
      .from("erp_bank_transactions")
      .select("id,txn_date,value_date,description,reference_no,credit,currency,is_matched")
      .eq("is_void", false)
      .eq("is_matched", false)
      .gt("credit", 0)
      .gte("txn_date", from.toISOString().slice(0, 10))
      .lte("txn_date", to.toISOString().slice(0, 10))
      .order("txn_date", { ascending: false })
      .limit(30);

    if (bankError) {
      return res.status(400).json({ ok: false, error: bankError.message, details: bankError.details });
    }

    const candidates = ((bankRows || []) as Array<Record<string, unknown> & { credit?: number }>).map((row) => {
      const amount = Number(row.credit || 0);
      const score = Math.max(0, 100 - Math.round(absDiff(amount, payoutAmount)));
      return {
        ...row,
        entity_type: PAYOUT_ENTITY_TYPES[source],
        entity_id: eventId,
        score,
        reason: absDiff(amount, payoutAmount) <= 1 ? "Amount match" : "Near amount match",
      };
    });

    candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return res.status(200).json({ ok: true, data: { candidates } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
