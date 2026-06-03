export function cleanString(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function summarizeTranscript(messages = [], maxLength = 1800) {
  return messages
    .filter((message) => message && typeof message.content === 'string')
    .map((message) => `${message.role}: ${cleanString(message.content, 500)}`)
    .join('\n')
    .slice(0, maxLength);
}

function requestTitle(requestType) {
  if (requestType === 'video_clipping') return 'Video clipping request';
  if (requestType === 'strategy') return 'Marketing strategy inquiry';
  if (requestType === 'subscription') return 'KlipItGood subscription intent';
  return 'Diagnostic intake';
}

function requestSourceUrl(requestType, answers) {
  if (requestType === 'video_clipping') return cleanString(answers.footageAccess, 1000) || null;
  return cleanString(answers.website, 1000) || null;
}

export function buildPortalSubmission(body = {}, userAgent = null) {
  const requestType = cleanString(body.requestType, 80) || 'diagnostic';
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const lead = {
    name: cleanString(contact.name, 120),
    email: cleanString(contact.email, 254).toLowerCase(),
    phone: cleanString(contact.phone, 40) || null,
    business_name: cleanString(contact.businessName || answers.businessName, 160) || null,
    website: cleanString(contact.website || answers.website, 1000) || null
  };

  const transcriptSummary = summarizeTranscript(messages);
  const summary = [
    requestTitle(requestType),
    transcriptSummary,
    `User agent: ${userAgent || 'unknown'}`
  ].filter(Boolean).join('\n\n');

  const request = {
    request_type: requestType,
    status: 'new',
    summary,
    source_url: requestSourceUrl(requestType, answers),
    subscription_intent: Boolean(body.subscriptionIntent || answers.subscriptionIntent),
    selected_plan: cleanString(body.selectedPlan || answers.selectedPlan, 80) || null,
    metadata: {
      free_clips_offered: requestType === 'video_clipping',
      ongoing_need: cleanString(answers.ongoingNeed, 1000) || null,
      source: 'klipitgood'
    }
  };

  const conversation = {
    request_type: requestType,
    status: 'captured',
    title: requestTitle(requestType)
  };

  const sanitizedMessages = messages
    .filter((message) => message && typeof message.content === 'string')
    .map((message) => ({
      role: ['assistant', 'user', 'system'].includes(message.role) ? message.role : 'user',
      content: cleanString(message.content, 4000)
    }))
    .filter((message) => message.content);

  return { lead, request, conversation, messages: sanitizedMessages, answers };
}

export function portalSubmissionEmailHtml({ lead, request, answers }) {
  const answerRows = Object.entries(answers || {})
    .map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value || 'Not provided')}</p>`)
    .join('');

  return `
    <div style="font-family: Inter, Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h1 style="margin: 0 0 16px;">New KlipItGood request</h1>
      <p><strong>Request type:</strong> ${escapeHtml(request.request_type)}</p>
      <p><strong>Name:</strong> ${escapeHtml(lead.name || 'Not provided')}</p>
      <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(lead.phone || 'Not provided')}</p>
      <p><strong>Business:</strong> ${escapeHtml(lead.business_name || 'Not provided')}</p>
      <p><strong>Website/source:</strong> ${escapeHtml(lead.website || request.source_url || 'Not provided')}</p>
      <hr />
      ${answerRows}
      <hr />
      <p><strong>Summary:</strong></p>
      <p style="white-space: pre-wrap;">${escapeHtml(request.summary)}</p>
    </div>
  `;
}
