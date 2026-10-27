import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSplitServer } from "../server/index.js";

const repo = new URL("../", import.meta.url).pathname;

test("orders pay the organizer, use server amounts, and only matching captures mark a share paid", async () => {
  const root = await mkdtemp(join(tmpdir(), "lf-split-"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "web"));
  await copyFile(join(repo, "data/demo.json"), join(root, "data/demo.json"));
  await writeFile(join(root, "web/settle.html"), "settle");
  const orders = new Map();
  let sent, captures = 0, tamper = null, n = 0;
  const paypalRequest = async (method, path, body) => {
    if (path === "/v2/checkout/orders") { sent = body; const id = "ORDER" + ++n; orders.set(id, body); return { id }; }
    if (path.endsWith("/capture")) {
      if (tamper?.decline) throw Object.assign(new Error("UNPROCESSABLE_ENTITY"), { status: 422, details: { details: [{ issue: "INSTRUMENT_DECLINED" }] } });
      captures++;
      const unit = orders.get(path.split("/")[4]).purchase_units[0];
      return {
        payment_source: { venmo: {} },
        purchase_units: [{ ...unit, payments: { captures: [{ id: "CAP" + captures, status: "COMPLETED", custom_id: tamper?.custom_id ?? unit.custom_id, amount: { currency_code: "USD", value: tamper?.value ?? unit.amount.value } }] } }],
      };
    }
    if (path === "/v1/notifications/verify-webhook-signature") return { verification_status: body.transmission_sig === "good" ? "SUCCESS" : "FAILURE" };
    throw new Error("unexpected " + path);
  };
  const server = await createSplitServer({ root, paypalRequest, env: { PAYPAL_CLIENT_ID: "cid", PAYPAL_WEBHOOK_ID: "WH", ORGANIZER_MERCHANT_ID: "ORGANIZER123" }, log: () => {} });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (path, body, headers = {}) => fetch(base + path, { method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  try {
    const sam = await (await call("/api/shares/demo-sam")).json();
    assert.equal(sam.you.name, "Sam");
    assert.ok(!JSON.stringify(sam).includes("ORGANIZER123"), "merchant ID stays on the server");
    assert.equal((await call("/api/shares/nope")).status, 404);

    const status = await (await call("/api/splits/tj-2026-10-26")).json();
    const sum = Object.values(status.shares).reduce((s, x) => s + Math.round(x.total * 100), 0);
    const demo = JSON.parse(await readFile(join(root, "data/demo.json")));
    const jiawen = JSON.parse(await readFile(join(root, "data/store.json"))).splits[demo.id].organizerShare.total;
    assert.equal(sum + jiawen, Math.round(Number(status.total) * 100), "shares add up to the receipt");

    const { id } = await (await call("/api/shares/demo-sam/order", { amount: "0.01" })).json();
    assert.equal(sent.purchase_units[0].amount.value, sam.total, "server sets the amount");
    assert.equal(sent.purchase_units[0].payee.merchant_id, "ORGANIZER123", "money goes to the organizer");
    assert.equal(sent.purchase_units[0].custom_id, "tj-2026-10-26|sam");

    assert.equal((await call("/api/shares/demo-mia/capture", { orderId: id })).status, 403, "another share can't capture Sam's order");
    assert.equal((await call("/api/shares/demo-sam/order", {}, { Origin: "https://evil.example" })).status, 403);

    tamper = { decline: true };
    const declined = await call("/api/shares/demo-sam/capture", { orderId: id });
    assert.equal(declined.status, 402);
    assert.equal((await declined.json()).code, "INSTRUMENT_DECLINED");

    tamper = { value: "0.01" };
    assert.equal((await call("/api/shares/demo-sam/capture", { orderId: id })).status, 409);
    tamper = null;
    const ok = await (await call("/api/shares/demo-sam/capture", { orderId: id })).json();
    assert.equal(ok.via, "Venmo");
    const before = captures;
    assert.equal((await (await call("/api/shares/demo-sam/capture", { orderId: id })).json()).already, true);
    assert.equal(captures, before, "a replay never captures twice");
    assert.equal((await call("/api/shares/demo-sam/order", {})).status, 409);

    const event = { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAPW", custom_id: "tj-2026-10-26|mia", amount: { value: (await (await call("/api/shares/demo-mia")).json()).total } } };
    assert.equal((await call("/webhooks/paypal", event, { "paypal-transmission-sig": "bad" })).status, 400);
    assert.equal((await call("/webhooks/paypal", event, { "paypal-transmission-sig": "good" })).status, 200);
    const after = await (await call("/api/splits/tj-2026-10-26")).json();
    assert.equal(after.shares.sam.status, "paid");
    assert.equal(after.shares.mia.status, "paid");
    assert.equal(after.shares.alex.status, "sent");
    assert.equal(JSON.parse(await readFile(join(root, "data/store.json"))).payments.length, 2);
  } finally {
    await new Promise(ok => server.close(ok));
    await rm(root, { recursive: true, force: true });
  }
});
