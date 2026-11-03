// Money actions Penny can take for Little Wallet, each one confirmed by the person on their phone first:
// PayPal invoices (to remind or bill a friend), refunds of a friend's payment, and payouts to pay friends back.

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** "12.5" → "12.50", within PayPal's limits, or an error naming what was wrong. */
function amountOf(value, what = "amount") {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 1) throw fail(400, `The ${what} must be more than $0`);
  if (cents > 1_000_000) throw fail(400, `PayPal takes up to $10,000 per ${what}`);
  return (cents / 100).toFixed(2);
}

const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");
const phoneOf = v => {
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
};

/** An invoice for one friend: sent by PayPal email when there's an address, otherwise a link to share. */
export async function sendInvoice(paypal, body) {
  const name = text(body.name, 60);
  if (!name) throw fail(400, "Who is the invoice for?");
  const email = text(body.email, 120);
  if (email && !isEmail(email)) throw fail(400, "That email doesn't look right");
  const items = (body.items || []).slice(0, 30).map(i => ({
    name: text(i.name, 120) || "Shared cost",
    quantity: "1",
    unit_amount: { currency_code: "USD", value: amountOf(i.amount, "item") },
  }));
  if (!items.length) throw fail(400, "Add what the invoice is for");
  const [given, ...rest] = name.split(" ");
  const draft = await paypal("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: "USD",
      note: text(body.note, 400) || undefined,
      memo: "Sent by Penny in Little Wallet",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
      // "splitId|person", so a paid invoice marks the right share paid.
      reference: /^[A-Za-z0-9_-]{1,64}\|[A-Za-z0-9_-]{1,40}$/.test(body.reference || "") ? body.reference : undefined,
    },
    primary_recipients: [{ billing_info: { name: { given_name: given, surname: rest.join(" ") || undefined }, ...(email ? { email_address: email } : {}) } }],
    items,
  });
  const id = draft.id || draft.href?.split("/").pop();
  const sent = await paypal("POST", `/v2/invoicing/invoices/${id}/send`, {
    send_to_recipient: Boolean(email),
    send_to_invoicer: false,
    subject: text(body.title, 80) || undefined,
  });
  const invoice = await paypal("GET", `/v2/invoicing/invoices/${id}`);
  const link = sent.href || invoice.detail?.metadata?.recipient_view_url
    || (invoice.links || []).find(l => l.rel === "payer-view")?.href || null;
  return {
    id,
    number: invoice.detail?.invoice_number || null,
    status: invoice.status || "SENT",
    total: invoice.amount?.value || null,
    emailed: Boolean(email),
    link,
  };
}

/** Gives back all or part of a payment a friend made. */
export async function refund(paypal, body) {
  const captureId = text(body.captureId, 40);
  if (!captureId || !/^[A-Z0-9]+$/.test(captureId)) throw fail(400, "Which payment should be refunded?");
  const capture = await paypal("GET", `/v2/payments/captures/${captureId}`);
  const value = body.amount == null ? capture.amount.value : amountOf(body.amount, "refund");
  if (Math.round(Number(value) * 100) > Math.round(Number(capture.amount.value) * 100)) throw fail(400, `That payment was only $${capture.amount.value}`);
  const result = await paypal("POST", `/v2/payments/captures/${captureId}/refund`, {
    amount: { currency_code: capture.amount.currency_code, value },
    note_to_payer: text(body.note, 255) || undefined,
  });
  return { id: result.id, status: result.status, amount: value };
}

/** Pays friends back in one batch, to their PayPal email or phone, or Venmo by phone. */
export async function payout(paypal, body) {
  const items = (body.items || []).slice(0, 20).map((i, n) => {
    const name = text(i.name, 60) || `Friend ${n + 1}`;
    const raw = text(i.to, 120);
    const phone = phoneOf(raw);
    if (!raw || (!isEmail(raw) && !phone)) throw fail(400, `${name} needs an email or phone number`);
    const venmo = i.wallet === "Venmo";
    if (venmo && !phone) throw fail(400, `Venmo needs ${name}'s phone number`);
    return {
      recipient_type: phone ? "PHONE" : "EMAIL",
      receiver: phone || raw,
      amount: { currency: "USD", value: amountOf(i.amount) },
      note: text(i.note, 4000) || `From Little Wallet`,
      sender_item_id: `lw-${Date.now()}-${n}`,
      ...(venmo ? { recipient_wallet: "VENMO" } : {}),
    };
  });
  if (!items.length) throw fail(400, "Who should be paid?");
  const result = await paypal("POST", "/v1/payments/payouts", {
    sender_batch_header: {
      sender_batch_id: `lw-${Date.now()}`,
      email_subject: text(body.subject, 255) || "You've been paid back",
      email_message: text(body.note, 1000) || "Paid back with Little Wallet.",
    },
    items,
  });
  const batch = result.batch_header || {};
  return { id: batch.payout_batch_id, status: batch.batch_status, count: items.length };
}
