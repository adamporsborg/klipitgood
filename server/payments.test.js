import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutLink, KLIPITGOOD_PLANS } from './payments.js';

test('KlipItGood plans expose starter, growth, and operator offers', () => {
  assert.equal(KLIPITGOOD_PLANS.starter.priceLabel, '$49/month');
  assert.equal(KLIPITGOOD_PLANS.starter.trialDays, 7);
  assert.equal(KLIPITGOOD_PLANS.growth.priceLabel, 'Pricing configured in Stripe');
  assert.equal(KLIPITGOOD_PLANS.operator.priceLabel, 'Scoped with UNSER');
});

test('createCheckoutLink returns a safe placeholder when Stripe is not configured', async () => {
  const checkout = await createCheckoutLink({
    planId: 'starter',
    lead: { id: 'lead-1', email: 'demo@example.com', name: 'Demo Lead' },
    request: { id: 'request-1', request_type: 'video_clipping' }
  });

  assert.equal(checkout.provider, 'placeholder');
  assert.equal(checkout.plan.id, 'starter');
  assert.match(checkout.url, /mailto:adamporsborg@gmail.com/);
  assert.equal(checkout.metadata.source, 'unsergpt_portal');
});
