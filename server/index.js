import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import {
  buildPortalSubmission,
  cleanString,
  escapeHtml,
  isEmail,
  summarizeTranscript,
  portalSubmissionEmailHtml
} from './intake.js';
import { createCheckoutLink, getPlan } from './payments.js';
import {
  buildKlipItGoodReply,
  notifyFounder,
  shouldNotifyFounder
} from './klipitgoodChat.js';
import {
  buildWorkerProjectUpdate,
  engineReady,
  engineRoot,
  normalizeClipRows,
  outputDir,
  selectNextQueuedProject,
  uploadedFootagePath
} from './workerBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const port = process.env.PORT || 8787;
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/output', express.static(outputDir, {
  acceptRanges: true,
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServerKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
const adminPassword = process.env.ADMIN_PASSWORD;
const adminEmail = process.env.ADMIN_EMAIL || 'adamporsborg@gmail.com';
const resendFrom = process.env.RESEND_FROM || 'KlipItGood <onboarding@resend.dev>';
const workerToken = process.env.KLIPITGOOD_WORKER_TOKEN || adminPassword;
const workerAutoRun = process.env.KLIPITGOOD_AUTO_RUN !== 'false';
const runningWorkers = new Map();

const supabase = supabaseUrl && supabaseServerKey
  ? createClient(supabaseUrl, supabaseServerKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function requireConfig(res, keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    res.status(500).json({
      error: `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!adminPassword) {
    res.status(500).json({ error: 'Missing required environment variable: ADMIN_PASSWORD' });
    return;
  }

  if (req.header('x-admin-password') !== adminPassword) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  next();
}

function requireWorker(req, res, next) {
  if (!workerToken) {
    res.status(500).json({ error: 'Missing required environment variable: KLIPITGOOD_WORKER_TOKEN or ADMIN_PASSWORD' });
    return;
  }

  if (req.header('authorization') !== `Bearer ${workerToken}`) {
    res.status(401).json({ error: 'Invalid worker token' });
    return;
  }

  next();
}

/**
 * Reads the Supabase JWT from the Authorization header and returns the user object,
 * or null if not present / invalid. Non-blocking — never rejects the request.
 */
async function getUserFromRequest(req) {
  if (!supabase) return null;
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token === workerToken) return null; // skip worker tokens
  try {
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : (data.user || null);
  } catch {
    return null;
  }
}

function workerBaseUrl() {
  return process.env.KLIPITGOOD_PUBLIC_API_URL || `http://127.0.0.1:${port}`;
}

function launchWorkerForProject(projectId) {
  if (!workerAutoRun || !projectId || runningWorkers.has(projectId)) {
    return { started: false, reason: !workerAutoRun ? 'auto-run disabled' : 'already running' };
  }

  if (!engineReady()) {
    return { started: false, reason: `Missing clipping worker under ${engineRoot}` };
  }

  const child = spawn('npm', ['run', 'worker', '--', '--project', projectId], {
    cwd: engineRoot,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      KLIPITGOOD_WORKER_API_URL: `${workerBaseUrl()}/api/worker`,
      KLIPITGOOD_WORKER_TOKEN: workerToken,
      KLIPITGOOD_OUTPUT_BASE_URL: `${workerBaseUrl()}/output`
    }
  });

  runningWorkers.set(projectId, { pid: child.pid, startedAt: new Date().toISOString() });
  child.once('exit', () => runningWorkers.delete(projectId));
  child.unref();

  return { started: true, pid: child.pid };
}

async function loadProjectWithClips(projectId) {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, user_email, title, status, footage_url, prompt, intake_data, phone, admin_message, created_at')
    .eq('id', projectId)
    .single();

  if (projectError) throw projectError;

  const { data: clips, error: clipsError } = await supabase
    .from('clips')
    .select('id, project_id, title, score, description, duration_seconds, thumbnail_url, download_url, preview_url, created_at')
    .eq('project_id', projectId)
    .order('score', { ascending: false });

  if (clipsError) throw clipsError;
  return { project, clips: clips || [] };
}

function submissionEmailHtml(project) {
  const rows = [
    ['Name', project.intake_data.name || 'Not provided'],
    ['Email', project.user_email],
    ['Phone', project.phone || 'Not provided'],
    ['Title', project.title],
    ['Footage URL', project.footage_url || 'Not provided'],
    ['Goal', project.intake_data.goal || 'Not provided'],
    ['Style', project.intake_data.style || 'Not provided'],
    ['Notes', project.intake_data.notes || 'Not provided']
  ];

  const rowHtml = rows
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`)
    .join('');

  return `
    <div style="font-family: Inter, Arial, sans-serif; color: #0f172a;">
      <h1 style="margin: 0 0 16px;">New KlipitGood submission</h1>
      ${rowHtml}
      <hr />
      <p><strong>Brief:</strong></p>
      <p style="white-space: pre-wrap;">${escapeHtml(project.prompt)}</p>
      <p style="color: #64748b;">Project ID: ${project.id}</p>
    </div>
  `;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    supabaseConfigured: Boolean(supabase),
    resendConfigured: Boolean(resend),
    adminConfigured: Boolean(adminPassword),
    workerConfigured: Boolean(workerToken),
    workerEngineReady: engineReady(),
    workerAutoRun,
    engineRoot
  });
});

async function findOrCreateChatConversation({ anonymousSessionId, conversationId, detectedIntent, title }) {
  if (!supabase) return null;

  const sessionKey = cleanString(anonymousSessionId, 120) || `anon_${Date.now()}`;
  let session = null;

  try {
    const { data, error } = await supabase
      .from('anonymous_sessions')
      .upsert({ session_key: sessionKey, last_seen_at: new Date().toISOString() }, { onConflict: 'session_key' })
      .select('id, session_key')
      .single();
    if (!error) session = data;
  } catch (error) {
    console.warn('[klipitgood] anonymous session save failed:', error.message);
  }

  if (conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, request_type, status')
      .eq('id', conversationId)
      .maybeSingle();
    if (!error && data) return data;
  }

  const payload = {
    request_type: detectedIntent,
    status: 'active',
    title: cleanString(title, 120) || 'KlipItGood chat'
  };

  if (session?.id) payload.anonymous_session_id = session.id;

  const { data, error } = await supabase
    .from('conversations')
    .insert(payload)
    .select('id, title, request_type, status, created_at')
    .single();

  if (error) {
    console.warn('[klipitgood] conversation save failed:', error.message);
    return null;
  }

  return data;
}

async function saveChatMessages({ conversationId, userMessage, assistantMessage, detectedIntent }) {
  if (!supabase || !conversationId) return;

  const rows = [
    { conversation_id: conversationId, role: 'user', content: userMessage, detected_intent: detectedIntent },
    { conversation_id: conversationId, role: 'assistant', content: assistantMessage, detected_intent: detectedIntent }
  ];

  const { error } = await supabase.from('messages').insert(rows);
  if (error) console.warn('[klipitgood] message save failed:', error.message);
}

async function upsertLeadFromContact(contact = {}) {
  if (!supabase || !contact.email) return null;

  const payload = {
    name: cleanString(contact.name, 120) || 'KlipItGood lead',
    email: cleanString(contact.email, 254).toLowerCase(),
    phone: cleanString(contact.phone, 40) || null
  };

  const { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select('id, name, email, phone, created_at')
    .single();

  if (error) {
    console.warn('[klipitgood] lead save failed:', error.message);
    return null;
  }

  return data;
}

async function createChatServiceRequest({ leadId, conversationId, detectedIntent, messages, userMessage, actionFlags, contact }) {
  if (!supabase || !actionFlags.createServiceRequest) return null;

  const payload = {
    lead_id: leadId || null,
    request_type: detectedIntent,
    status: 'new',
    summary: summarizeTranscript(messages, 1800),
    source_url: null,
    subscription_intent: Boolean(actionFlags.showTrialPath),
    selected_plan: actionFlags.showTrialPath ? 'annual_unlimited' : null,
    metadata: {
      source: 'klipitgood_app',
      conversation_id: conversationId,
      latest_user_message: cleanString(userMessage, 1000),
      contact
    }
  };

  const { data, error } = await supabase
    .from('service_requests')
    .insert(payload)
    .select('id, lead_id, request_type, status, selected_plan, subscription_intent, metadata, created_at')
    .single();

  if (error) {
    console.warn('[klipitgood] service request save failed:', error.message);
    return null;
  }

  return data;
}

app.post('/api/klipitgood/chat', async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const userMessage = [...messages].reverse().find((message) => message?.role === 'user')?.content || '';
  const anonymousSessionId = cleanString(req.body.anonymousSessionId || req.body.sessionId, 120);
  const conversationId = cleanString(req.body.conversationId, 80);

  try {
    const reply = await buildKlipItGoodReply({
      messages,
      context: {
        currentTool: req.body.currentTool,
        currentContext: req.body.currentContext,
        contact: req.body.contact
      }
    });

    if (reply.warning === 'OPENAI_API_KEY is not configured.') {
      console.warn('[klipitgood] OPENAI_API_KEY is not configured; using static fallback response.');
    }

    const conversation = await findOrCreateChatConversation({
      anonymousSessionId,
      conversationId,
      detectedIntent: reply.detectedIntent,
      title: userMessage.slice(0, 72)
    });

    await saveChatMessages({
      conversationId: conversation?.id,
      userMessage,
      assistantMessage: reply.assistantMessage,
      detectedIntent: reply.detectedIntent
    });

    const lead = await upsertLeadFromContact(reply.contact);
    const serviceRequest = await createChatServiceRequest({
      leadId: lead?.id || null,
      conversationId: conversation?.id || null,
      detectedIntent: reply.detectedIntent,
      messages,
      userMessage,
      actionFlags: reply.actionFlags,
      contact: reply.contact
    });

    let priorNotificationKinds = [];
    if (supabase && conversation?.id) {
      const { data } = await supabase
        .from('notification_events')
        .select('event_type')
        .contains('payload', { sessionId: anonymousSessionId })
        .limit(5);
      priorNotificationKinds = (data || []).map((row) => row.event_type);
    }

    const notificationGate = shouldNotifyFounder({
      detectedIntent: reply.detectedIntent,
      actionFlags: reply.actionFlags,
      priorNotificationKinds
    });

    let notification = { sent: false, skipped: true, reason: notificationGate.reason || 'not_actionable' };
    if (notificationGate.notify) {
      notification = await notifyFounder({
        userMessage,
        detectedIntent: reply.detectedIntent,
        contact: reply.contact,
        transcriptSummary: summarizeTranscript(messages, 1800),
        portalLink: `${req.protocol}://${req.get('host')}/portal`,
        sessionId: anonymousSessionId || conversation?.id || '',
        timestamp: new Date().toISOString()
      }, { supabase });
    }

    res.json({
      assistantMessage: reply.assistantMessage,
      detectedIntent: reply.detectedIntent,
      actionFlags: reply.actionFlags,
      missingFields: reply.missingFields,
      notification,
      conversation,
      serviceRequest,
      lead,
      contact: reply.contact,
      aiProvider: reply.aiProvider,
      warning: reply.warning || null
    });
  } catch (error) {
    console.error('[klipitgood] chat error:', error);
    res.status(500).json({ error: 'KlipItGood could not respond right now.' });
  }
});

