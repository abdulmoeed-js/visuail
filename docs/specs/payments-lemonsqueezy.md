# PRD: Real Payments via LemonSqueezy (MENA + Worldwide)

**Status:** Locked, in development
**Owner:** Moeed
**Date:** 2026-07-19

## Problem Statement

Visuail's checkout is entirely fake. `CheckoutModal.tsx` collects card details into a form, sleeps 1.4 seconds, and calls `sessionStore.setTier()` — a bare client-side `UPDATE organizations SET tier = ...` with no payment behind it. The button literally reads "No real payment is processed."

This has two costs, not one. First, Visuail cannot collect a single dollar of revenue in its current state — every "upgrade" is fictional. Second, `setTier()` has no server-side guard: any signed-in org owner can call it directly (e.g. via browser devtools) and grant their own org the Team tier for free. This is a live, exploitable free-upgrade path in production today, not just an unconvincing demo.

The target market (Middle East + worldwide) adds a real compliance dimension on top of the usual "just add Stripe" instinct: digital-services VAT/GST applies from the first sale in most jurisdictions (UK, EU, Saudi Arabia at 15%, UAE at 5%, Egypt at 14%), and foreign non-local card acquirers see materially higher decline rates in Saudi Arabia and Egypt specifically than local/regional rails do.

## Goals

1. Replace the fake checkout with real Visa/Mastercard payment collection for the Pro ($6/mo) and Team ($15/mo, 3 seats) tiers, worldwide, with no PCI scope taken on by Visuail.
2. Close the `setTier()` exploit — tier changes become possible only via a verified payment event, enforced at the database level, not just by removing the client call site.
3. Minimize ongoing operational burden: no manual VAT/GST registration or remittance per country, no custom tax logic, no in-house chargeback handling.
4. Deliver a checkout experience that is credible for MENA users specifically — local currency display and (where the provider supports it) local payment method coverage, rather than a USD-only form that silently under-serves the target region.
5. Ship without adding calendar-time risk from long payment-provider underwriting queues.

## Non-Goals

- **Seat-based / beyond-3-seat Team billing.** Today's Team tier is a flat $15 for 3 bundled seats with "additional seats — contact us." Real quantity-based billing is a natural next step once LemonSqueezy is wired up, but it's a separate scope decision (pricing model change, not just payment plumbing) and is explicitly parked, not bundled here.
- **Annual billing / discounted yearly plans.** Worth revisiting once monthly is live and stable — introducing it now adds proration and plan-change edge cases to an already-new integration.
- **Building a custom billing-management UI** (invoices, card-on-file editor, cancellation flow). LemonSqueezy's hosted Customer Portal covers this; building our own would duplicate PCI-adjacent surface area for no user benefit.
- **Direct-to-processor integration (Stripe/Adyen) or a MENA-native PSP (Checkout.com, Tap, PayTabs).** These were the explicit alternative considered and rejected for v1 in favor of Merchant-of-Record, because they push VAT/GST registration and remittance onto Visuail across every jurisdiction it sells into — directly contradicting the "minimal ops burden" goal. Revisit only once revenue scale justifies dedicated finance/tax ops.
- **Free trials / trial-to-paid conversion flows.** Out of scope for this spec; today's Free tier already serves as the no-card-required entry point.

## User Stories

- As a **prospective Pro user**, I want to pay for Visuail with my Visa/Mastercard and see my correct local currency (not just USD) so that the checkout feels legitimate and priced for me.
- As a **MENA-based user**, I want my card to actually be accepted, so that a foreign-acquirer decline doesn't block me from paying for a product I want.
- As a **paying user whose card is later declined on renewal**, I want to see a clear in-app notice and an easy way to update my payment method, so that I don't get silently downgraded without understanding why.
- As a **paying user**, I want a self-serve way to view invoices, update my card, or cancel, so that I'm never stuck emailing support to manage my own subscription.
- As **Visuail's owner**, I want tier changes to only ever originate from a verified payment event, so that no user can grant themselves a paid tier without paying.
- As **Visuail's owner**, I want to avoid registering for VAT/GST in every country a customer signs up from, so that I can run this without a finance/tax function.

## Requirements

### Must-Have (P0)

**P0.1 — `subscriptions` table with locked-down writes.**
- A new table (org_id, provider, provider_subscription_id, provider_customer_id, status, tier, current_period_end, created_at, updated_at).
- RLS: org members can `SELECT` their own org's row. No client `INSERT`/`UPDATE`/`DELETE` policy exists — only the webhook function (service role) writes to it.
- Acceptance: a normal authenticated client request to insert/update this table is rejected by RLS.

**P0.2 — `organizations.tier` no longer client-writable.**
- Revoke `UPDATE` on the `tier` column from the `authenticated` role at the database level (not just removing the client call site).
- Acceptance: given a signed-in user with an open devtools console, when they attempt `supabase.from('organizations').update({tier: 'team'})` directly, then the request is rejected by Postgres, regardless of what the client code does or doesn't call.

**P0.3 — `create-checkout` Edge Function.**
- Given an authenticated request with `orgId` and `tier` ("pro" | "team"), when the caller is verified as the org owner (reusing the existing `is_org_owner` RPC), then the function calls LemonSqueezy's Checkout API with the org_id embedded in checkout custom data and returns a hosted checkout URL.
- Acceptance: a non-owner org member's request is rejected; a valid owner request returns a working LS checkout URL.

