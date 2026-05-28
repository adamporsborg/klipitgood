const SYSTEM_PROMPT = `UNSERGPT is the AI front desk and marketing operator for UNSER Media.

It helps with KlipItGood video clipping, social media graphics, branding and design, marketing strategy, content systems, AI workflows, website/project help, team contact, billing, and deliverables.

Tone: human, concise, useful, consultative, sharp, not fake, not corporate, not a rigid form.

Behavior: answer naturally first, ask only the next useful question, do not interrogate with long forms, do not say "as an AI", do not say prototype/test language, route requests quietly in the backend, ask for contact info only when needed, and trigger login only when the user wants to upload, generate, save, start trial, or access billing.`;

const ACTIONABLE_INTENTS = new Set([
  'clipping_interest',
  'clipping_action',
  'design_action',
  'strategy_interest',
  'team_contact_request',
  'pricing_question',
  'trial_interest',
  'upload_attempt',
  'payment_intent',
  'human_help_needed'
]);

const ACTION_INTENTS = new Set([
  'clipping_action',
  'design_action',
  'team_contact_request',
  'trial_interest',
  'upload_attempt',
  'payment_intent',
  'human_help_needed'
]);

function lastUserContent(messages = []) {
  return [...messages].reverse().find((message) => message?.role === 'user' && typeof message.content === 'string')?.content || '';
}

export function extractContactInfo(text = '') {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || '';
  const name = text.match(/\b(?:my name is|i am|i'm|this is)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3})/i)?.[1] || '';

  return {
    name: name ? name.replace(/[,.].*$/, '').trim().replace(/\b\w/g, (letter) => letter.toUpperCase()) : '',
    email,
    phone: phone.trim()
  };
}

export function detectIntent(input = '', knownContact = {}) {
  const text = String(input || '');
  const value = text.toLowerCase();
  const extractedContact = extractContactInfo(text);
  const contact = { ...extractedContact, ...Object.fromEntries(Object.entries(knownContact || {}).filter(([, value]) => value)) };

  let detectedIntent = 'general_chat';
  if (/(upload|footage|file|dropbox|drive link|process my video|generate clips|save this|save my|billing|invoice|deliverables?)/.test(value)) {
    detectedIntent = 'upload_attempt';
  } else if (/(free trial|trial|start trial)/.test(value)) {
    detectedIntent = 'trial_interest';
  } else if (/(pay|payment|checkout|subscribe|credit card|stripe|buy)/.test(value)) {
    detectedIntent = 'payment_intent';
  } else if (/(how much|price|pricing|cost|rate|package|plan)/.test(value)) {
    detectedIntent = 'pricing_question';
  } else if (/(clip|clips|clipping|podcast|reel|shorts|tiktok|youtube|video edit|video editing)/.test(value)) {
    detectedIntent = /(need|want|start|do this|make|create|clip my|from my|can you)/.test(value) ? 'clipping_action' : 'clipping_interest';
  } else if (/(logo|graphic|graphics|design|brand|branding|flyer|thumbnail|social post)/.test(value)) {
    detectedIntent = /(need|want|make|create|design|can you)/.test(value) ? 'design_action' : 'design_interest';
  } else if (/(talk to|speak with|human|adam|team|call me|contact me|follow up|can you do this|do this for me|want to start)/.test(value)) {
    detectedIntent = 'team_contact_request';
  } else if (/(strategy|marketing|content system|campaign|growth|leads|sales|positioning)/.test(value)) {
    detectedIntent = 'strategy_interest';
  } else if (/(ai workflow|automation|automate|agent|chatbot|front desk|crm|operations)/.test(value)) {
    detectedIntent = 'ai_workflow_interest';
  }

  const requiresLogin = /upload|generate|save|billing|deliverables?|trial|checkout|subscribe|pay/.test(value)
    || ['upload_attempt', 'trial_interest', 'payment_intent'].includes(detectedIntent);
  const notifyFounder = ACTIONABLE_INTENTS.has(detectedIntent) || Boolean(contact.email || contact.phone);
  const createServiceRequest = ACTION_INTENTS.has(detectedIntent) || ['pricing_question', 'strategy_interest', 'clipping_interest'].includes(detectedIntent);
  const showTrialPath = ['trial_interest', 'payment_intent', 'pricing_question', 'upload_attempt'].includes(detectedIntent);
  const missingFields = createServiceRequest
    ? ['name', 'email'].filter((field) => !contact[field])
    : [];

  return {
    detectedIntent,
    actionFlags: {
      notifyFounder,
      createServiceRequest,
      requiresLogin,
      showTrialPath,
      saveContact: Boolean(contact.email || contact.phone)
    },
    missingFields,
    contact
  };
}

export function buildFallbackAssistantMessage({ detectedIntent, actionFlags = {}, missingFields = [] }) {
  if (actionFlags.requiresLogin) {
    return "Before we process footage or save this as a project, we'll need you to create an account so your clips and requests are saved. You can keep chatting here first, or create an account when you're ready to upload, generate, start a trial, or view billing.";
  }

  if (detectedIntent === 'pricing_question' || actionFlags.showTrialPath) {
    return 'KlipItGood Starter is $49/month with a 7-day free trial. If you tell me what kind of footage you have and how often you need clips, I can point you to the right path.';
  }

  if (detectedIntent.includes('clipping')) {
    return missingFields.length
      ? 'Yes. Tell me what the footage is from and what kind of clips you want. If you want the UNSER team to take it from there, send your name and email when ready.'
      : 'Got it. I can route this to Adam and the UNSER team. What is the footage source and what kind of clips are you trying to get out of it?';
  }

  if (detectedIntent.includes('design')) {
    return 'Yes. What are you trying to design, and where will it be used?';
  }

  if (detectedIntent === 'strategy_interest') {
    return 'Good. What are you trying to grow or fix right now: content, leads, offer clarity, or the operating system behind it?';
  }

  if (detectedIntent === 'team_contact_request' || detectedIntent === 'human_help_needed') {
    return 'I can get this in front of Adam and the UNSER team. What should they review, and what is the best email or phone number for follow-up?';
  }

  return 'Tell me what you are trying to get done, and I will help you shape the next useful step.';
}

function buildOpenAiMessages(messages, intentResult, context) {
  const recentMessages = Array.isArray(messages) ? messages.slice(-16) : [];
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `Backend metadata only. Detected intent: ${intentResult.detectedIntent}. Missing fields: ${intentResult.missingFields.join(', ') || 'none'}. Context/tool: ${context?.currentTool || context?.currentContext || 'portal chat'}.`
    },
    ...recentMessages
      .filter((message) => ['user', 'assistant', 'system'].includes(message?.role) && typeof message.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.slice(0, 4000) }))
  ];
}