app.post('/api/uploads/footage', async (req, res) => {
  const contentType = req.header('content-type') || '';
  const originalName = cleanString(req.header('x-file-name'), 240) || 'footage.mp4';

  if (!contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    res.status(400).json({ error: 'Upload a video file.' });
    return;
  }

  const target = uploadedFootagePath(originalName);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, counter, createWriteStream(target));
    if (bytes === 0) {
      res.status(400).json({ error: 'Upload body was empty.' });
      return;
    }

    res.status(201).json({
      footageUrl: `file://${target}`,
      filename: path.basename(target),
      bytes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/submit', async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const submission = buildPortalSubmission(req.body, req.header('user-agent') || null);

  if (!isEmail(submission.lead.email)) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  if (!submission.lead.name) {
    res.status(400).json({ error: 'Name is required.' });
    return;
  }

  if (submission.messages.length === 0) {
    res.status(400).json({ error: 'Conversation messages are required.' });
    return;
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert(submission.lead)
    .select('id, name, email, phone, business_name, website, created_at')
    .single();

  if (leadError) {
    res.status(500).json({ error: leadError.message });
    return;
  }

  const { data: serviceRequest, error: requestError } = await supabase
    .from('service_requests')
    .insert({ ...submission.request, lead_id: lead.id })
    .select('id, lead_id, request_type, status, summary, source_url, subscription_intent, selected_plan, metadata, created_at')
    .single();

  if (requestError) {
    res.status(500).json({ error: requestError.message, leadId: lead.id });
    return;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .insert({
      ...submission.conversation,
      lead_id: lead.id,
      service_request_id: serviceRequest.id
    })
    .select('id, lead_id, service_request_id, request_type, status, title, created_at')
    .single();

  if (conversationError) {
    res.status(500).json({ error: conversationError.message, leadId: lead.id, requestId: serviceRequest.id });
    return;
  }

  const messageRows = submission.messages.map((message) => ({
    conversation_id: conversation.id,
    role: message.role,
    content: message.content
  }));
  const { error: messagesError } = await supabase.from('messages').insert(messageRows);

  if (messagesError) {
    res.status(500).json({
      error: messagesError.message,
      leadId: lead.id,
      requestId: serviceRequest.id,
      conversationId: conversation.id
    });
    return;
  }

  let queuedProject = null;
  if (serviceRequest.request_type === 'video_clipping') {
    // Attach user_id if the request came from a logged-in user
    const submittingUser = await getUserFromRequest(req);

    const projectPayload = {
      user_email: lead.email,
      user_id: submittingUser?.id || null,
      title: cleanString(submission.answers.clipGoal, 120) || 'KlipItGood free clips request',
      status: 'queued',
      footage_url: cleanString(submission.answers.footageAccess, 1000) || null,
      prompt: [
        cleanString(submission.answers.footageType, 1000),
        cleanString(submission.answers.clipGoal, 1000),
        cleanString(submission.answers.ongoingNeed, 1000)
      ].filter(Boolean).join('\n\n') || 'KlipItGood clipping request',
      phone: lead.phone,
      intake_data: {
        name: lead.name,
        request_type: 'video_clipping',
        service_request_id: serviceRequest.id,
        conversation_id: conversation.id,
        footage_type: submission.answers.footageType || null,
        clip_goal: submission.answers.clipGoal || null,
        ongoing_need: submission.answers.ongoingNeed || null,
        free_clips_offered: true,
        source: 'klipitgood'
      },
      brand_assets: {}
    };

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert(projectPayload)
      .select('id, title, status, footage_url, created_at')
      .single();

    if (projectError) {
      res.status(500).json({ error: projectError.message, leadId: lead.id, requestId: serviceRequest.id, conversationId: conversation.id });
      return;
    }

    queuedProject = project || null;
  }

  const processing = queuedProject ? launchWorkerForProject(queuedProject.id) : { started: false };

  let notification = { sent: false };
  if (resend) {
    try {
      const email = await resend.emails.send({
        from: resendFrom,
        to: [adminEmail],
        subject: `New KlipItGood request: ${serviceRequest.request_type}`,
        html: portalSubmissionEmailHtml({
          lead,
          request: serviceRequest,
          answers: submission.answers
        }),
        replyTo: lead.email
      });
      notification = { sent: true, id: email.data?.id || null };
    } catch (error) {
      notification = { sent: false, error: error.message };
    }
  }

  res.status(201).json({
    lead,
    serviceRequest,
    conversation,
    queuedProject,
    processing,
    notification
  });
});

app.post('/api/portal/checkout', async (req, res) => {
  const planId = cleanString(req.body.planId, 80);
  const lead = req.body.lead && typeof req.body.lead === 'object' ? req.body.lead : {};
  const request = req.body.serviceRequest && typeof req.body.serviceRequest === 'object' ? req.body.serviceRequest : {};

  const checkout = await createCheckoutLink({ planId, lead, request });

  if (supabase && request.id) {
    await supabase
      .from('service_requests')
      .update({
        selected_plan: checkout.plan.id,
        subscription_intent: true,
        metadata: {
          ...(request.metadata || {}),
          selected_plan_name: checkout.plan.name,
          selected_plan_price: checkout.plan.priceLabel,
          checkout_provider: checkout.provider,
          checkout_url: checkout.url,
          checkout_todo: checkout.todo,
          source: 'klipitgood'
        }
      })
      .eq('id', request.id);
  }

  res.json({ checkout });
});

app.get('/api/operator/overview', requireAdmin, async (_req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const [leadsResult, requestsResult, conversationsResult, projectsResult] = await Promise.all([
    supabase.from('leads').select('id, name, email, phone, business_name, website, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('service_requests').select('id, lead_id, request_type, status, selected_plan, subscription_intent, source_url, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('conversations').select('id, lead_id, service_request_id, request_type, status, title, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('projects').select('id, user_email, title, status, footage_url, phone, created_at').order('created_at', { ascending: false }).limit(50)
  ]);

  const firstError = [leadsResult, requestsResult, conversationsResult, projectsResult].find((result) => result.error)?.error;
  if (firstError) {
    res.status(500).json({ error: firstError.message });
    return;
  }

  res.json({
    leads: leadsResult.data,
    serviceRequests: requestsResult.data,
    conversations: conversationsResult.data,
    queuedProjects: projectsResult.data,
    plans: ['annual_unlimited', 'unlimited_monthly', 'per_clip'].map((id) => getPlan(id))
  });
});

app.post('/api/projects', async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const name = cleanString(req.body.name, 120);
  const userEmail = cleanString(req.body.email, 254).toLowerCase();
  const phone = cleanString(req.body.phone, 40);
  const title = cleanString(req.body.title, 120) || 'KlipitGood submission';
  const footageUrl = cleanString(req.body.footageUrl, 1000);
  const prompt = cleanString(req.body.prompt, 4000);
  const contentType = cleanString(req.body.contentType, 80);
  const goal = cleanString(req.body.goal, 80);
  const style = cleanString(req.body.style, 80);
  const notes = cleanString(req.body.notes, 2000);

  if (!isEmail(userEmail)) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  if (prompt.length < 20) {
    res.status(400).json({ error: 'Add at least a short project brief before submitting.' });
    return;
  }

  const payload = {
    user_email: userEmail,
    title,
    status: 'new',
    footage_url: footageUrl || null,
    prompt,
    phone: phone || null,
    intake_data: {
      name,
      content_type: contentType,
      goal,
      style,
      notes,
      submitted_from: 'klipitgood_mvp',
      user_agent: req.header('user-agent') || null
    },
    brand_assets: {}
  };

  const { data, error } = await supabase
    .from('projects')
    .insert(payload)
    .select('id, user_email, title, status, footage_url, prompt, phone, intake_data, created_at')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  let notification = { sent: false };
  if (resend) {
    try {
      const email = await resend.emails.send({
        from: resendFrom,
        to: [adminEmail],
        subject: `New KlipitGood submission: ${data.title}`,
        html: submissionEmailHtml(data),
        replyTo: data.user_email
      });
      notification = { sent: true, id: email.data?.id || null };
    } catch (error) {
      notification = { sent: false, error: error.message };
    }
  }

  res.status(201).json({ project: data, notification });
});

app.get('/api/projects', requireAdmin, async (_req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const { data, error } = await supabase
    .from('projects')
    .select('id, user_email, title, status, footage_url, prompt, intake_data, phone, admin_message, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ projects: data });
});

app.get('/api/projects/:id/status', async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  try {
    const projectId = cleanString(req.params.id, 80);
    const payload = await loadProjectWithClips(projectId);
    res.json({
      ...payload,
      processing: runningWorkers.get(projectId) || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/process', requireAdmin, async (req, res) => {
  const projectId = cleanString(req.params.id, 80);
  const result = launchWorkerForProject(projectId);
  res.status(result.started ? 202 : 409).json({ processing: result });
});

app.patch('/api/projects/:id/admin-message', requireAdmin, async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const content = cleanString(req.body.content, 4000);
  const projectId = cleanString(req.params.id, 80);

  const { data, error } = await supabase
    .from('projects')
    .update({ admin_message: content || null })
    .eq('id', projectId)
    .select('id, admin_message')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (content) {
    await supabase.from('messages').insert({
      project_id: projectId,
      role: 'admin',
      content
    });
  }

  res.json({ project: data });
});

app.post('/api/worker/project/claim', requireWorker, async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const projectId = cleanString(req.body?.project_id, 80);

  const query = supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(projectId ? 1 : 25);

  const { data, error } = projectId
    ? await query.eq('id', projectId)
    : await query.in('status', ['new', 'queued', 'submitted']).not('footage_url', 'is', null);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ project: selectNextQueuedProject(data || [], projectId) });
});

app.post('/api/worker/project/update', requireWorker, async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const projectId = cleanString(req.body?.project_id, 80);
  const { data: project, error: loadError } = await supabase
    .from('projects')
    .select('id, intake_data')
    .eq('id', projectId)
    .single();

  if (loadError) {
    res.status(500).json({ error: loadError.message });
    return;
  }

  const update = buildWorkerProjectUpdate(project, req.body?.patch, req.body?.worker_patch);
  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('id', projectId)
    .select('id, status, admin_message, intake_data')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ project: data });
});

