// Spike: print an order's status, payee and payment source (node --env-file=.env spike/order-status.mjs <order id>).
import { createPayPal } from "../server/paypal.js";
const order = await createPayPal()("GET", `/v2/checkout/orders/${process.argv[2]}`);
const unit = order.purchase_units[0];
console.log(JSON.stringify({ status: order.status, payee: unit.payee?.merchant_id, amount: unit.amount.value, custom_id: unit.custom_id, payment_source: Object.keys(order.payment_source || {}), captures: unit.payments?.captures?.map(c => [c.id, c.status, c.amount.value]) }, null, 1));
