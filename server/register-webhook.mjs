// Points both PayPal apps' webhooks at this server: node --env-file=.env server/register-webhook.mjs https://your-host
// Prints the webhook IDs to put in the environment as PAYPAL_WEBHOOK_ID and ALT_WEBHOOK_ID.
import { createPayPal } from "./paypal.js";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base?.startsWith("https://")) { console.error("Give the server's public https address"); process.exit(1); }
const url = `${base}/webhooks/paypal`;
const events = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "INVOICING.INVOICE.PAID", "PAYMENT.PAYOUTSBATCH.SUCCESS"];

const apps = [["PAYPAL_WEBHOOK_ID", process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET]];
if (process.env.ALT_CLIENT_ID) apps.push(["ALT_WEBHOOK_ID", process.env.ALT_CLIENT_ID, process.env.ALT_CLIENT_SECRET]);

for (const [name, id, secret] of apps) {
  const paypal = createPayPal({ ...process.env, PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PAYPAL_BN_CODE: "" });
  // An app has a few webhook slots; old ones pointing at this path (an earlier tunnel) are replaced.
  const { webhooks = [] } = await paypal("GET", "/v1/notifications/webhooks");
  for (const old of webhooks.filter(w => w.url.endsWith("/webhooks/paypal"))) await paypal("DELETE", `/v1/notifications/webhooks/${old.id}`);
  const made = await paypal("POST", "/v1/notifications/webhooks", { url, event_types: events.map(name => ({ name })) });
  console.log(`${name}=${made.id}`);
}
