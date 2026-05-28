import { useEffect, useMemo, useRef, useState } from 'react';

const FLOW_COPY = {
  video_clipping: {
    label: 'Get my videos clipped',
    icon: '🎬',
    toolName: 'KlipItGood',
    intro: 'Great choice. KlipItGood is the video clipping service inside UNSERGPT. I will ask for the footage, clip direction, and contact info.',
    confirmation: "We've got your request. Adam / the UNSER team will review this and follow up.",
    questions: [
      { key: 'footageType', prompt: 'What kind of footage do you have?' },
      { key: 'footageAccess', prompt: 'Where is the footage located? You can paste a YouTube, Drive, Dropbox, upload, or local file link.' },
      { key: 'clipGoal', prompt: 'What kind of clips do you want?' },
      { key: 'ongoingNeed', prompt: 'Is this a one-time test, or do you have ongoing clipping needs like podcasts, weekly videos, social growth, or agency/client work?' },
      { key: 'name', prompt: 'What is your name?', contact: 'name' },
      { key: 'email', prompt: 'What email should we use?', contact: 'email' },
      { key: 'phone', prompt: 'What phone number should we use?', contact: 'phone' }
    ]
  },
  strategy: {
    label: 'Marketing & content strategy',
    icon: '📣',
    toolName: 'Strategy Desk',
    intro: 'Good. I will capture the business context, growth problem, and contact details.',
    confirmation: 'We have the strategy inquiry. You can book a 15-20 minute call or leave a message for Adam.',
    questions: [
      { key: 'businessName', prompt: 'What is the business name?', contact: 'businessName' },
      { key: 'website', prompt: 'What website or social link should we review?', contact: 'website' },
      { key: 'growthGoal', prompt: 'What are you trying to sell or grow?' },
      { key: 'currentProblem', prompt: 'What is the biggest current problem?' },
      { key: 'name', prompt: 'What is your name?', contact: 'name' },
      { key: 'email', prompt: 'What email should we use?', contact: 'email' },
      { key: 'phone', prompt: 'What phone number should we use?', contact: 'phone' }
    ]
  },
  diagnostic: {
    label: "Not sure yet - let's talk",
    icon: '🤔',
    toolName: 'Front Desk',
    intro: 'No problem. I will run a quick diagnostic and route the request.',
    confirmation: 'Got it. Adam / the UNSER team will review this and point you toward the right next step.',
    questions: [
      { key: 'accomplish', prompt: 'What are you trying to accomplish?' },
      { key: 'brokenSlow', prompt: 'What feels broken or slow in your business right now?' },
      { key: 'helpType', prompt: 'Do you need content, leads, automation, or operations help?' },
      { key: 'name', prompt: 'What is your name?', contact: 'name' },
      { key: 'email', prompt: 'What email should we use?', contact: 'email' },
      { key: 'phone', prompt: 'What phone number should we use?', contact: 'phone' }
    ]
  }
};

const STARTERS = Object.entries(FLOW_COPY).map(([id, flow]) => ({ id, label: flow.label, icon: flow.icon }));

const TOOLS = ['KlipItGood clipping', 'Logo cleanup', 'Strategy brief', 'AI workflow audit', 'Book a call'];

const SEED_CONVERSATIONS = [
  { title: 'New intake', meta: 'UNSERGPT ready', icon: '💬' },
  { title: 'Command center', meta: 'Progress', icon: '📊' },
  { title: 'KlipItGood clipping', meta: 'Lead capture', icon: '🎬' },
  { title: 'Strategy inquiry', meta: 'Discovery', icon: '📣' }
];

const OPS_METRICS = [
  { label: 'Active requests', value: '12', detail: '4 need review' },
  { label: 'Avg. response path', value: '18m', detail: 'intake to next step' },
  { label: 'Tools ready', value: '5', detail: 'KlipItGood first' },
  { label: 'Sellable package', value: '$499+', detail: 'monthly front desk' }
];

const PROJECTS = [
  {
    name: 'Ward 6 content sprint',
    status: 'Review',
    progress: 68,
    owner: 'UNSER + Adam',
    next: 'Approve selects and package final reels'
  },
  {
    name: 'UNSERGPT front desk',
    status: 'Build',
    progress: 62,
    owner: 'UnserGPT',
    next: 'Connect live database, email, and handoff routing'
  },
  {
    name: 'Strategy lead capture',
    status: 'Ready',
    progress: 86,
    owner: 'Portal',
    next: 'Route new inquiries into call/message path'
  }
];

