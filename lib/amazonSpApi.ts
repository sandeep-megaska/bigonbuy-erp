import crypto from "crypto";
import { z } from "zod";

type AmazonEnv = {
  lwaClientId: string | null;
  lwaClientSecret: string | null;
  lwaRefreshToken: string | null;
  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsRegion: string | null;
  spApiEndpoint: string | null;
  missing: string[];
};

type SignedFetchOptions = {
  method: string;
  path: string;
  accessToken: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

const SUPPORTED_REPORT_TYPES = new Set([
  "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
  "GET_FBA_MYI_ALL_INVENTORY_DATA",
  "GET_AFN_INVENTORY_DATA",
  "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
]);

const lwaTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

function getAmazonEnv(): AmazonEnv {
  const lwaClientId = process.env.AMZ_LWA_CLIENT_ID ?? null;
  const lwaClientSecret = process.env.AMZ_LWA_CLIENT_SECRET ?? null;
  const lwaRefreshToken = process.env.AMZ_LWA_REFRESH_TOKEN ?? null;
  const awsAccessKeyId = process.env.AMZ_AWS_ACCESS_KEY_ID ?? null;
  const awsSecretAccessKey = process.env.AMZ_AWS_SECRET_ACCESS_KEY ?? null;
  const awsRegion = process.env.AMZ_AWS_REGION ?? null;
  const spApiEndpoint = process.env.AMZ_SPAPI_ENDPOINT ?? null;

  const missing: string[] = [];
  if (!lwaClientId) missing.push("AMZ_LWA_CLIENT_ID");
  if (!lwaClientSecret) missing.push("AMZ_LWA_CLIENT_SECRET");
  if (!lwaRefreshToken) missing.push("AMZ_LWA_REFRESH_TOKEN");
  if (!awsAccessKeyId) missing.push("AMZ_AWS_ACCESS_KEY_ID");
  if (!awsSecretAccessKey) missing.push("AMZ_AWS_SECRET_ACCESS_KEY");
  if (!awsRegion) missing.push("AMZ_AWS_REGION");
  if (!spApiEndpoint) missing.push("AMZ_SPAPI_ENDPOINT");

  return {
    lwaClientId,
    lwaClientSecret,
    lwaRefreshToken,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRegion,
    spApiEndpoint,
    missing,
  };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildCanonicalQuery(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

export async function getAmazonAccessToken(): Promise<string> {
  const env = getAmazonEnv();
  if (env.missing.length > 0) {
    throw new Error(`Missing Amazon env vars: ${env.missing.join(", ")}`);
  }

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.lwaRefreshToken ?? "",
      client_id: env.lwaClientId ?? "",
      client_secret: env.lwaClientSecret ?? "",
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`LWA token error: ${JSON.stringify(json)}`);
  }

  const parsed = lwaTokenSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Unexpected LWA token response: ${parsed.error.message}`);
  }

  return parsed.data.access_token;
}

export function assertSupportedReportType(reportType: string): void {
  if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
    throw new Error(`Unsupported reportType: ${reportType}`);
  }
}

export async function spApiSignedFetch(options: SignedFetchOptions): Promise<Response> {
  const env = getAmazonEnv();
  if (env.missing.length > 0) {
    throw new Error(`Missing Amazon env vars: ${env.missing.join(", ")}`);
  }

  const endpoint = env.spApiEndpoint ?? "";
  const url = new URL(endpoint);
  const host = url.host;
  const region = env.awsRegion ?? "";
  const service = "execute-api";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const queryParams = new URLSearchParams();
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      queryParams.append(key, String(value));
    });
  }

  const canonicalQueryString = buildCanonicalQuery(queryParams);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-access-token:${options.accessToken}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "host;x-amz-access-token;x-amz-date";

  const payloadHash = crypto
    .createHash("sha256")
    .update(options.body ?? "")
    .digest("hex");

  const canonicalRequest = [
    options.method,
    options.path,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = crypto
    .createHmac("sha256", `AWS4${env.awsSecretAccessKey ?? ""}`)
    .update(dateStamp)
    .digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  const authorizationHeader =
    `${algorithm} Credential=${env.awsAccessKeyId ?? ""}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchUrl = `${endpoint}${options.path}${canonicalQueryString ? `?${canonicalQueryString}` : ""}`;

  return fetch(fetchUrl, {
    method: options.method,
    headers: {
      Authorization: authorizationHeader,
      "x-amz-access-token": options.accessToken,
      "x-amz-date": amzDate,
      host,
      ...options.headers,
    },
    body: options.body,
    signal: options.signal,
  });
}
