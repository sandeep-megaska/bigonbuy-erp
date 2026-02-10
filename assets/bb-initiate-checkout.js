(function () {
  if (window.__bb_ic_loaded) return;
  window.__bb_ic_loaded = true;

  function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function fetchCart() {
    try {
      const res = await fetch("/cart.js");
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function fireInitiateCheckout() {
    const cart = await fetchCart();
    if (!cart || !cart.items || !cart.items.length) return;

    const sessionId =
      localStorage.getItem("bb_mkt_sid") ||
      (function () {
        const sid = uuidv4();
        localStorage.setItem("bb_mkt_sid", sid);
        return sid;
      })();

    const eventId = "ic_" + uuidv4();

    const contents = cart.items.map((item) => ({
      id: String(item.variant_id),
      quantity: item.quantity,
    }));

    /* Pixel */
    if (window.fbq) {
      window.fbq("track", "InitiateCheckout", {
        content_type: "product",
        contents: contents,
        value: cart.total_price / 100,
        currency: cart.currency || "INR",
        event_id: eventId,
      });
    }

    /* Server CAPI */
    fetch("https://erp.bigonbuy.com/api/marketing/initiate-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        contents: contents,
        value: cart.total_price / 100,
        currency: cart.currency || "INR",
        event_id: eventId,
        event_source_url: window.location.href,
      }),
    }).catch(() => {});
  }

  function attachCheckoutListeners() {
    var CHECKOUT_LOCK_MS = 2000;
    var checkoutLockedUntil = 0;

    document.addEventListener("click", function (e) {
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(
        "button[name='checkout'], a[href*='/checkout'], .checkout-button, .cart__checkout-button, [data-cart-checkout], [data-checkout]"
      );
      if (!el) return;

      var now = Date.now();
      if (now < checkoutLockedUntil) return;
      checkoutLockedUntil = now + CHECKOUT_LOCK_MS;
      fireInitiateCheckout();
    });

    document.addEventListener(
      "submit",
      function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        var action = (form.getAttribute("action") || "").toLowerCase();
        if (action.indexOf("/checkout") === -1) return;

        var now = Date.now();
        if (now < checkoutLockedUntil) return;
        checkoutLockedUntil = now + CHECKOUT_LOCK_MS;
        fireInitiateCheckout();
      },
      true
    );
  }

  attachCheckoutListeners();
})();
