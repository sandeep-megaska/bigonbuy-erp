# Shopify touchpoint + AddToCart snippet (Kalles)

Install this script in your Shopify theme (Kalles) before `</body>` in `theme.liquid`.
Replace `https://erp.yourdomain.com` with your ERP domain.

```html
<script>
(function () {
  const API_BASE = "https://erp.yourdomain.com";

  function randomHex(len) {
    const chars = "abcdef0123456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function sessionId() {
    const key = "mkt_session_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = "sess_" + Date.now() + "_" + randomHex(10);
    localStorage.setItem(key, created);
    return created;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()\\[\\]\\/+^]/g, "\\$&") + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function buildFbcFromFbclid() {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get("fbclid");
    if (!fbclid) return null;
    return "fb.1." + Date.now() + "." + fbclid;
  }

  function collectUtms() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      utm_term: params.get("utm_term"),
    };
  }

  const sid = sessionId();
  const fbp = getCookie("_fbp");
  const fbc = getCookie("_fbc") || buildFbcFromFbclid();
  const utm = collectUtms();

  fetch(API_BASE + "/api/marketing/touchpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sid,
      ...utm,
      fbp: fbp,
      fbc: fbc,
      landing_url: window.location.href,
      referrer: document.referrer || null,
    }),
  }).catch(function () {});

  function postAddToCart(input) {
    const eventId = "atc_" + sid + "_" + Date.now();
    fetch(API_BASE + "/api/marketing/add-to-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        sku: input.sku || "UNKNOWN-SKU",
        quantity: Number(input.quantity || 1),
        value: Number(input.value || 0),
        currency: input.currency || (window.Shopify && Shopify.currency ? Shopify.currency.active : "INR"),
        event_source_url: window.location.href,
        event_id: eventId,
        fbp: fbp,
        fbc: fbc,
      }),
    }).catch(function () {});
  }

  const originalFetch = window.fetch;
  window.fetch = function () {
    const args = arguments;
    const resource = args[0];
    const init = args[1] || {};
    const url = typeof resource === "string" ? resource : (resource && resource.url) || "";

    if (url.indexOf("/cart/add.js") !== -1) {
      try {
        const body = typeof init.body === "string" ? init.body : "";
        const params = new URLSearchParams(body);
        postAddToCart({
          sku: params.get("id"),
          quantity: params.get("quantity") || 1,
          value: 0,
          currency: window.Shopify && Shopify.currency ? Shopify.currency.active : "INR",
        });
      } catch (_) {}
    }

    return originalFetch.apply(this, args);
  };

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = (form.getAttribute("action") || "").toLowerCase();
    if (action.indexOf("/cart/add") === -1) return;

    const skuInput = form.querySelector("[name='id']");
    const qtyInput = form.querySelector("[name='quantity']");
    postAddToCart({
      sku: skuInput ? skuInput.value : null,
      quantity: qtyInput ? qtyInput.value : 1,
      value: 0,
      currency: window.Shopify && Shopify.currency ? Shopify.currency.active : "INR",
    });
  }, true);
})();
</script>
```

## What this snippet does
- Persists `session_id` in local storage.
- Reads `_fbp` cookie.
- Builds `_fbc` from `fbclid` when `_fbc` cookie is absent.
- Captures UTM parameters and sends touchpoint to ERP.
- Intercepts AddToCart from both `fetch('/cart/add.js')` and form submits.
- Generates deterministic event id as `atc_<session_id>_<timestamp>`.
