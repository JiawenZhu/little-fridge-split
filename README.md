# Little Fridge Split

Split a grocery bill with the people you live with, and let them pay you back with **Venmo** or PayPal.

You buy groceries with Apple Pay, and [Little Fridge](https://little-fridge-2026.web.app) already knows what's in the bag.
Little Fridge Split turns that receipt into a settle-up link for each friend. The link shows only their items and their
share of the tax, with a big **Pay with Venmo** button. The money goes straight to the person who paid. Little Fridge
never holds it.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Work in progress: this is the day-1 spike.

## How the money moves

```
Friend's phone ── /s/<token> settle-up page ── Venmo / PayPal button (PayPal JS SDK, enable-funding=venmo)
                         │
Backend (Node 22) ───────┤ POST /api/shares/:token/order    → PayPal Orders v2, payee = organizer, amount set by server
                         │ POST /api/shares/:token/capture  → capture, check amount + custom_id, mark paid once
                         │ POST /webhooks/paypal            → verify signature, mark paid even if the page was closed
                         ▼
Organizer's PayPal / Venmo balance
```

- Venmo's own developer API is retired, so Venmo payments go through PayPal Checkout (Orders v2).
- **The server sets every amount.** The browser only says which share it is paying.
- Each order's `custom_id` is `<split>|<person>`. A capture or webhook only marks a share paid if the amount and
  `custom_id` match, and a replay never pays twice.
- A free option is always there: **Pay in the Venmo app instead** opens Venmo with the amount and note filled in
  (`venmo://paycharge`). There's no status callback, so it's marked paid by hand.
- Shares are computed in integer cents. Tax is spread in proportion to what each person bought, and the shares always
  add up to the receipt total.

## Run it

```bash
cp .env.example .env    # fill in PayPal sandbox REST credentials and the organizer's sandbox merchant ID
npm test
npm run dev             # http://localhost:8787
```

Open `http://localhost:8787/s/demo-sam` for Sam's share of the demo receipt. In sandbox, the Venmo button opens PayPal's
"Venmo Sandbox" page, where you sign in with a PayPal sandbox personal account to simulate a Venmo payment.

`spike/` holds the one-off scripts used to check what PayPal sandbox allows. See [SPIKE.md](SPIKE.md).

## Deploy

`render.yaml` deploys the backend to [Render](https://render.com). Set the secret environment variables in the Render
dashboard; they are never committed.

## Coming next

- Claude reads the receipt photo and proposes who had what, with a reason for each item.
- The iOS app's Split sheet: drag items onto people, live totals, send links, see Sent → Opened → Paid.
- An agent that sends reminders and formal PayPal invoices with the PayPal Agent Toolkit.
- Firestore storage instead of the spike's JSON file.

## License

[MIT](LICENSE)
