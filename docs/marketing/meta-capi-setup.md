# Meta CAPI setup (Megaska Marketing Engine)

## 1) Configure credentials
You can keep Meta credentials in `public.erp_mkt_settings` per company, or in environment variables as a fallback for workers.

### Option A: per-company in DB
```sql
insert into public.erp_mkt_settings (
  company_id,
  meta_pixel_id,
  meta_access_token,
  cod_purchase_event_mode
)
values (
  '<company-uuid>',
  '<meta-pixel-id>',
  '<meta-access-token>',
  'fulfilled'
)
on conflict (company_id)
do update set
  meta_pixel_id = excluded.meta_pixel_id,
  meta_access_token = excluded.meta_access_token,
  cod_purchase_event_mode = excluded.cod_purchase_event_mode,
  updated_at = now();
```

> If your deployment has a secrets vault pattern, prefer vault-backed secrets and keep `meta_access_token` null in DB.

### Option B: env fallback
Set:
- `META_PIXEL_ID`
- `META_ACCESS_TOKEN`
- `ERP_SERVICE_COMPANY_ID`
- `INTERNAL_ADMIN_TOKEN` (required for the worker endpoint)

## 2) Shopify theme snippet install
Install in Shopify theme (e.g., `theme.liquid` before `</body>`), replacing `https://erp.yourdomain.com` with your ERP domain.

```html
<script>
(function () {
  const API_BASE = "https://erp.yourdomain.com";

  function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function buildFbc() {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get("fbclid");
    if (!fbclid) return null;
    return "fb.1." + Date.now() + "." + fbclid;
  }

  const storageKey = "mkt_session_id";
  const sessionId = localStorage.getItem(storageKey) || uuidv4();
  localStorage.setItem(storageKey, sessionId);

  const params = new URLSearchParams(window.location.search);
  const payload = {
    session_id: sessionId,
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_content: params.get("utm_content"),
    utm_term: params.get("utm_term"),
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc") || buildFbc(),
    landing_url: window.location.href,
    referrer: document.referrer || null,
    user_agent: navigator.userAgent,
  };

  fetch(API_BASE + "/api/marketing/touchpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});

  function sendAddToCart(detail) {
    const eventId = "atc_" + sessionId + "_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    fetch(API_BASE + "/api/marketing/add-to-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        sku: detail.sku || "UNKNOWN-SKU",
        qty: detail.qty || 1,
        value: detail.value || 0,
        currency: detail.currency || Shopify.currency.active || "INR",
        event_source_url: window.location.href,
        event_id: eventId,
        fbp: payload.fbp,
        fbc: payload.fbc,
      }),
    }).catch(() => {});
  }

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = (form.getAttribute("action") || "").toLowerCase();
    if (!action.includes("/cart/add")) return;
    const sku = form.querySelector("[name='id']")?.value || "UNKNOWN-SKU";
    const qty = Number(form.querySelector("[name='quantity']")?.value || 1);
    sendAddToCart({ sku, qty, value: 0, currency: Shopify.currency.active });
  }, true);

  const origFetch = window.fetch;
  window.fetch = function () {
    const [resource, init] = arguments;
    const url = typeof resource === "string" ? resource : resource.url;
    if (url && url.includes("/cart/add.js")) {
      try {
        const body = init && init.body ? String(init.body) : "";
        const params = new URLSearchParams(body);
        sendAddToCart({
          sku: params.get("id") || "UNKNOWN-SKU",
          qty: Number(params.get("quantity") || 1),
          value: 0,
          currency: Shopify.currency.active,
        });
      } catch (_) {}
    }
    return origFetch.apply(this, arguments);
  };
})();
</script>
```

## 3) COD-safe Purchase logic
`erp_mkt_capi_enqueue_purchase_from_shopify_order` enqueues `Purchase` only when:
- **Prepaid**: `financial_status = 'paid'`
- **COD**: based on `cod_purchase_event_mode`
  - `fulfilled` (default): only after fulfilled/has fulfillments
  - `paid`: only when payment status eventually becomes paid

This avoids over-reporting COD purchases before fulfillment.

## 4) Worker execution
Trigger worker:

```bash
curl -X POST "https://erp.yourdomain.com/api/marketing/capi-worker?company_id=<company-uuid>" \
  -H "x-internal-token: <INTERNAL_ADMIN_TOKEN>"
```

Recommended schedule: every 1-5 minutes.

## 5) Testing checklist
- Visit Shopify storefront with UTMs + `fbclid`; confirm touchpoint row created.
- Add product to cart; confirm `AddToCart` row queued.
- Run worker route; confirm sent/failed transitions and attempts increment.
- Confirm retry works from ERP page `/app/marketing/capi-events`.
- For COD test orders, verify `Purchase` enqueues only after fulfillment when mode is `fulfilled`.