**P0.4 — `lemonsqueezy-webhook` Edge Function.**
- Verifies the LS webhook HMAC signature before trusting any payload (`verify_jwt: false`, since LS calls this directly with no user auth — signature is the trust boundary, matching the pattern already used for the Slack OAuth callback).
- Handles `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_payment_failed`: upserts the `subscriptions` row and sets `organizations.tier` accordingly (active → pro/team; cancelled/expired → free).
- Acceptance: a request with an invalid/missing signature is rejected with no DB write; a valid `subscription_created` event flips the org to the correct tier within the same request.

**P0.5 — Real checkout in the frontend.**
- `CheckoutModal`'s fake card-entry form is deleted (not modified) and replaced with a call to `create-checkout` followed by a redirect to the returned LS hosted checkout URL.
- Acceptance: clicking "Upgrade to Pro/Team" in `Pricing.tsx` lands the user on a real LemonSqueezy-hosted payment page, not an in-app fake form.

**P0.6 — Post-payment activation state.**
- After redirect back from LS, the app shows an "activating your plan" wait state rather than assuming the tier flip is instant — the webhook can land after the redirect completes.
- Acceptance: given a successful payment redirect, when the webhook hasn't yet landed, then the UI shows a waiting state (not a false failure or a stuck spinner) and updates automatically once the tier changes.

**P0.7 — Billing management access.**
- A "Manage billing" link/button (in `TeamSettingsDialog`) that opens LS's hosted Customer Portal for the signed-in org's subscription (invoices, card update, cancellation).
- Acceptance: a paying user can reach the portal in one click from Settings.

**P0.8 — Failed-renewal notice.**
- On `subscription_payment_failed`, an in-app banner tells the affected org's members payment failed and links to the billing portal to fix it.
- Acceptance: given a simulated failed-renewal webhook event, the org sees a `past_due` banner until the next successful payment or portal-driven update.

### Nice-to-Have (P1)

- Toast/inline confirmation distinguishing "payment succeeded, activating" from "payment succeeded, active" states more granularly than a single spinner.
- Logging/alerting (reusing the existing `usage_events` table) for `checkout_started`, `subscription_activated`, `subscription_cancelled`, `payment_failed` so this shows up in the same usage-observability view built earlier this project.

### Future Considerations (P2)

- Seat-quantity billing for Team beyond 3 seats (parked non-goal above — designing the `subscriptions` schema with a `seats` column now, even though it's unused in v1, avoids a schema migration later).
- Annual billing / plan-level discounts.
- Multi-currency price display beyond whatever LemonSqueezy handles automatically.

## Success Metrics

**Leading (days–weeks):**
- Checkout completion rate (started → paid) — no existing baseline since nothing real exists today; first real data point.
- Webhook delivery-to-tier-sync latency — target under 10 seconds p95, so the "activating your plan" wait state referenced in P0.6 stays brief.
- Zero successful direct-write attempts against `organizations.tier` or `subscriptions` from non-service-role callers (verifiable via Supabase logs/advisors).

**Lagging (weeks–months):**
- MENA-region checkout completion rate vs. rest-of-world — the specific signal this spec exists to produce, given the decline-rate concern raised in the Problem Statement.
- Involuntary churn from failed renewals (should trend down over time as the `past_due` banner + portal access give users a self-serve fix).

## Open Questions

- **[Engineering/vendor]** Does LemonSqueezy's payment-method coverage actually include mada (Saudi Arabia) and other MENA-local rails, or only major cards? Flagged in the brainstorm as needing a direct doc check before go-live — not yet verified.
- **[Product]** Should the Team tier's "additional seats — contact us" copy change once real billing exists, even before seat-quantity billing is built? (Leaning: no, leave as-is until P2 seat billing ships, to avoid promising a capability that doesn't exist yet.)
- **[Legal — not something I can answer, flagging for a real lawyer if it matters]** Does continuing to display "no real payment is processed" anywhere in the UI after this ships (e.g. cached copy, marketing pages) create consumer-protection risk? Worth a compliance pass before go-live, not part of this spec's engineering scope.

## Timeline Considerations

- **Blocking external dependency:** LemonSqueezy store creation and business verification (P0.3 onward can't go live without it) is owned by Moeed and explicitly happens *after* all development slices below are built and reviewed — engineering work is not blocked on it, only the final go-live smoke test is.
- **Phasing:** Slices 1–6 (schema, both edge functions, frontend swap, activation UX, billing portal + banner) are built and verified in test/staging conditions without a live LS account. Slice 7 (go-live) requires Moeed's LS account, real product IDs, and secrets, and is the only slice that needs his direct involvement mid-build.

## Development Slices

1. `subscriptions` table + RLS + revoke client `tier`-column write access (DB migration).
2. `create-checkout` Edge Function.
3. `lemonsqueezy-webhook` Edge Function.
4. Frontend swap: delete the fake `CheckoutModal` form, wire real redirect checkout.
5. Post-payment success/cancel/activating-wait UX.
6. Billing management portal link + `past_due` banner.
7. Go-live: Moeed creates the LS store/products, sets secrets, test-mode verification, one real refundable $6 smoke test.