app.post('/api/worker/project/complete', requireWorker, async (req, res) => {
  if (!requireConfig(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return;
  if (!supabase) return;

  const projectId = cleanString(req.body?.project_id, 80);
  const { data: project, error: loadError } = await supabase
    .from('projects')
    .select('id, intake_data')
    .eq('id', projectId)
    .single();

  if (loadError) {
    res.status(500).json({ error: loadError.message });
    return;
  }

  let rows = [];
  try {
    rows = normalizeClipRows(projectId, Array.isArray(req.body?.clips) ? req.body.clips : []);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (!rows.length) {
    res.status(400).json({ error: 'No clips were provided.' });
    return;
  }

  const { error: deleteError } = await supabase.from('clips').delete().eq('project_id', projectId);
  if (deleteError) {
    res.status(500).json({ error: deleteError.message });
    return;
  }

  const { data: clips, error: clipsError } = await supabase
    .from('clips')
    .insert(rows)
    .select('id, project_id, title, score, description, duration_seconds, thumbnail_url, download_url, preview_url, created_at');

  if (clipsError) {
    res.status(500).json({ error: clipsError.message });
    return;
  }

  const update = buildWorkerProjectUpdate(
    project,
    {
      status: 'completed',
      admin_message: cleanString(req.body?.admin_message, 1000) || `Your clips are ready. I found ${rows.length} strong clips.`
    },
    req.body?.worker_patch
  );

  const { data: updatedProject, error: projectError } = await supabase
    .from('projects')
    .update(update)
    .eq('id', projectId)
    .select('id, status, admin_message, intake_data')
    .single();

  if (projectError) {
    res.status(500).json({ error: projectError.message, clips });
    return;
  }

  res.json({ project: updatedProject, clips });
});

if (isProduction) {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`KlipitGood API listening on http://127.0.0.1:${port}`);
});
