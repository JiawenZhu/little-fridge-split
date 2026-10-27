// Friend's settle-up page: shows only their share and pays the organizer with Venmo or PayPal.
const $ = id => document.getElementById(id);
const token = location.pathname.split("/").pop();
const api = async (path, body) => {
  const res = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "Something went wrong. Please try again."), { code: json.code });
  return json;
};
const money = v => "$" + v;
const showError = msg => { $("error").textContent = msg; $("error").hidden = !msg; };

function render(share) {
  document.title = `Settle up with ${share.organizer.name} · Little Fridge`;
  $("avatars").replaceChildren(...share.people.map(p => {
    const el = document.createElement("span");
    el.className = "avatar" + (p.name === share.you.name ? " you" : "");
    el.style.background = p.color;
    el.textContent = p.name[0];
    el.title = p.name;
    return el;
  }));
  $("who").textContent = `${share.organizer.name} paid for ${share.title}`;
  $("total").textContent = share.total;
  const when = new Date(share.paidAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  $("sub").textContent = `Your share, ${share.you.name} · receipt ${money(share.receiptTotal)} with ${share.paidWith} on ${when}`;
  $("items").replaceChildren(...share.items.map((item, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--i", i);
    li.innerHTML = `<span class="art"></span><span class="name"></span><span class="amount"></span>`;
    // Items from the app carry an emoji; the demo receipt has pictures named after each item.
    const art = li.querySelector(".art");
    if (item.emoji && !item.art) art.textContent = item.emoji;
    else {
      const img = Object.assign(new Image(44, 44), { alt: "", src: `/img/${item.art || item.id}.png` });
      img.onerror = () => img.replaceWith(item.emoji || "🛒");
      art.append(img);
    }
    li.querySelector(".name").textContent = item.name;
    if (item.sharedWith > 1) li.querySelector(".name").insertAdjacentHTML("beforeend", `<small>split ${item.sharedWith} ways</small>`);
    li.querySelector(".amount").textContent = money(item.amount);
    return li;
  }));
  $("subtotal").textContent = money(share.subtotal);
  $("extras").textContent = money(share.extras);
  $("grand").textContent = money(share.total);
  $("organizer").textContent = share.organizer.name;
  if (share.venmo) {
    const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
    Object.assign($("venmo-link"), { href: phone ? share.venmo.app : share.venmo.web, hidden: false });
  }
  $("page").removeAttribute("aria-busy");
}

function showPaid(share, via) {
  $("pay").hidden = true;
  $("done").hidden = false;
  $("done-title").textContent = `Paid${via ? " with " + via : ""}`;
  $("done-sub").textContent = `${share.organizer.name} will see it in Little Fridge right away. Thanks for settling up!`;
  $("page").classList.add("is-paid");
}

async function loadPayPal() {
  const config = await api("/api/config");
  const params = new URLSearchParams({ "client-id": config.clientId, currency: "USD", intent: "capture", components: "buttons,funding-eligibility", "enable-funding": "venmo" });
  if (config.env === "sandbox") params.set("buyer-country", "US");
  await new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js?" + params;
    s.onload = ok;
    s.onerror = () => fail(new Error("Checkout couldn't load. Check your connection and try again."));
    document.head.append(s);
  });
  return window.paypal;
}

async function mountButtons(paypal, share) {
  const handlers = fundingSource => ({
    fundingSource,
    style: { layout: "vertical", shape: "pill", height: 50, label: "pay" },
    createOrder: async () => { showError(""); return (await api(`/api/shares/${token}/order`, {})).id; },
    onApprove: async ({ orderID }, actions) => {
      try {
        const result = await api(`/api/shares/${token}/capture`, { orderId: orderID });
        showPaid(share, result.via);
      } catch (err) {
        // PayPal's advice for a decline: reopen checkout so the payer can choose something else.
        if (err.code === "INSTRUMENT_DECLINED") return actions.restart();
        showError(err.message);
      }
    },
    onCancel: () => showError("No problem. Your share is still open whenever you're ready."),
    onError: err => showError(err?.message || "The payment didn't go through. Please try again."),
  });
  const venmo = paypal.Buttons(handlers(paypal.FUNDING.VENMO));
  const eligible = venmo.isEligible();
  window.__venmoEligible = eligible; // read by the spike checks
  if (eligible) await venmo.render("#venmo-button");
  else $("venmo-button").remove();
  const pp = paypal.Buttons(handlers(paypal.FUNDING.PAYPAL));
  if (pp.isEligible()) await pp.render("#paypal-button");
}

// PayPal's full-screen flow comes back as /s/<token>?token=<order id>&PayerID=…; finish the payment here.
async function finishRedirect(share) {
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  if (params.get("cancelled")) showError("No problem. Your share is still open whenever you're ready.");
  if (!params.get("token") || share.status === "paid") return false;
  try {
    const result = await api(`/api/shares/${token}/capture`, { orderId: params.get("token") });
    showPaid(share, result.via);
    return true;
  } catch (err) {
    showError(err.message);
    return false;
  }
}

try {
  const share = await api(`/api/shares/${token}`);
  render(share);
  if (share.status === "paid") showPaid(share, share.paidVia);
  else if (!(await finishRedirect(share))) await mountButtons(await loadPayPal(), share);
} catch (err) {
  $("who").textContent = "We couldn't open this link";
  showError(err.message);
  $("page").removeAttribute("aria-busy");
}
