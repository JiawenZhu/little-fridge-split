// Spike: find the sandbox merchant behind each REST app by creating a throwaway order and reading its payee.
const BASE = "https://api-m.sandbox.paypal.com";
async function token(id, secret) {
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  return (await r.json()).access_token;
}
for (const [label, id, secret] of [["main", process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET], ["alt", process.env.ALT_CLIENT_ID, process.env.ALT_CLIENT_SECRET]]) {
  const t = await token(id, secret);
  const o = await (await fetch(`${BASE}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }] }) })).json();
  const g = await (await fetch(`${BASE}/v2/checkout/orders/${o.id}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  console.log(label, JSON.stringify(g.purchase_units?.[0]?.payee ?? g));
}
