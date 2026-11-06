// PayPal account activity for Little Wallet: money in from friends (PayPal or Venmo) and money out, from the
// Transaction Search API. Holds, fees and balance moves are PayPal bookkeeping and are left out.

const DAY = 86_400_000;

// Event code groups: https://developer.paypal.com/docs/transaction-search/transaction-event-codes/
function kindOf(code, cents) {
  const group = code.slice(0, 3);
  if (group === "T00") return cents >= 0 ? "received" : "sent";
  if (group === "T11") return "refund";
  if (group === "T03" || group === "T04") return "transfer";
  return null;
}

const toCents = v => Math.round(Number(v || 0) * 100);
const fromCents = c => (Math.abs(c) / 100).toFixed(2);

/** One Transaction Search row, as the app sees it, or null for bookkeeping rows. */
export function toActivity(row) {
  const info = row.transaction_info || {};
  const cents = toCents(info.transaction_amount?.value);
  const kind = kindOf(info.transaction_event_code || "", cents);
  if (!kind || !cents || info.transaction_status === "D" || info.transaction_status === "V") return null;
  const payer = row.payer_info?.payer_name || {};
  const shipping = row.shipping_info?.name;
  const venmo = /venmo/i.test(`${info.instrument_sub_type || ""} ${info.custom_field || ""}`);
  // Splits made by Little Fridge Split put "splitId|person|method" in custom_id.
  const [splitId, person] = String(info.custom_field || "").split("|");
  return {
    id: info.transaction_id,
    date: info.transaction_initiation_date,
    kind,
    amount: fromCents(cents),
    // Which way the money went: a refund you give is "out", one that comes back to you is "in".
    direction: cents >= 0 ? "in" : "out",
    fee: fromCents(toCents(info.fee_amount?.value)),
    currency: info.transaction_amount?.currency_code || "USD",
    via: venmo ? "Venmo" : info.instrument_type === "Credit card" ? "Card" : "PayPal",
    name: payer.alternate_full_name || [payer.given_name, payer.surname].filter(Boolean).join(" ") || shipping || row.store_info?.store_id || null,
    // Bank transfers carry PayPal's internal reference as their subject; it means nothing to a person.
    note: kind === "transfer" ? null : info.transaction_subject || info.transaction_note || null,
    items: (row.cart_info?.item_details || [])
      .filter(i => i.item_name)
      .map(i => ({ name: i.item_name, quantity: Number(i.item_quantity || 1), amount: i.item_amount?.value || i.total_item_amount?.value || null })),
    split: splitId && person ? { id: splitId, person } : null,
    pending: info.transaction_status === "P",
  };
}

/**
 * Activity for the last `days` days, newest first. Transaction Search allows 31 days per request,
 * so longer ranges are read a month at a time.
 */
export async function readActivity(paypal, { days = 90, now = Date.now() } = {}) {
  const span = Math.min(Math.max(1, days), 365);
  const rows = [];
  let balance = null;
  for (let end = now; end > now - span * DAY; end -= 31 * DAY) {
    const start = Math.max(end - 31 * DAY, now - span * DAY);
    for (let page = 1, pages = 1; page <= pages && page <= 20; page++) {
      const query = new URLSearchParams({
        start_date: new Date(start).toISOString().replace(/\.\d+Z$/, "Z"),
        end_date: new Date(end).toISOString().replace(/\.\d+Z$/, "Z"),
        fields: "transaction_info,payer_info,shipping_info,cart_info,store_info",
        page_size: "500",
        page: String(page),
      });
      const result = await paypal("GET", `/v1/reporting/transactions?${query}`);
      pages = result.total_pages || 1;
      for (const row of result.transaction_details || []) {
        const value = row.transaction_info?.ending_balance?.value;
        if (value && (!balance || row.transaction_info.transaction_initiation_date > balance.at)) {
          balance = { amount: value, at: row.transaction_info.transaction_initiation_date };
        }
        const item = toActivity(row);
        if (item) rows.push(item);
      }
    }
  }
  const seen = new Set();
  const activity = rows.filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => b.date.localeCompare(a.date));
  return { activity, balance: balance?.amount ?? null, days: span };
}
