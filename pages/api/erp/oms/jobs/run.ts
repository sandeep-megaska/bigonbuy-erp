import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../../lib/serverSupabase";
import {
  findVariantBySKU,
  getShopifyLocationId,
  setInventory,
} from "../../../../../lib/oms/adapters/shopify";

const MAX_JOB_ITEMS = 20;
const ALLOWED_ROLE_KEYS = ["owner", "admin"] as const;

const jobItemPayloadSchema = z.object({
  channel_sku: z.string().nullable().optional(),
  qty: z.coerce.number().optional(),
});

type ApiResponse =
  | {
      ok: true;
      jobId: string;
      processed: number;
      succeeded: number;
      failed: number;
      dryRun: boolean;
    }
  | { ok: false; error: string; details?: string | null };

type JobRow = {
  id: string;
  channel_account_id: string;
  job_type: string;
  status: string;
};

type JobItemRow = {
  id: string;
  payload: Record<string, unknown> | null;
  attempt_count: number;
};

function toBooleanEnv(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const jobIdRaw =
    typeof req.query.job_id === "string"
      ? req.query.job_id
      : typeof req.query.id === "string"
        ? req.query.id
        : null;

  if (!jobIdRaw) {
    return res.status(400).json({ ok: false, error: "job_id is required" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res
      .status(401)
      .json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  let userClient: SupabaseClient | null = null;
  let activeJobId: string | null = null;

  try {
    userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: membership, error: membershipError } = await userClient
      .from("erp_company_users")
      .select("company_id, role_key, is_active")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to load company membership",
        details: membershipError.message,
      });
    }

    if (!membership || !ALLOWED_ROLE_KEYS.includes(membership.role_key as any)) {
      return res.status(403).json({
        ok: false,
        error: "Only owner/admin can run OMS jobs",
      });
    }

    const { data: job, error: jobError } = await userClient
      .from("erp_channel_jobs")
      .select("id, channel_account_id, job_type, status")
      .eq("id", jobIdRaw)
      .maybeSingle();

    if (jobError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to load job",
        details: jobError.message,
      });
    }

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    if (job.status !== "queued") {
      return res.status(400).json({
        ok: false,
        error: "Job is not queued",
        details: `Current status: ${job.status}`,
      });
    }

    if (job.job_type !== "inventory_push") {
      return res.status(400).json({
        ok: false,
        error: "Job type is not inventory_push",
        details: `Current type: ${job.job_type}`,
      });
    }

    const { data: channelAccount, error: channelError } = await userClient
      .from("erp_channel_accounts")
      .select("id, channel_key")
      .eq("id", job.channel_account_id)
      .maybeSingle();

    if (channelError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to load channel account",
        details: channelError.message,
      });
    }

    if (!channelAccount) {
      return res
        .status(400)
        .json({ ok: false, error: "Channel account not found" });
    }

    if (channelAccount.channel_key !== "shopify") {
      return res.status(400).json({
        ok: false,
        error: "Only Shopify OMS jobs can be executed",
      });
    }

    activeJobId = job.id;

    const { error: startError } = await userClient.rpc("erp_oms_channel_job_update", {
      p_job_id: job.id,
      p_status: "running",
      p_started_at: new Date().toISOString(),
      p_finished_at: null,
      p_error: null,
    });

    if (startError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to start job",
        details: startError.message,
      });
    }

    await logJob(userClient, job.id, "info", "job.run.request", {
      job_id: job.id,
      job_type: job.job_type,
      channel_key: channelAccount.channel_key,
      dry_run: toBooleanEnv(process.env.OMS_DRY_RUN),
    });

    const { data: items, error: itemsError } = await userClient
      .from("erp_channel_job_items")
      .select("id, payload, attempt_count")
      .eq("job_id", job.id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_JOB_ITEMS);

    if (itemsError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to load job items",
        details: itemsError.message,
      });
    }

    const dryRun = toBooleanEnv(process.env.OMS_DRY_RUN);
    const processedItems = items ?? [];
    let succeeded = 0;
    const failed: { id: string; message: string }[] = [];

    for (const item of processedItems as JobItemRow[]) {
      const payload = item.payload ?? {};
      const parsed = jobItemPayloadSchema.safeParse(payload);
      const channelSku = parsed.success ? parsed.data.channel_sku : null;
      const qtyValue = parsed.success ? parsed.data.qty : undefined;
      const qty = Number.isFinite(qtyValue) ? Number(qtyValue) : 0;

      await logJob(userClient, job.id, "info", "shopify.request", {
        job_item_id: item.id,
        channel_sku: channelSku,
        qty,
        payload,
        dry_run: dryRun,
      });

      if (!channelSku) {
        const message = "Missing channel_sku in job item payload";
        await markJobItemFailed(userClient, item, message);
        await logJob(userClient, job.id, "error", "shopify.error", {
          job_item_id: item.id,
          error: message,
        });
        failed.push({ id: item.id, message });
        continue;
      }

      if (dryRun) {
        await markJobItemSucceeded(userClient, item);
        await logJob(userClient, job.id, "info", "shopify.response", {
          job_item_id: item.id,
          dry_run: true,
        });
        succeeded += 1;
        continue;
      }

      try {
        const variant = await findVariantBySKU(channelSku);
        if (!variant) {
          throw new Error(`No Shopify variant found for SKU ${channelSku}`);
        }

        const locationId = getShopifyLocationId();
        const response = await setInventory(
          variant.inventory_item_id,
          locationId,
          qty
        );

        await markJobItemSucceeded(userClient, item);
        await logJob(userClient, job.id, "info", "shopify.response", {
          job_item_id: item.id,
          inventory_item_id: variant.inventory_item_id,
          location_id: locationId,
          response,
        });
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await markJobItemFailed(userClient, item, message);
        await logJob(userClient, job.id, "error", "shopify.error", {
          job_item_id: item.id,
          error: message,
        });
        failed.push({ id: item.id, message });
      }
    }

    const failedCount = failed.length;
    const jobStatus = failedCount > 0 ? "failed" : "succeeded";
    const finishError =
      failedCount > 0 ? `${failedCount} job item(s) failed` : null;

    const { error: finishErrorResult } = await userClient.rpc("erp_oms_channel_job_update", {
      p_job_id: job.id,
      p_status: jobStatus,
      p_started_at: null,
      p_finished_at: new Date().toISOString(),
      p_error: finishError,
    });

    if (finishErrorResult) {
      return res.status(500).json({
        ok: false,
        error: "Failed to finalize job",
        details: finishErrorResult.message,
      });
    }

    await logJob(userClient, job.id, "info", "job.run.response", {
      job_id: job.id,
      status: jobStatus,
      succeeded,
      failed: failedCount,
    });

    return res.status(200).json({
      ok: true,
      jobId: job.id,
      processed: processedItems.length,
      succeeded,
      failed: failedCount,
      dryRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (userClient && activeJobId) {
      try {
        await userClient.rpc("erp_oms_channel_job_update", {
          p_job_id: activeJobId,
          p_status: "failed",
          p_started_at: null,
          p_finished_at: new Date().toISOString(),
          p_error: message,
        });
      } catch (updateError) {
        console.error("Failed to mark job as failed", updateError);
      }
    }
    return res.status(500).json({ ok: false, error: message });
  }
}

async function logJob(
  client: SupabaseClient,
  jobId: string,
  level: "info" | "error",
  message: string,
  context: Record<string, unknown>
) {
  const { error } = await client.rpc("erp_oms_channel_job_log_create", {
    p_job_id: jobId,
    p_level: level,
    p_message: message,
    p_context: context,
  });
  if (error) {
    throw new Error(`Failed to write job log: ${error.message}`);
  }
}

async function markJobItemSucceeded(
  client: SupabaseClient,
  item: JobItemRow
) {
  const { error } = await client.rpc("erp_oms_channel_job_item_update", {
    p_item_id: item.id,
    p_status: "succeeded",
    p_last_error: null,
    p_attempt_count: item.attempt_count + 1,
  });

  if (error) {
    throw new Error(`Failed to update job item: ${error.message}`);
  }
}

async function markJobItemFailed(
  client: SupabaseClient,
  item: JobItemRow,
  message: string
) {
  const { error } = await client.rpc("erp_oms_channel_job_item_update", {
    p_item_id: item.id,
    p_status: "failed",
    p_last_error: message,
    p_attempt_count: item.attempt_count + 1,
  });

  if (error) {
    throw new Error(`Failed to update job item: ${error.message}`);
  }
}
