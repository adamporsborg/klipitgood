export const KLIPITGOOD_PLANS = {
  per_clip: {
    id: 'per_clip',
    name: 'KlipItGood $1 Per Clip',
    priceLabel: process.env.STRIPE_PER_CLIP_PRICE_LABEL || '$1/clip',
    conversionRole: 'trial',
    includes: [
      '$1 per delivered clip',
      'AI clipping brief',
      'captions and social-ready exports',
      'upgrade anytime'
    ]
  },
  unlimited_monthly: {
    id: 'unlimited_monthly',
    name: 'KlipItGood Unlimited Monthly',
    priceLabel: process.env.STRIPE_UNLIMITED_MONTHLY_PRICE_LABEL || '$29.99/month',
    conversionRole: 'fallback',
    includes: [
      'unlimited clipping',
      'one active upload at a time',
      'prompt-based revisions',
      'strategy and shoot planning',
      'cancel anytime'
    ]
  },
  annual_unlimited: {
    id: 'annual_unlimited',
    name: 'KlipItGood Founding 50 Unlimited',
    priceLabel: process.env.STRIPE_ANNUAL_UNLIMITED_PRICE_LABEL || '$199/year for life',
    conversionRole: 'primary',
    includes: [
      'unlimited clipping projects',
      'price locked while subscription stays active',
      'prompt-based revisions',
      'saved styles and project memory',
      'only 50 founding spots'
    ]
  }
};

export function getPlan(planId) {
  return KLIPITGOOD_PLANS[planId] || KLIPITGOOD_PLANS.annual_unlimited;
}

export async function createCheckoutLink({ planId, lead, request }) {
  const plan = getPlan(planId);
  const metadata = {
    request_type: request?.request_type || 'video_clipping',
    lead_id: lead?.id || '',
    lead_email: lead?.email || '',
    lead_name: lead?.name || '',
    service_request_id: request?.id || '',
    selected_plan: plan.id,
    source: 'klipitgood_app'
  };

  const directPaymentLink = process.env[`STRIPE_${plan.id.toUpperCase()}_PAYMENT_LINK`];
  if (directPaymentLink) {
    return {
      provider: 'stripe_payment_link',
      plan,
      metadata,
      url: directPaymentLink,
      todo: null
    };
  }

  if (process.env.STRIPE_SECRET_KEY && process.env[`STRIPE_${plan.id.toUpperCase()}_PRICE_ID`]) {
    return {
      provider: 'stripe',
      plan,
      metadata,
      url: null,
      todo: 'Install stripe package and create checkout session with this metadata.'
    };
  }

  const subject = encodeURIComponent(`${plan.name} for ${lead?.name || lead?.email || 'new KlipItGood lead'}`);
  const body = encodeURIComponent([
    `Plan interest: ${plan.name}`,
    `Lead: ${lead?.name || 'Not provided'} <${lead?.email || 'not provided'}>`,
    `Request: ${request?.id || 'not saved'}`,
    'Source: KlipItGood app'
  ].join('\n'));

  return {
    provider: 'placeholder',
    plan,
    metadata,
    url: `mailto:adamporsborg@gmail.com?subject=${subject}&body=${body}`,
    todo: 'Add STRIPE_SECRET_KEY and STRIPE_*_PRICE_ID env vars, then replace placeholder with a live Stripe Checkout session.'
  };
}