const TOOL_STACK = [
  { name: 'KlipItGood video clipping', state: 'Live intake', description: 'Collect source links, desired clip style, and contact details.' },
  { name: 'Logo cleanup', state: 'Queued', description: 'Accept rough logos and return polished transparent asset packages.' },
  { name: 'Strategy brief', state: 'Ready next', description: 'Turn business notes into positioning, content angles, and action steps.' },
  { name: 'AI workflow audit', state: 'Planned', description: 'Map repetitive work and recommend automation targets.' },
  { name: 'Book a call', state: 'Simple link', description: 'Route qualified leads into a 15-20 minute follow-up.' }
];

const SETUP_CHECKS = [
  { label: 'Supabase project URL', status: 'connected', detail: 'Provided for ioailfmpuycojlgdpdfk' },
  { label: 'Supabase publishable key', status: 'connected', detail: 'Safe frontend key received' },
  { label: 'Database schema', status: 'needs-action', detail: 'Run supabase/schema.sql or provide DB password/service role' },
  { label: 'Resend email', status: 'needs-action', detail: 'Needs RESEND_API_KEY and verified sender' },
  { label: 'Lovable deployment path', status: 'pending', detail: 'Import current code or rebuild from prompt' }
];

const BUILD_STAGES = [
  'Capture the request',
  'Classify service type',
  'Create lead and project record',
  'Notify Adam / UNSER',
  'Assign tools or manual help',
  'Review deliverables',
  'Ship and follow up'
];

const PRICING_TIERS = [
  {
    name: 'UNSERGPT Front Desk',
    price: 'Configured per client',
    fit: 'Small businesses that need a smart intake and lead-routing assistant.',
    includes: 'Branded chat portal, lead capture, email alerts, service routing, basic dashboard.'
  },
  {
    name: 'UNSERGPT Operator',
    price: 'Configured per client',
    fit: 'Companies that want UNSER to help run the workflows, not just install software.',
    includes: 'Everything in Front Desk plus monthly strategy, content requests, review queue, and human follow-up.'
  },
  {
    name: 'UNSERGPT Custom OS',
    price: 'Scoped after intake',
    fit: 'Teams that need custom tools, automations, CRM handoffs, or internal operating dashboards.',
    includes: 'Custom intake flows, tool integrations, deployment support, and buildout roadmap.'
  }
];

const KLIPITGOOD_PLANS = [
  {
    id: 'starter',
    name: 'KlipItGood Starter',
    price: 'Pricing configured in Stripe',
    summary: 'Monthly clip allowance, captions, social-ready exports, and portal access.'
  },
  {
    id: 'growth',
    name: 'KlipItGood Growth',
    price: 'Pricing configured in Stripe',
    summary: 'More clips, priority processing, graphics, and enhanced support.'
  },
  {
    id: 'operator',
    name: 'UNSER Operator',
    price: 'Scoped with UNSER',
    summary: 'Done-for-you workflows, content systems, strategy, operations, and advanced AI assistance.'
  }
];

function classifyIntent(text) {
  const value = text.toLowerCase();
  if (/(clip|clips|video|podcast|reel|tiktok|short|youtube|footage|edit)/.test(value)) return 'video_clipping';
  if (/(marketing|strategy|lead|sales|grow|content|campaign|brand|social|workflow|automation)/.test(value)) return 'strategy';
  return 'diagnostic';
}

function hasOngoingNeed(text) {
  return /(ongoing|weekly|monthly|podcast|every|multiple|scale|scaling|agency|clients|business|founder|social|growth|unlimited)/i.test(text);
}

const initialMessages = [
  {
    role: 'assistant',
    content: "Hey, I'm UNSERGPT, the AI front desk for UNSER Media. What are you trying to get done today?",
    quickStarts: true
  }
];

function emptyContact() {
  return { name: '', email: '', phone: '', businessName: '', website: '' };
}

function normalizeMessage(role, content, extra = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    ...extra
  };
}

