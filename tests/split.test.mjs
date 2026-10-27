import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBill, spread, venmoLinks } from "../server/split.js";

test("spread always adds up to the total", () => {
  assert.deepEqual(spread(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(spread(0, [5, 0]), [0, 0]);
  assert.deepEqual(spread(7, [0, 0]), [7, 0]);
  for (let total = 0; total < 500; total += 37) {
    const parts = spread(total, [3, 11, 0, 7]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
  }
});

test("shared items and tax split so shares equal the receipt", () => {
  const lines = [
    { id: "milk", name: "Milk", cents: 499, people: ["a", "b", "c"] },
    { id: "salmon", name: "Salmon", cents: 1499, people: ["a"] },
    { id: "bread", name: "Bread", cents: 599, people: ["b", "c"] },
  ];
  const r = splitBill({ people: ["a", "b", "c"], lines, extrasCents: 341 });
  const total = Object.values(r).reduce((s, p) => s + p.total, 0);
  assert.equal(total, 499 + 1499 + 599 + 341);
  assert.equal(r.a.subtotal, 167 + 1499);
  assert.ok(r.a.extras > r.b.extras, "tax follows what you bought");
  assert.equal(r.b.items.find(i => i.id === "milk").sharedWith, 3);
});

test("unassigned items are rejected", () => {
  assert.throws(() => splitBill({ people: ["a"], lines: [{ id: "x", name: "X", cents: 1, people: [] }] }), /nobody/);
});

test("Venmo link prefills recipient, amount and note", () => {
  const links = venmoLinks({ handle: "jiawen", cents: 1240, note: "Groceries" });
  assert.equal(links.web, "https://venmo.com/u/jiawen");
  const url = new URL(links.app);
  assert.equal(url.protocol + url.host, "venmo:paycharge");
  assert.equal(url.searchParams.get("txn"), "pay");
  assert.equal(url.searchParams.get("recipients"), "jiawen");
  assert.equal(url.searchParams.get("amount"), "12.40");
  assert.equal(url.searchParams.get("note"), "Groceries");
});
