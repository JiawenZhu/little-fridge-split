import { test } from "node:test";
import assert from "node:assert/strict";
import { toActivity, readActivity } from "../server/activity.js";

const row = (code, value, extra = {}) => ({
  transaction_info: { transaction_id: code + value, transaction_event_code: code, transaction_initiation_date: "2026-10-27T05:58:40Z",
    transaction_amount: { currency_code: "USD", value }, transaction_status: "S", ...extra },
});

test("a friend's Venmo payment for a split comes in with its split, items and fee", () => {
  const a = toActivity({
    ...row("T0006", "15.74", { fee_amount: { value: "-1.04" }, custom_field: "tj-2026-10-26|sam|VENMO", transaction_subject: "Your share of Trader Joe's run", instrument_sub_type: "Venmo Wallet" }),
    payer_info: { payer_name: { alternate_full_name: "Sam Lee" } },
    cart_info: { item_details: [{ item_name: "Groceries: 5 items", item_quantity: "1", item_amount: { value: "15.74" } }] },
  });
  assert.deepEqual(a, {
    id: "T000615.74", date: "2026-10-27T05:58:40Z", kind: "received", amount: "15.74", direction: "in", fee: "1.04", currency: "USD", via: "Venmo",
    name: "Sam Lee", note: "Your share of Trader Joe's run", items: [{ name: "Groceries: 5 items", quantity: 1, amount: "15.74" }],
    split: { id: "tj-2026-10-26", person: "sam" }, pending: false,
  });
});

test("payments out are spending; holds, adjustments and denied payments are left out", () => {
  assert.equal(toActivity(row("T0001", "-42.10")).kind, "sent");
  assert.equal(toActivity(row("T0001", "-42.10")).amount, "42.10");
  assert.equal(toActivity(row("T0400", "-15.18")).kind, "transfer");
  assert.equal(toActivity(row("T1107", "-5.00")).kind, "refund");
  assert.equal(toActivity(row("T1107", "-5.00")).direction, "out", "a refund you give is money out");
  assert.equal(toActivity(row("T1105", "1.25")).direction, "in", "a refund to you is money in");
  assert.equal(toActivity(row("T2002", "-14.70")), null);
  assert.equal(toActivity(row("T1900", "5000.00")), null);
  assert.equal(toActivity(row("T0006", "9.00", { transaction_status: "D" })), null);
});

test("long ranges are read 31 days at a time, every page, without repeats", async () => {
  const asked = [];
  const paypal = async (_, path) => {
    const q = new URL(path, "http://x").searchParams;
    asked.push([q.get("start_date"), q.get("page")]);
    const pages = asked.length === 1 ? 2 : 1;
    return { total_pages: pages, transaction_details: [row("T0006", "4.80", { ending_balance: { value: "75.20" } })] };
  };
  const now = Date.parse("2026-11-03T00:00:00Z");
  const result = await readActivity(paypal, { days: 62, now });
  assert.equal(asked.length, 3); // two 31-day windows, the first with two pages
  assert.equal(result.activity.length, 1);
  assert.equal(result.balance, "75.20");
});