function newChatRecord(title = 'New chat') {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    messages: initialMessages,
    conversationId: null,
    archived: false,
    createdAt: new Date().toISOString()
  };
}

function getAnonymousSessionId() {
  const existing = window.localStorage.getItem('unsergpt_session_id');
  if (existing) return existing;
  const next = `anon_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem('unsergpt_session_id', next);
  return next;
}

function PortalPage() {
  const [anonymousSessionId] = useState(getAnonymousSessionId);
  const [chats, setChats] = useState(() => [newChatRecord()]);
  const [activeChatId, setActiveChatId] = useState(() => chats[0]?.id);
  const [flowId, setFlowId] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [contact, setContact] = useState(emptyContact);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [uploadStatus, setUploadStatus] = useState({ type: 'idle', message: '' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savedSubmission, setSavedSubmission] = useState(null);
  const [projectResult, setProjectResult] = useState(null);
  const scroller = useRef(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) || chats[0];
  const messages = activeChat?.messages || initialMessages;

  function setMessages(updater) {
    setChats((current) => current.map((chat) => {
      if (chat.id !== activeChatId) return chat;
      const nextMessages = typeof updater === 'function' ? updater(chat.messages) : updater;
      return { ...chat, messages: nextMessages };
    }));
  }

  const activeFlow = flowId ? FLOW_COPY[flowId] : null;
  const currentQuestion = activeFlow?.questions[stepIndex] || null;
  const canSend = input.trim().length > 0 && status.type !== 'submitting';

  const conversationTitle = activeChat?.title || activeFlow?.label || 'New chat';

  useEffect(() => {
    document.title = 'UNSER Media Portal';
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  function startFlow(nextFlowId) {
    const flow = FLOW_COPY[nextFlowId];
    setInput(`I need help with ${flow.label.toLowerCase()}.`);
  }

  function resetChat() {
    const chat = newChatRecord();
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setFlowId(null);
    setStepIndex(0);
    setAnswers({});
    setContact(emptyContact());
    setInput('');
    setStatus({ type: 'idle', message: '' });
    setUploadStatus({ type: 'idle', message: '' });
    setSavedSubmission(null);
    setProjectResult(null);
    setSidebarOpen(false);
  }

  function renameChat(chatId) {
    const current = chats.find((chat) => chat.id === chatId);
    const title = window.prompt('Rename chat', current?.title || 'UNSERGPT chat');
    if (!title?.trim()) return;
    setChats((items) => items.map((chat) => (
      chat.id === chatId ? { ...chat, title: title.trim().slice(0, 80) } : chat
    )));
  }

  function deleteChat(chatId) {
    setChats((items) => {
      const next = items.filter((chat) => chat.id !== chatId);
      if (activeChatId === chatId) {
        const replacement = next[0] || newChatRecord();
        setActiveChatId(replacement.id);
        return next.length ? next : [replacement];
      }
      return next;
    });
  }

  function archiveChat(chatId) {
    setChats((items) => {
      const next = items.map((chat) => (
        chat.id === chatId ? { ...chat, archived: true } : chat
      ));
      if (activeChatId === chatId) {
        const replacement = next.find((chat) => !chat.archived) || newChatRecord();
        setActiveChatId(replacement.id);
        return next.some((chat) => !chat.archived) ? next : [replacement, ...next];
      }
      return next;
    });
  }

  useEffect(() => {
    const projectId = savedSubmission?.queuedProject?.id;
    if (!projectId) return undefined;

    let cancelled = false;
    async function loadProjectStatus() {
      try {
        const response = await fetch(`/api/projects/${projectId}/status`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load project status.');
        if (!cancelled) setProjectResult(result);
      } catch (error) {
        if (!cancelled) setProjectResult({ error: error.message });
      }
    }

    loadProjectStatus();
    const timer = window.setInterval(loadProjectStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [savedSubmission?.queuedProject?.id]);

  async function submitPortal(nextAnswers, nextContact, finalMessages) {
    setStatus({ type: 'submitting', message: 'Saving your request...' });

    const response = await fetch('/api/portal/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: flowId,
        answers: nextAnswers,
        contact: nextContact,
        subscriptionIntent: flowId === 'video_clipping' && hasOngoingNeed(nextAnswers.ongoingNeed || ''),
        messages: finalMessages.map(({ role, content }) => ({ role, content }))
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save this request.');

    const emailNote = result.notification?.sent
      ? ''
      : '\n\nThe request was saved, but the notification email did not send. Adam can still review it in Supabase.';

    setStatus({
      type: result.notification?.sent ? 'success' : 'warning',
      message: result.notification?.sent ? 'Saved and notified.' : 'Saved. Email notification needs attention.'
    });
    setSavedSubmission(result);
    if (result.queuedProject) {
      setProjectResult({ project: result.queuedProject, clips: [] });
    }

    const freeClipOffer = flowId === 'video_clipping'
      ? `\n\nYour clipping project is queued${result.processing?.started ? ' and the local clipping worker has been started.' : '.'} Clips will appear here when processing finishes. If you already know this will be ongoing, I can also set up a KlipItGood subscription path.`
      : '';
    setMessages((current) => [
      ...current,
      normalizeMessage('assistant', `${activeFlow.confirmation}${freeClipOffer}${emailNote}`, {
        actions: flowId === 'strategy',
        plans: flowId === 'video_clipping'
      })
    ]);
  }

  async function choosePlan(planId) {
    if (!savedSubmission) {
      setMessages((current) => [
        ...current,
        normalizeMessage('assistant', 'I can set that up after I save the intake. Send the footage and contact details first, then I can attach the plan to the request.')
      ]);
      return;
    }

    setStatus({ type: 'submitting', message: 'Preparing the subscription path...' });
    try {
      const response = await fetch('/api/portal/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          lead: savedSubmission.lead,
          serviceRequest: savedSubmission.serviceRequest
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not prepare checkout.');
      setStatus({ type: 'success', message: result.checkout.provider === 'stripe' ? 'Checkout prepared.' : 'Plan intent saved.' });
      setMessages((current) => [
        ...current,
        normalizeMessage('user', `I want ${result.checkout.plan.name}.`),
        normalizeMessage(
          'assistant',
          result.checkout.provider === 'stripe'
            ? `Good. I prepared the ${result.checkout.plan.name} checkout path and attached it to your request.`
            : `Good. I saved ${result.checkout.plan.name} on your request. Stripe is not live in this workspace yet, so this uses a safe placeholder link for Adam to finish the subscription setup.`,
          { checkout: result.checkout }
        )
      ]);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    }
  }

  async function uploadFootage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus({ type: 'submitting', message: 'Uploading footage...' });
    try {
      const response = await fetch('/api/uploads/footage', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name
        },
        body: file
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not upload footage.');
      setInput(result.footageUrl);
      setUploadStatus({ type: 'success', message: 'Upload ready. Send this footage path to queue the project.' });
    } catch (error) {
      setUploadStatus({ type: 'error', message: error.message });
    } finally {
      event.target.value = '';
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!canSend) return;

    const value = input.trim();
    const userMessage = normalizeMessage('user', value);
    const nextMessages = [...messages, userMessage];

    setInput('');
    setMessages(nextMessages);
    setStatus({ type: 'submitting', message: 'UNSERGPT is thinking...' });

    try {
      const response = await fetch('/api/unsergpt/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          conversationId: activeChat?.conversationId,
          anonymousSessionId,
          currentTool: activeFlow?.toolName || 'UNSERGPT portal',
          contact
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'UNSERGPT could not respond.');

      setContact((current) => ({ ...current, ...(result.lead || {}), ...(result.contact || {}) }));
      if (result.serviceRequest || result.lead) {
        setSavedSubmission({
          lead: result.lead,
          serviceRequest: result.serviceRequest,
          conversation: result.conversation,
          notification: result.notification
        });
      }
      setChats((current) => current.map((chat) => {
        if (chat.id !== activeChatId) return chat;
        const title = chat.title === 'New chat' && value.length
          ? value.slice(0, 42)
          : chat.title;
        return { ...chat, title, conversationId: result.conversation?.id || chat.conversationId };
      }));
      setMessages((current) => [
        ...current,
        normalizeMessage('assistant', result.assistantMessage, {
          loginGate: result.actionFlags?.requiresLogin,
          plans: result.actionFlags?.showTrialPath,
          detectedIntent: result.detectedIntent
        })
      ]);
      setStatus({
        type: result.notification?.sent || result.notification?.saved ? 'success' : 'idle',
        message: result.notification?.sent ? 'Adam / UNSER has been notified.' : ''
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      setMessages((current) => [
        ...current,
        normalizeMessage('assistant', 'I could not get that through cleanly. Send that one more time, or include your email and Adam can follow up.')
      ]);
    }
  }

  return (
    <div className="portal-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-block">
          <span className="brand-mark unser-logo">U</span>
          <div>
            <strong>UNSERGPT</strong>
            <span>by UNSER Media</span>
          </div>
        </div>

        <button className="new-chat" type="button" onClick={resetChat}>+ New Chat</button>
        <a className="command-link" href="/dashboard">Open Command Center</a>

        <nav className="conversation-list" aria-label="Conversations and projects">
          {chats.filter((chat) => !chat.archived).map((chat) => (
            <div className="conversation-row" key={chat.id}>
              <button className={chat.id === activeChatId ? 'active' : ''} type="button" onClick={() => setActiveChatId(chat.id)}>
                <span>💬 {chat.title}</span>
                <small>{chat.conversationId ? 'Saved' : 'Local chat'}</small>
              </button>
              <div className="conversation-actions">
                <button type="button" onClick={() => renameChat(chat.id)} aria-label="Rename chat">Rename</button>
                <button type="button" onClick={() => archiveChat(chat.id)} aria-label="Archive chat">Archive</button>
                <button type="button" onClick={() => deleteChat(chat.id)} aria-label="Delete chat">Delete</button>
              </div>
            </div>
          ))}
        </nav>

        <div className="tools-menu">
          <p>Tools</p>
          {TOOLS.map((tool) => (
            <button type="button" key={tool}>{tool}</button>
          ))}
        </div>
      </aside>

      <main className="chat-main">
        <header className="topbar">
          <button className="menu-button" type="button" onClick={() => setSidebarOpen((open) => !open)}>
            <span />
            <span />
            <span />
          </button>
          <div>
            <strong>UnserGPT</strong>
            <span>{activeFlow?.toolName || conversationTitle}</span>
          </div>
          <a href="/admin">Admin</a>
        </header>

        <section className="chat-panel" ref={scroller} aria-live="polite">
          <div className="chat-inner">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id || message.content}>
                <div className="avatar">{message.role === 'user' ? 'You' : 'U'}</div>
                <div className="bubble">
                  <p>{message.content}</p>
                  {message.quickStarts && (
                    <div className="quick-starts">
                      {STARTERS.map((starter) => (
                        <button type="button" key={starter.id} onClick={() => startFlow(starter.id)}>
                          <span>{starter.icon}</span> {starter.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {message.actions && (
                    <div className="quick-starts">
                      <a href="mailto:adamporsborg@gmail.com?subject=UNSER%20Media%20strategy%20call">Book a 15-20 minute call</a>
                      <button type="button" onClick={() => setInput('I would rather leave a message: ')}>
                        Leave a message
                      </button>
                    </div>
                  )}
                  {message.plans && (
                    <div className="plan-actions">
                      <p>Ongoing clipping options</p>
                      {KLIPITGOOD_PLANS.map((plan) => (
                        <button type="button" key={plan.id} onClick={() => choosePlan(plan.id)}>
                          <strong>{plan.name}</strong>
                          <span>{plan.price}</span>
                          <small>{plan.summary}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {message.checkout && (
                    <div className="checkout-card">
                      <strong>{message.checkout.plan.name}</strong>
                      <span>{message.checkout.plan.priceLabel}</span>
                      {message.checkout.url && <a href={message.checkout.url}>Open setup link</a>}
                    </div>
                  )}
                  {message.loginGate && (
                    <div className="quick-starts">
                      <a href="/portal?auth=signup">Create account</a>
                      <a href="/portal?auth=login">Log in</a>
                      <button type="button" onClick={() => setInput('I want to keep chatting before I create an account.')}>
                        Keep chatting
                      </button>
                    </div>
                  )}
                  {message.plans && projectResult?.project && (
                    <ProjectResultPanel result={projectResult} />
                  )}
                </div>
              </article>
            ))}
            {status.message && status.type !== 'idle' && (
              <p className={`portal-status ${status.type}`}>{status.message}</p>
            )}
            {uploadStatus.message && uploadStatus.type !== 'idle' && (
              <p className={`portal-status ${uploadStatus.type}`}>{uploadStatus.message}</p>
            )}
          </div>
        </section>

        <form className="composer" onSubmit={sendMessage}>
          {currentQuestion?.key === 'footageAccess' && (
            <label className="upload-chip">
              Upload video
              <input type="file" accept="video/*" onChange={uploadFootage} disabled={status.type === 'submitting' || uploadStatus.type === 'submitting'} />
            </label>
          )}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={flowId ? 'Reply here...' : 'Tell UNSERGPT what you need...'}
            rows="1"
            disabled={status.type === 'submitting'}
          />
          <button type="submit" disabled={!canSend}>Send</button>
        </form>
      </main>
    </div>
  );
}

function ProjectResultPanel({ result }) {
  if (result.error) {
    return (
      <div className="project-result error">
        <strong>Project status unavailable</strong>
        <p>{result.error}</p>
      </div>
    );
  }

  const project = result.project;
  const clips = result.clips || [];

  return (
    <div className="project-result">
      <div className="project-result-head">
        <strong>{project.title}</strong>
        <span>{project.status}</span>
      </div>
      {project.admin_message && <p>{project.admin_message}</p>}
      {clips.length === 0 ? (
        <p>Clips are not ready yet. This panel will update while the worker runs.</p>
      ) : (
        <div className="clip-grid">
          {clips.map((clip) => (
            <article key={clip.id || clip.download_url}>
              <strong>{clip.title}</strong>
              <span>{clip.score ? `${Math.round(Number(clip.score))}/100` : 'Ready'}</span>
              {clip.description && <p>{clip.description}</p>}
              <div>
                {clip.preview_url && <a href={clip.preview_url} target="_blank" rel="noreferrer">Preview</a>}
                {clip.download_url && <a href={clip.download_url} download>Download</a>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  useEffect(() => {
    document.title = 'UNSER Command Center';
  }, []);

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-rail">
        <div className="brand-block">
          <span className="brand-mark">U</span>
          <div>
            <strong>UNSERGPT</strong>
            <span>Client operating system</span>
          </div>
        </div>
        <nav>
          <a className="active" href="/dashboard">Command</a>
          <a href="/portal">Portal</a>
          <a href="/admin">Admin</a>
        </nav>
      </aside>

      <main className="dashboard-main">
        <section className="dashboard-hero">
          <div>
            <p>Founder view</p>
            <h1>The AI front desk that captures work, routes tools, and shows what is moving next.</h1>
          </div>
          <a href="/portal">Start intake</a>
        </section>

        <section className="metric-grid" aria-label="Operating metrics">
          {OPS_METRICS.map((metric) => (
            <article key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <p>{metric.detail}</p>
            </article>
          ))}
        </section>

        <section className="ops-grid">
          <div className="ops-panel projects-panel">
            <div className="panel-head">
              <div>
                <span>Project management</span>
                <h2>Active work</h2>
              </div>
              <button type="button">Review queue</button>
            </div>
            <div className="project-board">
              {PROJECTS.map((project) => (
                <article className="work-card" key={project.name}>
                  <div>
                    <h3>{project.name}</h3>
                    <span>{project.status}</span>
                  </div>
                  <div className="progress-track">
                    <i style={{ width: `${project.progress}%` }} />
                  </div>
                  <p>{project.next}</p>
                  <small>{project.owner}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="ops-panel">
            <div className="panel-head">
              <div>
                <span>Deployment path</span>
                <h2>Setup status</h2>
              </div>
            </div>
            <div className="setup-list">
              {SETUP_CHECKS.map((check) => (
                <article key={check.label} className={check.status}>
                  <b>{check.label}</b>
                  <span>{check.status.replace('-', ' ')}</span>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="ops-grid lower">
          <div className="ops-panel">
            <div className="panel-head">
              <div>
                <span>Tool deployment</span>
                <h2>Extra help menu</h2>
              </div>
            </div>
            <div className="tool-stack">
              {TOOL_STACK.map((tool) => (
                <article key={tool.name}>
                  <div>
                    <h3>{tool.name}</h3>
                    <span>{tool.state}</span>
                  </div>
                  <p>{tool.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="ops-panel flow-panel">
            <div className="panel-head">
              <div>
                <span>How portal functions connect</span>
                <h2>Execution spine</h2>
              </div>
            </div>
            <ol>
              {BUILD_STAGES.map((stage) => (
                <li key={stage}>{stage}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ops-panel pricing-panel">
          <div className="panel-head">
            <div>
              <span>Commercial package</span>
              <h2>How I would price UNSERGPT</h2>
            </div>
          </div>
          <div className="pricing-grid">
            {PRICING_TIERS.map((tier) => (
              <article key={tier.name}>
                <div>
                  <h3>{tier.name}</h3>
                  <strong>{tier.price}</strong>
                </div>
                <p>{tier.fit}</p>
                <small>{tier.includes}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function AdminPage() {
  const [password, setPassword] = useState('');
  const [projects, setProjects] = useState([]);
  const [overview, setOverview] = useState(null);
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function loadProjects(event) {
    event?.preventDefault();
    setState({ status: 'loading', message: 'Loading submissions...' });

    try {
      const [projectsResponse, overviewResponse] = await Promise.all([
        fetch('/api/projects', {
          headers: { 'x-admin-password': password }
        }),
        fetch('/api/operator/overview', {
          headers: { 'x-admin-password': password }
        })
      ]);
      const response = projectsResponse;
      const overviewResult = await overviewResponse.json();
      if (!overviewResponse.ok) throw new Error(overviewResult.error || 'Could not load operator overview.');
      setOverview(overviewResult);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load projects.');
      setProjects(result.projects);
      setState({ status: 'success', message: `${overviewResult.leads.length} lead${overviewResult.leads.length === 1 ? '' : 's'} and ${overviewResult.serviceRequests.length} request${overviewResult.serviceRequests.length === 1 ? '' : 's'} loaded.` });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  }

  const projectRows = useMemo(() => projects, [projects]);

  return (
    <main className="admin-page">
      <section className="admin-head">
        <div>
          <span>Founder panel</span>
          <h1>Submissions</h1>
        </div>
        <a href="/portal">Back to portal</a>
      </section>

      <form className="admin-login" onSubmit={loadProjects}>
        <label>
          Admin password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="ADMIN_PASSWORD" />
        </label>
        <button type="submit">Load submissions</button>
      </form>

      {state.message && <p className={`portal-status ${state.status}`}>{state.message}</p>}

      {overview && (
        <section className="operator-summary">
          <article>
            <strong>{overview.leads.length}</strong>
            <span>new leads</span>
          </article>
          <article>
            <strong>{overview.serviceRequests.filter((request) => request.request_type === 'video_clipping').length}</strong>
            <span>free clip requests</span>
          </article>
          <article>
            <strong>{overview.serviceRequests.filter((request) => request.subscription_intent || request.selected_plan).length}</strong>
            <span>subscription intents</span>
          </article>
          <article>
            <strong>{overview.queuedProjects.filter((project) => project.status === 'queued').length}</strong>
            <span>queued projects</span>
          </article>
        </section>
      )}

      {overview && (
        <section className="project-list">
          {overview.serviceRequests.map((request) => (
            <article className="project-card" key={request.id}>
              <div>
                <h2>{request.request_type}</h2>
                <p>{request.source_url || 'No source URL'} {request.selected_plan ? `- ${request.selected_plan}` : ''}</p>
              </div>
              <span>{request.status}</span>
              <p>{request.subscription_intent ? 'Subscription intent captured.' : 'Lead/request captured.'}</p>
            </article>
          ))}
        </section>
      )}

      <section className="project-list">
        {projectRows.map((project) => (
          <article className="project-card" key={project.id}>
            <div>
              <h2>{project.title}</h2>
              <p>{project.user_email} {project.phone ? `- ${project.phone}` : ''}</p>
            </div>
            <span>{project.status}</span>
            <p>{project.prompt}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

export default function App() {
  const isAdmin = window.location.pathname.startsWith('/admin');
  const isDashboard = window.location.pathname.startsWith('/dashboard');
  if (isAdmin) return <AdminPage />;
  if (isDashboard) return <DashboardPage />;
  return <PortalPage />;
}
