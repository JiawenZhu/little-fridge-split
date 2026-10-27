# Day-1 spike: what PayPal sandbox allows (2026-10-27)

The plan (VENMO-SPLIT-PLAN.md in the Little Fridge app repo) said to prove four things before building.

| # | Question | Result | Evidence |
|---|---|---|---|
| a | Can our platform app create an order whose **payee is another merchant** (the organizer), with Venmo? | **Yes, for creating the order.** Works with and without the partner attribution header. With `payment_source.venmo` the order comes back `PAYER_ACTION_REQUIRED`. | `spike/payee-order.mjs`. The settle-up page's Venmo button created order `29882501NG161100A`: payee = organizer merchant, `payment_source: venmo`, $15.74, `custom_id tj-2026-10-26\|sam` (`spike/order-status.mjs`). |
| b | Does a Venmo payment complete in sandbox? | **Partly.** `Buttons({ fundingSource: VENMO }).isEligible()` is `true` with `buyer-country=US`. On desktop the Venmo flow opens a **"Venmo Sandbox"** page that simulates the payment with a PayPal sandbox personal account. On a phone browser it tries to switch to the Venmo app. **Not finished yet:** approving needs a sandbox buyer login. | Screens checked in the browser. |
| c | Does the PayPal webhook reach us and mark a share paid? | **Code done, live test pending.** `/webhooks/paypal` verifies the signature with `/v1/notifications/verify-webhook-signature` and marks the share paid on `PAYMENT.CAPTURE.COMPLETED`. Covered by a test with a mocked PayPal. A live test needs a public URL (Render) and a webhook registered on a Little Fridge sandbox app. | `tests/server.test.mjs` |
| d | Does a Venmo request link open prefilled on iPhone? | **Changed approach.** `venmo.com`'s universal links only cover `/u/*` and a few app paths, not `/?txn=…`. So phones get `venmo://paycharge?txn=pay&recipients=…&amount=…&note=…` and desktops get `https://venmo.com/u/<handle>`. **Pending:** tap it on a real iPhone with Venmo installed. | `venmo.com/.well-known/apple-app-site-association` |

## Decisions this changes

- Path A stands: one payee per order works, including with Venmo as the payment source.
- The free fallback uses the `venmo://` scheme. The iOS app needs `venmo` in `LSApplicationQueriesSchemes` to check that
  Venmo is installed.
- The demo should use a **Little Fridge** sandbox REST app (not gatefair's) so the webhook and the organizer accounts
  belong to this project.

## Still to verify

1. Finish one sandbox Venmo payment end to end (approve → capture → share shows Paid).
2. Register the webhook on the Render URL and watch `PAYMENT.CAPTURE.COMPLETED` arrive for an order whose payee is
   another merchant (do webhooks go to the platform app, the payee, or both?).
3. Tap the `venmo://` link on a real iPhone.
