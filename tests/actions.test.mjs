import { test } from "node:test";
import assert from "node:assert/strict";
import { sendInvoice, refund, payout } from "../server/actions.js";

const recorder = replies => {
  const calls = [];
  const paypal = async (method, path, body) => {
    calls.push({ method, path, body });
    const reply = replies.find(([m, p]) => m === method && path.startsWith(p));
    if (!reply) throw new Error("unexpected " + method + " " + path);
    return typeof reply[2] === "function" ? reply[2](body) : reply[2];
  };
  return { paypal, calls };
};

test("an invoice is emailed when there's an address, and its link comes back", async () => {
  const { paypal, calls } = recorder([
    ["POST", "/v2/invoicing/invoices/INV2", { href: "https://paypal.test/invoice/p/INV2" }],
    ["POST", "/v2/invoicing/invoices", { id: "INV2" }],
    ["GET", "/v2/invoicing/invoices/INV2", { status: "SENT", amount: { value: "45.00" }, detail: { invoice_number: "0007" } }],
  ]);
  const made = await sendInvoice(paypal, { name: "Sam Lee", email: "sam@example.com", note: "Airbnb", items: [{ name: "Half the Airbnb", amount: 45 }] });
  assert.deepEqual(made, { id: "INV2", number: "0007", status: "SENT", total: "45.00", emailed: true, link: "https://paypal.test/invoice/p/INV2" });
  assert.equal(calls[0].body.primary_recipients[0].billing_info.email_address, "sam@example.com");
  assert.equal(calls[0].body.items[0].unit_amount.value, "45.00");
  assert.equal(calls[1].body.send_to_recipient, true);
});

test("without an email the invoice isn't emailed; bad amounts are refused", async () => {
  const { paypal, calls } = recorder([
    ["POST", "/v2/invoicing/invoices/I1", {}],
    ["POST", "/v2/invoicing/invoices", { id: "I1" }],
    ["GET", "/v2/invoicing/invoices/I1", { status: "SENT", links: [{ rel: "payer-view", href: "https://p/view" }] }],
  ]);
  const made = await sendInvoice(paypal, { name: "Jing", items: [{ name: "Dinner", amount: "12.5" }] });
  assert.equal(made.link, "https://p/view");
  assert.equal(calls[1].body.send_to_recipient, false);
  await assert.rejects(sendInvoice(paypal, { name: "Jing", items: [{ name: "x", amount: 0 }] }), /more than \$0/);
  await assert.rejects(sendInvoice(paypal, { name: "Jing", items: [{ name: "x", amount: 20000 }] }), /\$10,000/);
});

test("a refund can't be more than the payment", async () => {
  const { paypal, calls } = recorder([
    ["GET", "/v2/payments/captures/CAP1", { amount: { currency_code: "USD", value: "15.74" } }],
    ["POST", "/v2/payments/captures/CAP1/refund", { id: "R1", status: "COMPLETED" }],
  ]);
  assert.deepEqual(await refund(paypal, { captureId: "CAP1", amount: 5, note: "Extra" }), { id: "R1", status: "COMPLETED", amount: "5.00" });
  assert.equal(calls[1].body.amount.value, "5.00");
  await assert.rejects(refund(paypal, { captureId: "CAP1", amount: 20 }), /only \$15.74/);
  await assert.rejects(refund(paypal, { captureId: "../x" }), /Which payment/);
});

test("payouts go to emails or phones, Venmo by phone only", async () => {
  const { paypal, calls } = recorder([["POST", "/v1/payments/payouts", { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } }]]);
  const made = await payout(paypal, { items: [
    { name: "Sam", to: "sam@example.com", amount: 20 },
    { name: "Jing", to: "(415) 555-0134", amount: 20, wallet: "Venmo" },
  ] });
  assert.deepEqual(made, { id: "B1", status: "PENDING", count: 2 });
  const [sam, jing] = calls[0].body.items;
  assert.deepEqual([sam.recipient_type, sam.receiver], ["EMAIL", "sam@example.com"]);
  assert.deepEqual([jing.recipient_type, jing.receiver, jing.recipient_wallet], ["PHONE", "4155550134", "VENMO"]);
  await assert.rejects(payout(paypal, { items: [{ name: "Ana", to: "@ana", amount: 5, wallet: "Venmo" }] }), /email or phone/);
});
