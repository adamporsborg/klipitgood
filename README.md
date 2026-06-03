# KlipItGood

An AI-powered video clipping pipeline that automatically identifies, cuts, and delivers short-form clips from long-form footage — fully integrated with a conversational intake portal and serverless deployment via GitHub Actions.

Built by [Unser.Media](https://unser.media) to power the KlipItGood service.

---

## What it does

1. **User submits footage** through the KlipItGood chat portal (upload or URL)
2. **Supabase webhook fires** when the job is queued → triggers a GitHub Actions runner
3. **Groq Whisper API** transcribes the audio with word-level timestamps (free tier, no local model)
4. **Claude API (Anthropic)** analyzes the transcript and identifies the highest-scoring clip moments with rationale
5. **ffmpeg** renders each clip — vertical crop, face-tracked, with burned-in word-highlight captions
6. **Clips upload to Supabase Storage** → public URLs returned to the portal
7. **User sees download links + AI-generated social captions** in their portal session — no login required

---

## Architecture

```
KlipItGood portal  ──→  Supabase Edge Functions  ──→  Supabase DB (projects table)
                                                              │
                                              repository_dispatch webhook
                                                              │
                                                    GitHub Actions runner
                                                    (Ubuntu, 7GB RAM, free)
                                                              │
                                              ┌───────────────┼───────────────┐
                                           Groq API       Claude API       ffmpeg
                                         (Whisper)       (analysis)     (rendering)
                                                              │
                                                    Supabase Storage
                                                    (public clip URLs)
                                                              │
                                                    Portal shows clips
                                                    + copyable captions
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend portal | React + Vite (deployed via Lovable) |
| AI chat | Supabase Edge Functions + Claude API |
| Transcription | Groq Whisper Large v3 (free tier) |
| Clip analysis | Anthropic Claude (claude-opus-4-5) |
| Video rendering | ffmpeg + custom Python caption renderer |
| Job queue | Supabase Postgres (projects table) |
| File storage | Supabase Storage (klipitgood-uploads bucket) |
| Deployment | GitHub Actions (free tier, ~200 jobs/month) |
| Notifications | Resend email API |

---

## Local development

```bash
# Install dependencies
npm install

# Copy env template and fill in your keys
cp .env.example .env

# Run portal + server together
npm run dev
# Portal:  http://localhost:5173/portal
# Server:  http://localhost:8787
# Admin:   http://localhost:5173/admin
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for clip analysis |
| `GROQ_API_KEY` | ✅ | Groq API key for Whisper transcription (free) |
| `RESEND_API_KEY` | ✅ | Resend key for lead notification emails |
| `ADMIN_PASSWORD` | ✅ | Password for /admin founder panel |
| `OPENAI_API_KEY` | optional | Fallback AI provider |

---

## Running the worker locally

The worker processes one queued project and exits. Point it at your Supabase project and it will pick up the oldest queued job automatically:

```bash
# Process next queued job
GROQ_API_KEY=... ANTHROPIC_API_KEY=... node worker/klipitgood-worker.mjs

# Process a specific project by ID
node worker/klipitgood-worker.mjs --project <uuid>

# Analyze only (skip ffmpeg rendering)
node worker/klipitgood-worker.mjs --no-render
```

---

## GitHub Actions deployment (free, zero ongoing cost)

The worker runs on GitHub's free Ubuntu runners — no server needed.

### 1. Add secrets to your GitHub repo

`Settings → Secrets and variables → Actions → New repository secret`

Add each variable from the table above.

### 2. Configure the Supabase webhook

In your Supabase project, run this SQL once:

```sql
-- Fires a GitHub Actions workflow whenever a clip job is queued
CREATE OR REPLACE FUNCTION trigger_clip_worker()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://api.github.com/repos/YOUR_GITHUB_USERNAME/klipitgood/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.github_token'),
      'Accept', 'application/vnd.github.v3+json',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'event_type', 'clip_job_queued',
      'client_payload', jsonb_build_object('project_id', NEW.id)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_project_queued
  AFTER INSERT ON projects
  FOR EACH ROW
  WHEN (NEW.status IN ('queued', 'new'))
  EXECUTE FUNCTION trigger_clip_worker();
```

Then add your GitHub personal access token as a Supabase secret:

```sql
ALTER DATABASE postgres SET app.github_token = 'ghp_your_token_here';
```

### 3. Push and test

```bash
git push origin main
```

Manually trigger a run to test: `Actions → Process Clip Job → Run workflow → enter a project ID`

---

## Caption style

Captions are burned into each clip using a custom Python renderer (`worker/captions.py`). Style is configurable via the `--caption-style` flag:

| Style | Description |
|-------|-------------|
| `bold-pop` | White pill background, large black text, red active word (default) |
| `word-pop` | Word-by-word reveal, no background pill |
| `minimal` | Small white text, bottom-third placement |

Caption style can be specified per-job via the portal or system prompt context.

---

## Project structure

```
├── .github/workflows/
│   └── process-clip.yml     # GitHub Actions worker trigger
├── server/                  # Node.js Express API
│   ├── index.js             # API routes
│   ├── klipitgoodChat.js    # KlipItGood chat AI logic
│   ├── intake.js            # Lead capture & portal submission
│   └── payments.js          # Stripe checkout integration
├── worker/                  # Video processing pipeline
│   ├── klipitgood-worker.mjs # Entry point — Supabase bridge
│   ├── process.mjs          # Full pipeline orchestrator
│   ├── analyze.mjs          # Claude clip analysis
│   ├── apply-clips.mjs      # ffmpeg clip rendering
│   ├── captions.py          # Word-highlight caption burner
│   └── footage-source.mjs   # URL/upload resolver
├── src/                     # React portal frontend
├── supabase/
│   └── schema.sql           # Database schema
└── package.json
```

---

## License

MIT — built by [Unser.Media](https://unser.media)
