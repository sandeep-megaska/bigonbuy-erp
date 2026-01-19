import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";


/**
 * STEP 1: Get LWA Access Token using refresh token
 */
async function getAmazonAccessToken() {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMZ_LWA_REFRESH_TOKEN!,
      client_id: process.env.AMZ_LWA_CLIENT_ID!,
      client_secret: process.env.AMZ_LWA_CLIENT_SECRET!,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`LWA token error: ${JSON.stringify(json)}`);
  }

  return json.access_token as string;
}

/**
 * STEP 2: Sign request with AWS SigV4
 */
function signRequest({
  method,
  path,
  accessToken,
}: {
  method: string;
  path: string;
  accessToken: string;
}) {
  const host = "sellingpartnerapi-eu.amazon.com";
  const region = process.env.AMZ_AWS_REGION!;
  const service = "execute-api";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-access-token:${accessToken}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "host;x-amz-access-token;x-amz-date";

  const payloadHash = crypto
    .createHash("sha256")
    .update("")
    .digest("hex");

  const canonicalRequest = [
    method,
    path,
    "",
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
    .createHmac("sha256", "AWS4" + process.env.AMZ_AWS_SECRET_ACCESS_KEY!)
    .update(dateStamp)
    .digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto
    .createHmac("sha256", kService)
    .update("aws4_request")
    .digest();

  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  const authorizationHeader =
    `${algorithm} Credential=${process.env.AMZ_AWS_ACCESS_KEY_ID!}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      Authorization: authorizationHeader,
      "x-amz-access-token": accessToken,
      "x-amz-date": amzDate,
      host,
    },
  };
}

/**
 * API ROUTE
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const accessToken = await getAmazonAccessToken();

    const path = "/sellers/v1/marketplaceParticipations";
    const { headers } = signRequest({
      method: "GET",
      path,
      accessToken,
    });

    const response = await fetch(
      `${process.env.AMZ_SPAPI_ENDPOINT}${path}`,
      { headers }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        step: "sp-api-call",
        error: data,
      });
    }

    return res.json({
      ok: true,
      message: "Amazon SP-API connection successful",
      marketplaces: data.payload,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
