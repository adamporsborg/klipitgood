# KlipItGood — Launch Checklist

Everything below is the only thing standing between you and a live, working product.
Code is done. Pipeline is done. This is all config.

---

## 1. Get your real Supabase anon key

Go to: **supabase.com → your project → Settings → API**

You need the **anon / public** key. It starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

The key in `.env` right now (`sb_publishable_...`) is the wrong format — auth will not work with it.

---

## 2. Apply the database schema

Go to: **Supabase → SQL Editor → New query**

Paste the entire contents of `supabase/schema.sql` and run it.

This creates: `projects`, `clips`, `downloads`, `edit_jobs`, `clip_feedback`, `worker_events`, `render_runs`, and all RLS policies.

---

## 3. Add GitHub Secrets

Go to: **github.com/adamporsborg/klipitgood → Settings → Secrets → Actions**

Add these:

| Secret | Where to get it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** key |
| `RESEND_API_KEY` | resend.com → API Keys |
| `KLIPITGOOD_WORKER_SECRET` | Make up any long random string — use same value below |

---

## 4. Set up the Supabase webhook (triggers GitHub Actions)

Go to: **Supabase → Database → Webhooks → Create webhook**

| Field | Value |
|---|---|
| Name | `trigger_github_actions` |
| Table | `projects` |
| Events | INSERT only |
| Type | HTTP Request |
| Method | POST |
| URL | `https://api.github.com/repos/adamporsborg/klipitgood/dispatches` |

**Headers:**
```
Authorization: Bearer <GitHub Personal Access Token with `repo` scope>
Accept: application/vnd.github.v3+json
Content-Type: application/json
```

**Body:**
```json
{"event_type":"clip_job_queued","client_payload":{"project_id":"{{ NEW_RECORD.id }}"}}
```

To get the GitHub token: github.com/settings/tokens/new → check **repo** → Generate.

---

## 5. Deploy the server to Render

1. Go to **render.com** → New → Web Service
2. Connect your GitHub repo: `adamporsborg/klipitgood`
3. Render will auto-detect `render.yaml` and fill in the settings
4. Fill in the environment variables it marks as `sync: false`:
   - `VITE_SUPABASE_URL` → `https://ioailfmpuycojlgdpdfk.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` → the real JWT from step 1
   - `SUPABASE_SERVICE_ROLE_KEY` → from Supabase
   - `ANTHROPIC_API_KEY` → already in your `.env`
   - `GROQ_API_KEY` → already in your `.env`
   - `RESEND_API_KEY` → from Resend
   - `ADMIN_EMAIL` → adamporsborg@gmail.com
   - `KLIPITGOOD_WORKER_SECRET` → same random string from step 3
5. Deploy. You'll get a URL like `https://klipitgood.onrender.com`

---

## 6. Connect your domain

Point **klipitgood.com** (or whatever domain you want) to the Render URL.
Render → your service → Settings → Custom Domain.

---

## 7. Test end-to-end

1. Go to your live URL → `/auth` → create an account
2. Paste a YouTube URL into the chat
3. Give direction when asked
4. Go to github.com/adamporsborg/klipitgood/actions — you should see a job fire
5. When it finishes, clips appear in the right panel

---

## What's already done (nothing left to build)

- ✅ Auth (sign up, sign in, magic link)
- ✅ Chat interface — paste a link, give direction, clips appear
- ✅ Brand kit — logo, colors, caption style, reference clip
- ✅ Pipeline — Groq transcription → Claude clip selection → ffmpeg render
- ✅ No-jump-cuts enforcement
- ✅ User directive injection into Claude prompt
- ✅ Real-time clip delivery via Supabase realtime
- ✅ Worker security (KLIPITGOOD_WORKER_SECRET, 401 on unsigned callbacks)
- ✅ Public API: /api/public/brief, /api/public/create-project, /api/public/edit-plan
- ✅ Schema: edit_jobs, clip_feedback, worker_events, render_runs
- ✅ GitHub Actions workflow with correct args

---

## Pricing (already in the UI)

- **$1/clip** — low-friction trial
- **$29.99/mo** — unlimited monthly  
- **$199/yr founding** — lock in forever

Stripe is optional for launch. The pricing UI shows, collect intent, close manually until you're ready to wire Stripe.
