import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutLink, KLIPITGOOD_PLANS } from './payments.js';

test('KlipItGood plans expose launch pricing offers', () => {
  assert.equal(KLIPITGOOD_PLANS.per_clip.priceLabel, '$1/clip');
  assert.equal(KLIPITGOOD_PLANS.per_clip.conversionRole, 'trial');
  assert.equal(KLIPITGOOD_PLANS.unlimited_monthly.priceLabel, '$29.99/month');
  assert.equal(KLIPITGOOD_PLANS.unlimited_monthly.conversionRole, 'fallback');
  assert.equal(KLIPITGOOD_PLANS.annual_unlimited.priceLabel, '$199/year for life');
  assert.equal(KLIPITGOOD_PLANS.annual_unlimited.conversionRole, 'primary');
});

test('createCheckoutLink returns a safe placeholder when Stripe is not configured', async () => {
  const checkout = await createCheckoutLink({
    planId: 'annual_unlimited',
    lead: { id: 'lead-1', email: 'demo@example.com', name: 'Demo Lead' },
    request: { id: 'request-1', request_type: 'video_clipping' }
  });

  assert.equal(checkout.provider, 'placeholder');
  assert.equal(checkout.plan.id, 'annual_unlimited');
  assert.match(checkout.url, /mailto:adamporsborg@gmail.com/);
  assert.equal(checkout.metadata.source, 'klipitgood_app');
});

test('createCheckoutLink prefers live Stripe Payment Links when configured', async () => {
  const originalLink = process.env.STRIPE_ANNUAL_UNLIMITED_PAYMENT_LINK;
  process.env.STRIPE_ANNUAL_UNLIMITED_PAYMENT_LINK = 'https://buy.stripe.com/test_annual';

  try {
    const checkout = await createCheckoutLink({
      planId: 'annual_unlimited',
      lead: { id: 'lead-1', email: 'demo@example.com', name: 'Demo Lead' },
      request: { id: 'request-1', request_type: 'video_clipping' }
    });

    assert.equal(checkout.provider, 'stripe_payment_link');
    assert.equal(checkout.url, 'https://buy.stripe.com/test_annual');
    assert.equal(checkout.todo, null);
  } finally {
    if (originalLink === undefined) {
      delete process.env.STRIPE_ANNUAL_UNLIMITED_PAYMENT_LINK;
    } else {
      process.env.STRIPE_ANNUAL_UNLIMITED_PAYMENT_LINK = originalLink;
    }
  }
});
