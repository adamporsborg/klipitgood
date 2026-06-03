# KlipItGood Payment Launch Checklist

Use Lovable Payments first if the Lovable app can create checkout, webhooks, subscription state, and customer portal from chat. That is the most convenient path because Lovable already owns the app UI and connected Supabase project.

Use Stripe Payment Links as the backup. They are faster than implementing full Checkout sessions and they already work with the local portal through environment variables.

## Lovable Payments Prompt

Paste this into the existing Lovable project:

```text
Add payments using Lovable Payments. Use Stripe unless Paddle is faster in this project.

Create three offers:
1. KlipItGood Founding 50 Unlimited - $199/year - primary recommended plan
2. KlipItGood Unlimited Monthly - $29.99/month - fallback plan
3. KlipItGood $1 Edited Klip - $1 one-time checkout - pay only when finalized

Show the $199/year founding plan first and mark it Best Deal. The first finalized Klip is free; do not create a standalone $0 plan card.

Allow users to chat and build a clipping brief before paying. Require paid status for downloads and recurring/unlimited rendering. On payment success, save plan and payment_status in Supabase and unlock the project.

If $1 per clip usage billing is not supported quickly, implement it as a simple $1 one-time checkout for launch and leave clip-count reconciliation manual.
```

## Products To Create

Create these three Stripe products/prices:

- KlipItGood Founding 50 Unlimited: `$199/year`
- KlipItGood Unlimited Monthly: `$29.99/month`
- KlipItGood $1 Edited Klip: `$1 one-time`

## Payment Links

Create one Payment Link for each offer and add the URLs to the app environment:

```bash
STRIPE_ANNUAL_UNLIMITED_PAYMENT_LINK=https://buy.stripe.com/...
STRIPE_UNLIMITED_MONTHLY_PAYMENT_LINK=https://buy.stripe.com/...
STRIPE_PER_CLIP_PAYMENT_LINK=https://buy.stripe.com/...
```

The portal already checks these variables first. If they exist, users get a live setup link in chat.

## Launch Priority

Lead with the founding annual link:

```text
Best deal: $199/year for the first 50 founding users. Unlimited clipping, price locked while the subscription stays active.
```

Revenue math:

- 50 founding annual buyers = `$9,950`
- 334 monthly buyers = about `$10,016` in month-one cash
- 10,000 $1 clips = `$10,000`

The $1 offer is a trust builder. The annual offer is the cash goal.