export async function buildUnserGptReply({ messages = [], context = {}, env = process.env, fetchImpl = fetch }) {
  const latestUserMessage = lastUserContent(messages);
  const intentResult = detectIntent(latestUserMessage, context.contact);

  if (!env.OPENAI_API_KEY) {
    return {
      assistantMessage: buildFallbackAssistantMessage(intentResult),
      aiProvider: 'fallback',
      warning: 'OPENAI_API_KEY is not configured.',
      ...intentResult
    };
  }

  try {
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: buildOpenAiMessages(messages, intentResult, context),
        temperature: 0.5
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${errorText.slice(0, 240)}`);
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content?.trim();
    if (!assistantMessage) throw new Error('OpenAI returned an empty assistant message.');

    return {
      assistantMessage,
      aiProvider: env.OPENAI_MODEL || 'gpt-4o-mini',
      warning: null,
      ...intentResult
    };
  } catch (error) {
    console.warn('[unsergpt] OpenAI fallback:', error.message);
    return {
      assistantMessage: buildFallbackAssistantMessage(intentResult),
      aiProvider: 'fallback',
      warning: error.message,
      ...intentResult
    };
  }
}

export function shouldNotifyFounder({ detectedIntent, actionFlags = {}, priorNotificationKinds = [] }) {
  if (!actionFlags.notifyFounder && !ACTIONABLE_INTENTS.has(detectedIntent)) {
    return { notify: false, reason: 'not_actionable' };
  }

  if (priorNotificationKinds.includes('lead_action')) {
    return { notify: false, reason: 'already_notified' };
  }

  return { notify: true, kind: 'lead_action' };
}

export function buildFounderNotificationPayload(event) {
  return {
    userMessage: event.userMessage || '',
    detectedIntent: event.detectedIntent || 'general_chat',
    name: event.contact?.name || '',
    email: event.contact?.email || '',
    phone: event.contact?.phone || '',
    transcriptSummary: event.transcriptSummary || '',
    portalLink: event.portalLink || '',
    sessionId: event.sessionId || '',
    timestamp: event.timestamp || new Date().toISOString()
  };
}

function notificationText(payload) {
  return [
    `New UNSERGPT action: ${payload.detectedIntent}`,
    `Message: ${payload.userMessage || 'Not provided'}`,
    `Name: ${payload.name || 'Not provided'}`,
    `Email: ${payload.email || 'Not provided'}`,
    `Phone: ${payload.phone || 'Not provided'}`,
    `Session: ${payload.sessionId || 'Not provided'}`,
    `Portal: ${payload.portalLink || 'Not provided'}`,
    `Time: ${payload.timestamp}`,
    '',
    payload.transcriptSummary
  ].filter(Boolean).join('\n');
}

export async function notifyFounder(event, { env = process.env, fetchImpl = fetch, supabase = null } = {}) {
  const payload = buildFounderNotificationPayload(event);
  const text = notificationText(payload);
  const failures = [];

  async function tryProvider(provider, fn) {
    try {
      const result = await fn();
      return { sent: true, provider, id: result?.id || result?.sid || null };
    } catch (error) {
      failures.push({ provider, error: error.message });
      return null;
    }
  }

  if (env.TEAM_WEBHOOK_URL) {
    const sent = await tryProvider('webhook', async () => {
      const response = await fetchImpl(env.TEAM_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Webhook failed with ${response.status}`);
      return {};
    });
    if (sent) return { ...sent, failures };
  }

  const notifyEmail = env.FOUNDER_NOTIFY_EMAIL || env.TEAM_NOTIFY_EMAIL;
  if (env.RESEND_API_KEY && notifyEmail) {
    const sent = await tryProvider('resend', async () => {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM || 'UNSERGPT <onboarding@resend.dev>',
          to: [notifyEmail],
          subject: `New UNSERGPT lead: ${payload.detectedIntent}`,
          text,
          reply_to: payload.email || undefined
        })
      });
      if (!response.ok) throw new Error(`Resend failed with ${response.status}`);
      return response.json();
    });
    if (sent) return { ...sent, failures };
  }

  if (env.SENDGRID_API_KEY && notifyEmail) {
    const sent = await tryProvider('sendgrid', async () => {
      const response = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: notifyEmail }] }],
          from: { email: env.SENDGRID_FROM_EMAIL || 'alerts@unser.media', name: 'UNSERGPT' },
          subject: `New UNSERGPT lead: ${payload.detectedIntent}`,
          content: [{ type: 'text/plain', value: text }]
        })
      });
      if (!response.ok) throw new Error(`SendGrid failed with ${response.status}`);
      return {};
    });
    if (sent) return { ...sent, failures };
  }

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.FOUNDER_PHONE_NUMBER) {
    const sent = await tryProvider('twilio', async () => {
      const form = new URLSearchParams({
        From: env.TWILIO_FROM_NUMBER,
        To: env.FOUNDER_PHONE_NUMBER,
        Body: text.slice(0, 1500)
      });
      const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form
      });
      if (!response.ok) throw new Error(`Twilio failed with ${response.status}`);
      return response.json();
    });
    if (sent) return { ...sent, failures };
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const sent = await tryProvider('telegram', async () => {
      const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 3500) })
      });
      if (!response.ok) throw new Error(`Telegram failed with ${response.status}`);
      return response.json();
    });
    if (sent) return { ...sent, failures };
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('notification_events')
        .insert({
          provider: 'fallback',
          status: 'queued',
          event_type: 'lead_action',
          payload,
          error: failures.length ? JSON.stringify(failures) : null
        })
        .select('id')
        .single();
      if (error) throw error;
      return { sent: false, provider: 'notification_events', saved: true, id: data?.id || null, failures };
    } catch (error) {
      failures.push({ provider: 'notification_events', error: error.message });
    }
  }

  return { sent: false, provider: 'none', saved: false, failures };
}
