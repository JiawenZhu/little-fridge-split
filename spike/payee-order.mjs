// Spike (a): can the platform app create an order whose payee is another merchant (the organizer)?
const BASE = "https://api-m.sandbox.paypal.com";
const ORGANIZER = process.argv[2] || process.env.ORGANIZER_MERCHANT_ID;
if (!ORGANIZER) throw new Error("usage: node --env-file=.env spike/payee-order.mjs <organizer merchant id>");
const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
const t = (await (await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" })).json()).access_token;
const amount = { currency_code: "USD", value: "12.40" };
const variants = {
  "payee only, no partner header": [{ payee: { merchant_id: ORGANIZER } }, {}],
  "payee + partner header": [{ payee: { merchant_id: ORGANIZER } }, { "PayPal-Partner-Attribution-Id": process.env.PAYPAL_BN_CODE }],
  "payee + partner + venmo payment_source": [{ payee: { merchant_id: ORGANIZER }, venmo: true }, { "PayPal-Partner-Attribution-Id": process.env.PAYPAL_BN_CODE }],
};
for (const [name, [extra, headers]] of Object.entries(variants)) {
  const unit = { reference_id: "share-demo", custom_id: "split-demo|sam", description: "Groceries with Jiawen", amount, payee: extra.payee };
  const body = { intent: "CAPTURE", purchase_units: [unit] };
  if (extra.venmo) body.payment_source = { venmo: { experience_context: { brand_name: "Little Fridge", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: "https://example.com/ok", cancel_url: "https://example.com/cancel" } } };
  const r = await fetch(`${BASE}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const j = await r.json();
  console.log(`\n# ${name}: HTTP ${r.status}`);
  console.log(JSON.stringify({ id: j.id, status: j.status, payee: j.purchase_units?.[0]?.payee, links: j.links?.map(l => l.rel + " " + l.href), name: j.name, details: j.details }, null, 1));
}
