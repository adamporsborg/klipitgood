import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortalSubmission,
  cleanString,
  isEmail,
  summarizeTranscript
} from './intake.js';

test('cleanString trims strings and limits length', () => {
  assert.equal(cleanString('  hello world  ', 5), 'hello');
  assert.equal(cleanString(null), '');
});

test('isEmail accepts basic valid emails and rejects invalid input', () => {
  assert.equal(isEmail('adam@example.com'), true);
  assert.equal(isEmail('not-an-email'), false);
});

test('summarizeTranscript creates a compact transcript summary', () => {
  const summary = summarizeTranscript([
    { role: 'assistant', content: 'What kind of footage do you have?' },
    { role: 'user', content: 'A podcast interview about local politics.' }
  ]);

  assert.match(summary, /assistant: What kind of footage/);
  assert.match(summary, /user: A podcast interview/);
});

test('buildPortalSubmission creates lead, request, conversation, and messages payloads', () => {
  const submission = buildPortalSubmission({
    requestType: 'video_clipping',
    contact: {
      name: 'Adam',
      email: 'ADAM@example.com',
      phone: '702-555-1212',
      businessName: '',
      website: ''
    },
    answers: {
      footageType: 'YouTube podcast',
      footageAccess: 'https://youtube.com/watch?v=demo',
      clipGoal: 'punchy Reels'
    },
    messages: [
      { role: 'assistant', content: 'What kind of footage do you have?' },
      { role: 'user', content: 'YouTube podcast' }
    ]
  }, 'unit-test-agent');

  assert.equal(submission.lead.email, 'adam@example.com');
  assert.equal(submission.request.request_type, 'video_clipping');
  assert.equal(submission.request.source_url, 'https://youtube.com/watch?v=demo');
  assert.equal(submission.request.subscription_intent, false);
  assert.equal(submission.request.metadata.free_clips_offered, true);
  assert.equal(submission.conversation.request_type, 'video_clipping');
  assert.equal(submission.messages.length, 2);
  assert.match(submission.request.summary, /YouTube podcast/);
});
