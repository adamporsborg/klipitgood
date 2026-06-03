import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackAssistantMessage,
  buildKlipItGoodReply,
  detectIntent,
  extractContactInfo,
  shouldNotifyFounder
} from './klipitgoodChat.js';

test('detectIntent classifies actionable clipping leads without forcing a form', () => {
  const result = detectIntent('I need clips from my podcast. Can you do this for me?');

  assert.equal(result.detectedIntent, 'clipping_action');
  assert.equal(result.actionFlags.createServiceRequest, true);
  assert.equal(result.actionFlags.requiresLogin, false);
  assert.deepEqual(result.missingFields, ['name', 'email']);
});

test('detectIntent gates uploads behind account creation', () => {
  const result = detectIntent('I want to upload footage and start a free trial');

  assert.equal(result.detectedIntent, 'upload_attempt');
  assert.equal(result.actionFlags.requiresLogin, true);
  assert.equal(result.actionFlags.showTrialPath, true);
});

test('extractContactInfo finds email, phone, and a simple name', () => {
  const contact = extractContactInfo('My name is Jane Doe, email jane@example.com, phone 702-555-0199');

  assert.equal(contact.name, 'Jane Doe');
  assert.equal(contact.email, 'jane@example.com');
  assert.equal(contact.phone, '702-555-0199');
});

test('fallback assistant stays useful when OpenAI is unavailable', () => {
  const message = buildFallbackAssistantMessage({
    detectedIntent: 'pricing_question',
    actionFlags: { showTrialPath: true }
  });

  assert.match(message, /\$199\/year/i);
  assert.doesNotMatch(message, /prototype|as an ai/i);
});

test('buildKlipItGoodReply uses fallback and reports missing OpenAI key without throwing', async () => {
  const result = await buildKlipItGoodReply({
    messages: [{ role: 'user', content: 'How much for clipping my podcast?' }],
    env: {}
  });

  assert.equal(result.detectedIntent, 'pricing_question');
  assert.equal(result.aiProvider, 'fallback');
  assert.equal(result.warning, 'OPENAI_API_KEY is not configured.');
  assert.match(result.assistantMessage, /\$199\/year/i);
});

test('shouldNotifyFounder only notifies for actionable conversations and suppresses duplicates', () => {
  const first = shouldNotifyFounder({
    detectedIntent: 'clipping_interest',
    actionFlags: { notifyFounder: true },
    priorNotificationKinds: []
  });
  const duplicate = shouldNotifyFounder({
    detectedIntent: 'clipping_interest',
    actionFlags: { notifyFounder: true },
    priorNotificationKinds: ['lead_action']
  });
  const chat = shouldNotifyFounder({
    detectedIntent: 'general_chat',
    actionFlags: { notifyFounder: false },
    priorNotificationKinds: []
  });

  assert.equal(first.notify, true);
  assert.equal(duplicate.notify, false);
  assert.equal(chat.notify, false);
});
