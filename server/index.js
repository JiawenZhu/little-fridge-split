// Little Fridge Split backend: settle-up pages and PayPal/Venmo payments that go straight to the organizer.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPayPal } from "./paypal.js";
import { openStore, addSplit } from "./store.js";
import { fromCents, venmoLinks } from "./split.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const fail = (status, message) => Object.assign(new Error(message), { status });

export async function createSplitServer({ root, env = process.env, paypalRequest = createPayPal(env), log = console.log }) {
  const store = await openStore(join(root, "data/store.json"), join(root, "data/demo.json"));
  const { data } = store;
  // The demo organizer's Venmo handle and PayPal merchant come from the environment, not the public repo.
  for (const split of Object.values(data.splits)) {
    if (env.ORGANIZER_VENMO) split.organizer.venmo = env.ORGANIZER_VENMO;
    if (env.ORGANIZER_MERCHANT_ID) split.organizer.merchantId = env.ORGANIZER_MERCHANT_ID;
  }

  const shareFor = token => {
    const hit = data.tokens[token];
    if (!hit) throw fail(404, "This settle-up link isn't valid any more.");
    const split = data.splits[hit[0]];
    return { split, person: hit[1], share: split.shares[hit[1]] };
  };

  // What the friend's page may see: only their own share, never anyone else's items or PayPal IDs.
  const publicShare = ({ split, person, share }) => ({
    title: split.title,
    paidWith: split.paidWith,
    paidAt: split.paidAt,
    organizer: { name: split.organizer.name },
    you: { name: split.people[person].name, color: split.people[person].color },
    people: Object.values(split.people).map(p => ({ name: p.name, color: p.color })),
    receiptTotal: fromCents(split.totalCents),
    items: share.items.map(i => ({ id: i.id, name: i.name, emoji: i.emoji || null, art: i.art || null, amount: fromCents(i.cents), sharedWith: i.sharedWith })),
    subtotal: fromCents(share.subtotal),
    extras: fromCents(share.extras),
    total: fromCents(share.total),
    status: share.status,
    paidVia: share.paidVia || null,
    venmo: split.organizer.venmo ? venmoLinks({ handle: split.organizer.venmo, cents: share.total, note: `🧊 ${split.title} (Little Fridge)` }) : null,
  });

  const validateSplit = body => {
    const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const id = text(body.id, 64);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw fail(400, "Missing split id");
    const people = Object.fromEntries(Object.entries(body.people || {}).slice(0, 12).map(([k, p]) => {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || !text(p?.name, 40)) throw fail(400, "Each person needs a name");
      return [k, { name: text(p.name, 40), color: /^#[0-9A-Fa-f]{6}$/.test(p.color) ? p.color : "#5E8B4A" }];
    }));
    const organizerId = text(body.organizer?.id, 40);
    if (!organizerId || !people[organizerId]) throw fail(400, "The organizer must be one of the people");
    if (Object.keys(people).length < 2) throw fail(400, "Add at least one friend to split with");
    const lines = (body.lines || []).slice(0, 60).map(l => {
      const cents = Math.round(Number(l.price) * 100);
      if (!text(l.name, 60) || !Number.isFinite(cents) || cents <= 0 || cents > 1_000_000) throw fail(400, "Each item needs a name and a price");
      const who = [...new Set((l.people || []).filter(p => people[p]))];
      if (!who.length) throw fail(400, `"${l.name}" has nobody assigned`);
      return { id: text(l.id, 64) || id, name: text(l.name, 60), price: (cents / 100).toFixed(2), people: who, emoji: text(l.emoji, 8), art: text(l.art, 40) };
    });
    if (!lines.length) throw fail(400, "Pick at least one item");
    const extras = Math.max(0, Math.round(Number(body.extras || 0) * 100)) / 100;
    return {
      id,
      title: text(body.title, 80) || "Groceries",
      paidWith: text(body.paidWith, 30) || "Apple Pay",
      paidAt: Number.isNaN(Date.parse(body.paidAt)) ? new Date().toISOString() : body.paidAt,
      organizer: { id: organizerId, name: people[organizerId].name, venmo: env.ORGANIZER_VENMO || undefined },
      people,
      lines,
      extras: extras.toFixed(2),
    };
  };

  const publicUrl = headers => env.PUBLIC_URL || `${headers["x-forwarded-proto"] || "http"}://${headers.host}`;

  const markPaid = (split, person, payment) => {
    const share = split.shares[person];
    if (share.status === "paid") return false;
    Object.assign(share, { status: "paid", paidAt: new Date().toISOString(), captureId: payment.id, paidVia: payment.via });
    data.payments.push({ at: share.paidAt, split: split.id, person, captureId: payment.id, amount: payment.amount, via: payment.via, source: payment.source });
    return true;
  };

  const routes = {
    "GET /api/config": async () => ({ clientId: env.PAYPAL_CLIENT_ID, env: env.PAYPAL_ENV === "live" ? "live" : "sandbox" }),

    // Viewing the link counts as opened, so the organizer sees Sent → Opened → Paid.
    "GET /api/shares/:token": async ({ token }) => {
      const found = shareFor(token);
      if (found.share.status === "sent") {
        found.share.status = "opened";
        found.share.openedAt = new Date().toISOString();
        await store.save();
      }
      return publicShare(found);
    },

    // The server sets the amount, the payee (the organizer) and custom_id; the browser only says which share.
    "POST /api/shares/:token/order": async ({ token }, _, headers) => {
      const { split, person, share } = shareFor(token);
      if (share.status === "paid") throw fail(409, "This share is already paid.");
      const amount = { currency_code: "USD", value: fromCents(share.total) };
      const order = await paypalRequest("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: person,
          custom_id: `${split.id}|${person}`,
          description: `Your share of ${split.title}`.slice(0, 127),
          // Without a merchant ID the order pays the PayPal account that owns the REST app (option 3: you are the
          // organizer). Paying other organizers needs PayPal partner approval; see SPIKE.md.
          ...(split.organizer.merchantId ? { payee: { merchant_id: split.organizer.merchantId } } : {}),
          amount: { ...amount, breakdown: { item_total: amount } },
          items: [{ name: `Groceries: ${share.items.length} items`, quantity: "1", unit_amount: amount, category: "PHYSICAL_GOODS" }],
        }],
        // Used when PayPal opens full-screen instead of a popup: it sends the buyer back to the page to finish.
        application_context: {
          brand_name: "Little Fridge",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${publicUrl(headers)}/s/${token}`,
          cancel_url: `${publicUrl(headers)}/s/${token}?cancelled=1`,
        },
      });
      share.orderId = order.id;
      share.status = share.status === "sent" ? "opened" : share.status;
      await store.save();
      return { id: order.id };
    },

    // Capture only if PayPal reports the exact amount and custom_id we created. A replay never pays twice.
    "POST /api/shares/:token/capture": async ({ token }, body) => {
      const { split, person, share } = shareFor(token);
      if (share.status === "paid") return { ok: true, already: true };
      if (!body.orderId || body.orderId !== share.orderId) throw fail(403, "That payment belongs to a different share.");
      let order;
      try {
        order = await paypalRequest("POST", `/v2/checkout/orders/${share.orderId}/capture`, {}, { "PayPal-Request-Id": `capture-${share.orderId}` });
      } catch (err) {
        // A declined card or empty Venmo balance: the friend can pick another way to pay on the same page.
        if (err.details?.details?.some(d => d.issue === "INSTRUMENT_DECLINED")) {
          throw Object.assign(fail(402, "That payment method was declined. Please try another card, bank or account."), { code: "INSTRUMENT_DECLINED" });
        }
        throw err;
      }
      const unit = order.purchase_units?.[0];
      const capture = unit?.payments?.captures?.find(c => c.status === "COMPLETED" || c.status === "PENDING");
      if (!capture) throw fail(402, "PayPal didn't complete the payment.");
      if ((capture.custom_id || unit.custom_id) !== `${split.id}|${person}` || capture.amount?.value !== fromCents(share.total)) throw fail(409, "Payment doesn't match this share.");
      const via = order.payment_source?.venmo ? "Venmo" : order.payment_source?.card ? "Card" : "PayPal";
      markPaid(split, person, { id: capture.id, amount: capture.amount.value, via, source: "capture" });
      await store.save();
      log(`paid: ${split.id}/${person} ${capture.amount.value} via ${via} (${capture.status})`);
      return { ok: true, via, status: capture.status };
    },

    // PayPal tells us about payments even if the friend closes the page before capture returns.
    "POST /webhooks/paypal": async (_, event, headers) => {
      if (!env.PAYPAL_WEBHOOK_ID) throw fail(503, "Webhook not configured");
      const check = await paypalRequest("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      });
      log(`webhook ${event.event_type} ${event.resource?.id} → ${check.verification_status}`);
      if (check.verification_status !== "SUCCESS") throw fail(400, "Bad signature");
      data.webhooks = [...(data.webhooks || []).slice(-49), { at: new Date().toISOString(), type: event.event_type, resource: event.resource?.id, custom_id: event.resource?.custom_id }];
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const [sid, person] = String(event.resource.custom_id || "").split("|");
        const split = data.splits[sid];
        if (split?.shares[person] && event.resource.amount?.value === fromCents(split.shares[person].total)) {
          markPaid(split, person, { id: event.resource.id, amount: event.resource.amount.value, via: split.shares[person].paidVia || "PayPal", source: "webhook" });
        }
      }
      await store.save();
      return { ok: true };
    },

    // The iOS app creates a split from fridge items. The server recomputes every share; the app only says who had what.
    "POST /api/splits": async (_, body, headers) => {
      if (env.SPLIT_APP_KEY && headers["x-app-key"] !== env.SPLIT_APP_KEY) throw fail(401, "Not allowed");
      const split = validateSplit(body);
      if (data.splits[split.id]) throw fail(409, "That split already exists.");
      const made = addSplit(data, split);
      await store.save();
      log(`split created: ${made.id} ${fromCents(made.totalCents)} for ${Object.keys(made.shares).length} people`);
      return organizerView(made, headers);
    },

    // Organizer view: totals, statuses and each friend's link.
    "GET /api/splits/:id": async ({ id }, _, headers) => {
      const split = data.splits[id];
      if (!split) throw fail(404, "No such split");
      return organizerView(split, headers);
    },
  };

  const organizerView = (split, headers) => ({
    id: split.id,
    title: split.title,
    total: fromCents(split.totalCents),
    shares: Object.fromEntries(Object.entries(split.shares).map(([p, s]) => [p, {
      name: split.people[p].name,
      total: fromCents(s.total),
      status: s.status,
      paidVia: s.paidVia || null,
      link: `${publicUrl(headers)}/s/${s.token}`,
    }])),
  });

  const match = (method, path) => {
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(" ");
      if (m !== method) continue;
      const names = [];
      const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([A-Za-z0-9_-]+)")) + "$");
      const hit = path.match(re);
      if (hit) return [handler, Object.fromEntries(names.map((n, i) => [n, hit[i + 1]]))];
    }
    return null;
  };

  const readBody = req => new Promise((ok, bad) => {
    let size = 0, chunks = [];
    req.on("data", c => { size += c.length; if (size > 256 * 1024) bad(fail(413, "Too large")); else chunks.push(c); });
    req.on("end", () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { bad(fail(400, "Bad JSON")); } });
  });

  const send = (res, status, body, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  const web = join(root, "web");
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      if (req.method === "POST" && req.headers.origin && !url.pathname.startsWith("/webhooks/") && new URL(req.headers.origin).host !== req.headers.host) throw fail(403, "Cross-site request");
      const hit = match(req.method, url.pathname);
      if (hit) return send(res, 200, await hit[0](hit[1], req.method === "POST" ? await readBody(req) : {}, req.headers));
      if (req.method !== "GET") throw fail(404, "Not found");
      if (url.pathname === "/") return send(res, 200, await readFile(join(web, "index.html")), TYPES[".html"]);
      if (/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname)) return send(res, 200, await readFile(join(web, "settle.html")), TYPES[".html"]);
      const file = normalize(join(web, url.pathname));
      if (!file.startsWith(web + "/")) throw fail(404, "Not found");
      return send(res, 200, await readFile(file), TYPES[extname(file)] || "application/octet-stream");
    } catch (err) {
      const status = err.status && err.status < 600 ? err.status : err.code === "ENOENT" ? 404 : 500;
      if (status >= 500) log(err.details ? JSON.stringify(err.details) : err);
      send(res, status, { error: status === 404 && err.code === "ENOENT" ? "Not found" : err.message, code: err.code === "ENOENT" ? undefined : err.code });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), "../..");
  const server = await createSplitServer({ root });
  const port = Number(process.env.PORT || 8787);
  server.listen(port, () => console.log(`Little Fridge Split on http://localhost:${port}/s/demo-sam`));
}
