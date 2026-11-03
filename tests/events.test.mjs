import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSplitServer } from "../server/index.js";

const repo = new URL("../", import.meta.url).pathname;

test("a paid invoice reaches the phone's live stream, and only the app may listen", async () => {
  const root = await mkdtemp(join(tmpdir(), "lf-events-"));
  await mkdir(join(root, "data"));
  await copyFile(join(repo, "data/demo.json"), join(root, "data/demo.json"));
  const verify = async (method, path, body) => {
    assert.equal(path, "/v1/notifications/verify-webhook-signature");
    return { verification_status: body.webhook_id === "ALTHOOK" && body.transmission_sig === "good" ? "SUCCESS" : "FAILURE" };
  };
  const server = await createSplitServer({ root, paypalRequest: verify, reportingRequest: verify, log: () => {},
    env: { PAYPAL_WEBHOOK_ID: "MAINHOOK", ALT_WEBHOOK_ID: "ALTHOOK", SPLIT_APP_KEY: "k3y" } });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const hook = sig => fetch(base + "/webhooks/paypal", {
    method: "POST", headers: { "Content-Type": "application/json", "paypal-transmission-sig": sig },
    body: JSON.stringify({ event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-1", detail: { reference: "v-abc123|sam" }, payments: { paid_amount: { value: "7.22" } } } }),
  });
  try {
    assert.equal((await fetch(base + "/api/events")).status, 401, "needs the app key");
    const controller = new AbortController();
    const stream = await fetch(base + "/api/events", { headers: { "x-app-key": "k3y" }, signal: controller.signal });
    assert.equal(stream.headers.get("content-type"), "text/event-stream");
    const reader = stream.body.getReader();
    await reader.read(); // retry hint
    assert.equal((await hook("bad")).status, 400, "unsigned events are refused");
    assert.equal((await hook("good")).status, 200);
    let text = "";
    while (!text.includes("event: activity")) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: share\.paid\ndata: \{"split":"v-abc123","person":"sam","amount":"7.22","via":"PayPal invoice","invoice":"INV2-1"\}/);
    controller.abort();
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
