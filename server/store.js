// Spike storage: one JSON file. Firestore (households/{hid}/splits/{sid}) replaces this after the spike.
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { splitBill, toCents } from "./split.js";

export async function openStore(file, seedFile) {
  let data;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    data = { splits: {}, tokens: {}, payments: [] };
    if (seedFile) addSplit(data, JSON.parse(await readFile(seedFile, "utf8")));
  }
  let saving = Promise.resolve();
  const store = {
    data,
    save() {
      saving = saving.then(async () => {
        await writeFile(file + ".tmp", JSON.stringify(data, null, 1));
        await rename(file + ".tmp", file);
      });
      return saving;
    },
  };
  await store.save();
  return store;
}

// Computes every friend's share on the server and gives each one an unguessable settle-up token.
export function addSplit(data, input) {
  const people = Object.keys(input.people);
  const lines = input.lines.map(l => ({ ...l, cents: toCents(l.price) }));
  const shares = splitBill({ people, lines, extrasCents: toCents(input.extras || 0) });
  const split = { ...input, lines, totalCents: lines.reduce((a, l) => a + l.cents, 0) + toCents(input.extras || 0), shares: {} };
  delete split.demoTokens;
  for (const person of people) {
    if (person === input.organizer.id) continue;
    const token = input.demoTokens?.[person] || randomBytes(18).toString("base64url");
    split.shares[person] = { ...shares[person], token, status: "sent" };
    data.tokens[token] = [split.id, person];
  }
  split.organizerShare = shares[input.organizer.id];
  data.splits[split.id] = split;
  return split;
}
