const SHOPIFY_API_VERSION = "2024-01";

type ShopifyVariant = {
  id: number;
  sku: string | null;
  inventory_item_id: number;
};

type ShopifyVariantResponse = {
  variants: ShopifyVariant[];
};

type ShopifyInventorySetResponse = {
  inventory_level?: {
    inventory_item_id: number;
    location_id: number;
    available: number;
    updated_at: string;
  };
};

type ShopifyEnv = {
  storeDomain: string;
  accessToken: string;
  locationId: string;
};

function getShopifyEnv(): ShopifyEnv {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const locationId = process.env.SHOPIFY_LOCATION_ID;

  if (!storeDomain || !accessToken || !locationId) {
    throw new Error("Missing Shopify env vars: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_LOCATION_ID");
  }

  return { storeDomain, accessToken, locationId };
}

function buildShopifyBaseUrl(storeDomain: string): string {
  if (storeDomain.startsWith("http://") || storeDomain.startsWith("https://")) {
    return storeDomain.replace(/\/$/, "");
  }
  return `https://${storeDomain}`;
}

async function shopifyFetch(path: string, init?: RequestInit): Promise<Response> {
  const { storeDomain, accessToken } = getShopifyEnv();
  const baseUrl = buildShopifyBaseUrl(storeDomain);
  const url = `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("X-Shopify-Access-Token", accessToken);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...init,
    headers,
  });
}

export async function findVariantBySKU(sku: string): Promise<ShopifyVariant | null> {
  const query = new URLSearchParams({ sku });
  const response = await shopifyFetch(`/variants.json?${query.toString()}`, {
    method: "GET",
  });
  const json = (await response.json()) as ShopifyVariantResponse;

  if (!response.ok) {
    throw new Error(`Shopify variant lookup failed: ${response.status} ${JSON.stringify(json)}`);
  }

  if (!Array.isArray(json.variants) || json.variants.length === 0) {
    return null;
  }

  return json.variants[0];
}

export async function setInventory(
  inventoryItemId: number,
  locationId: string,
  qty: number
): Promise<ShopifyInventorySetResponse> {
  const response = await shopifyFetch("/inventory_levels/set.json", {
    method: "POST",
    body: JSON.stringify({
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: qty,
    }),
  });

  const json = (await response.json()) as ShopifyInventorySetResponse;
  if (!response.ok) {
    throw new Error(`Shopify inventory update failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

export function getShopifyLocationId(): string {
  return getShopifyEnv().locationId;
}
