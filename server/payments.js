export const KLIPITGOOD_PLANS = {
  starter: {
    id: 'starter',
    name: 'KlipItGood Starter',
    priceLabel: process.env.STRIPE_STARTER_PRICE_LABEL || '$49/month',
    trialDays: 7,
    includes: [
      '7-day free trial',
      'monthly clip allowance',
      'captions',
      'social-ready exports',
      'portal access'
    ]
  },
  growth: {
    id: 'growth',
    name: 'KlipItGood Growth',
    priceLabel: process.env.STRIPE_GROWTH_PRICE_LABEL || 'Pricing configured in Stripe',
    includes: [
      'more clips',
      'priority processing',
      'graphics',
      'enhanced support'
    ]
  },
  operator: {
    id: 'operator',
    name: 'UNSER Operator',
    priceLabel: process.env.STRIPE_OPERATOR_PRICE_LABEL || 'Scoped with UNSER',
    includes: [
      'done-for-you workflows',
      'content systems',
      'strategy',
      'operational support',
      'advanced AI assistance'
    ]
  }
};

export function getPlan(planId) {
  return KLIPITGOOD_PLANS[planId] || KLIPITGOOD_PLANS.starter;
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
    source: 'unsergpt_portal'
  };

  if (process.env.STRIPE_SECRET_KEY && process.env[`STRIPE_${plan.id.toUpperCase()}_PRICE_ID`]) {
    return {
      provider: 'stripe',
      plan,
      metadata,
      url: null,
      todo: 'Install stripe package and create checkout session with this metadata.'
    };
  }

  const subject = encodeURIComponent(`${plan.name} for ${lead?.name || lead?.email || 'new UNSERGPT lead'}`);
  const body = encodeURIComponent([
    `Plan interest: ${plan.name}`,
    `Lead: ${lead?.name || 'Not provided'} <${lead?.email || 'not provided'}>`,
    `Request: ${request?.id || 'not saved'}`,
    'Source: UNSERGPT portal'
  ].join('\n'));

  return {
    provider: 'placeholder',
    plan,
    metadata,
    url: `mailto:adamporsborg@gmail.com?subject=${subject}&body=${body}`,
    todo: 'Add STRIPE_SECRET_KEY and STRIPE_*_PRICE_ID env vars, then replace placeholder with a live Stripe Checkout session.'
  };
}
