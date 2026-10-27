// Split math. Everything is in integer cents so shares always add up to the receipt total.

export const toCents = value => Math.round(Number(value) * 100);
export const fromCents = cents => (cents / 100).toFixed(2);

// lines: [{ id, name, cents, people: [personId, ...] }]  (an item shared by n people is split n ways)
// extras: tax + tip + fees in cents, spread in proportion to each person's item subtotal.
// Returns { [personId]: { items: [{ id, name, cents }], subtotal, extras, total } }.
export function splitBill({ people, lines, extrasCents = 0 }) {
  const result = Object.fromEntries(people.map(p => [p, { items: [], subtotal: 0, extras: 0, total: 0 }]));
  for (const line of lines) {
    if (!line.people.length) throw new Error(`"${line.name}" has nobody assigned`);
    for (const [i, cents] of spread(line.cents, line.people.map(() => 1)).entries()) {
      const person = result[line.people[i]];
      if (!person) throw new Error(`Unknown person ${line.people[i]}`);
      person.items.push({ id: line.id, name: line.name, cents, sharedWith: line.people.length });
      person.subtotal += cents;
    }
  }
  const extras = spread(extrasCents, people.map(p => result[p].subtotal));
  people.forEach((p, i) => {
    result[p].extras = extras[i];
    result[p].total = result[p].subtotal + extras[i];
  });
  return result;
}

// Split `total` cents by `weights` using largest remainders, so the parts always sum to `total`.
export function spread(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map(w => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    parts[i] += 1;
  }
  return parts;
}

// Free fallback: Venmo with the amount and note prefilled. No status comes back, so the share is marked paid by hand.
// venmo.com only claims /u/* as a universal link, so phones use the venmo:// scheme to prefill; desktops get the profile.
export function venmoLinks({ handle, cents, note, txn = "pay" }) {
  const q = new URLSearchParams({ txn, recipients: handle, amount: fromCents(cents), note });
  return { app: `venmo://paycharge?${q}`, web: `https://venmo.com/u/${encodeURIComponent(handle)}` };
}
