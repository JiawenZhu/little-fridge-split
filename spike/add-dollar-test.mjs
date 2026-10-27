// Spike: add a $1.00 share (token demo-dollar) for testing payments with as little money as possible.
// Stop the server first; it keeps the store in memory.
import { join } from "node:path";
import { openStore, addSplit } from "../server/store.js";

const root = join(import.meta.dirname, "..");
const store = await openStore(join(root, "data/store.json"), join(root, "data/demo.json"));
if (!store.data.splits["dollar-test"]) {
  addSplit(store.data, {
    id: "dollar-test",
    title: "$1 payment test",
    paidWith: "Apple Pay",
    paidAt: new Date().toISOString(),
    organizer: { id: "jiawen", name: "Jiawen" },
    people: { jiawen: { name: "Jiawen", color: "#5E8B4A" }, tester: { name: "Tester", color: "#E08A4F" } },
    lines: [{ id: "strawberries", name: "Strawberries (test)", price: "1.00", people: ["tester"] }],
    extras: "0",
    demoTokens: { tester: "demo-dollar" },
  });
}
await store.save();
console.log(store.data.splits["dollar-test"].shares.tester.total, "cents at /s/demo-dollar");
