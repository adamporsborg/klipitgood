#!/usr/bin/env node
/**
 * process.mjs — KlipitGood Single-Command Pipeline
 *
 * Takes footage → transcribes → calls Claude API → renders clips → opens output.
 * No copy/paste. No JSON files to manage. One command, done.
 *
 * Usage:
 *   node scripts/process.mjs --footage <path>
 *   node scripts/process.mjs --footage <path> --type solo --goal short --style natural
 *   node scripts/process.mjs --footage <path> --type interview --goal longform --style natural
 *   node scripts/process.mjs --footage <path> --notes "Political candidate, focus on housing"
 *
 * Options:
 *   --footage <path>     Path to video file (required)
 *   --type <type>        interview | solo | presentation | other  (default: solo)
 *   --goal <goal>        short | longform | both                  (default: short)
 *   --style <style>      aggressive | natural                     (default: natural)
 *   --notes <text>       Extra context: who, what topics, what to avoid
 *   --subject <text>     Who is speaking (name/title)
 *   --label <label>      Project label override (default: auto from filename)
 *   --scale <num>        Base crop zoom, e.g. 1.10                (default: 1.10)
 *   --caption-style      bold-pop | word-pop | minimal            (default: bold-pop)
 *   --no-captions        Skip caption burn-in
 *   --no-render          Analyze only, skip ffmpeg rendering
 *   --redetect           Re-run face detection even if cached
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const outputDir = join(PROJECT_ROOT, "output");
const publicDir = join(PROJECT_ROOT, "public");
const versionsPath = join(__dirname, "_versions.json");
mkdirSync(outputDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};
const has = (flag) => args.includes(flag);

const footagePath = get("--footage");
if (!footagePath || !existsSync(footagePath)) {
  console.error("✗ --footage <path> is required and must exist.");
  console.error("  Example: node scripts/process.mjs --footage /Volumes/SSD/interview.mp4");
  process.exit(1);
}

const contentType  = get("--type",    "solo");       // interview | solo | presentation | other
const goal         = get("--goal",    "short");      // short | longform | both
const editStyle    = get("--style",   "natural");    // aggressive | natural
const notes        = get("--notes",   "");
const subject      = get("--subject", "");
const scaleArg     = parseFloat(get("--scale", "1.10"));
const noRender     = has("--no-render");
const redetect     = has("--redetect");
const noCaptions   = has("--no-captions");
const noJumpCuts   = has("--no-jump-cuts");  // collapse multi-segment clips to single continuous take
const captionStyle = get("--caption-style", "bold-pop");
const aiProvider = get("--ai-provider", process.env.KLIPITGOOD_AI_PROVIDER || "anthropic");
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const claudeModel = process.env.CLAUDE_MODEL || "claude-opus-4-5";
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.2";

// Auto-generate label from filename
const rawName = basename(footagePath, extname(footagePath))
  .replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 20);
const label = get("--label", `proj_${rawName}`);

console.log(`
╔══════════════════════════════════════════════════════════╗
║              KlipitGood — Processing Pipeline            ║
╚══════════════════════════════════════════════════════════╝

  📹 Footage:  ${basename(footagePath)}
  🎬 Type:     ${contentType}
  🎯 Goal:     ${goal}
  ✂️  Style:    ${editStyle}
  🧠 AI:       ${providerLabel()}
  🔤 Captions: ${noCaptions ? "off" : captionStyle}
  🏷  Label:   ${label}
${notes ? `  📝 Notes:   ${notes}` : ""}
${subject ? `  🎤 Subject: ${subject}` : ""}
`);

// ─── Crop / render settings ───────────────────────────────────────────────────

const SOURCE_W = 1920, SOURCE_H = 1080, OUT_W = 1080, OUT_H = 1920;
const BASE_CROP_W = Math.floor(SOURCE_H * (9 / 16) / 2) * 2;
const BASE_SCALE  = scaleArg;
const SEGMENT_END_BUFFER = 0.08;
const CUT_ZOOM_ALT = Math.min(1.25, BASE_SCALE + 0.08);
const GAP_CUT_THRESHOLD = 0.35;

// Pause threshold adapts to editing style and goal
const PAUSE_THRESHOLD =
  goal === "longform" ? 0.8 :
  editStyle === "aggressive" ? 0.3 : 0.5;

// ─── Step 1: Create proxy ─────────────────────────────────────────────────────

const proxyName = basename(footagePath, extname(footagePath)) + "_proxy.mp4";
const proxyPath = join(publicDir, proxyName);

if (!existsSync(proxyPath)) {
  console.log("📦 Creating 1080p proxy...");
  execSync(
    `ffmpeg -y -i "${footagePath}" -vf scale=1920:1080 -c:v libx264 -crf 18 -preset fast -c:a aac -b:a 128k "${proxyPath}"`,
    { stdio: "pipe" }
  );
  console.log("  ✓ Proxy created");
} else {
  console.log("  ✓ Proxy exists (cached)");
}

// ─── Step 2: Face detection ───────────────────────────────────────────────────

const metaPath = join(__dirname, `_meta_${label}.json`);
let meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
meta.footage = proxyName;

let offsetX = 0;
if (!redetect && typeof meta.cropOffsetX === "number") {
  console.log(`  📐 Crop offset (cached): ${meta.cropOffsetX}px`);
  offsetX = meta.cropOffsetX;
} else {
  console.log("  🔍 Detecting face position...");
  const result = spawnSync("/usr/local/bin/python3.13", [
    join(__dirname, "detect-crop-offset.py"), proxyPath,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 120000 });

  if (result.status === 0) {
    try {
      const det = JSON.parse(result.stdout.toString());
      offsetX = det.offset;
      meta.cropOffsetX = offsetX;
      meta.faceX = det.face_x;
      console.log(`  📐 Face at x≈${det.face_x} → offset: ${offsetX}px (confidence: ${det.confidence})`);
    } catch {
      console.warn("  ⚠  Could not parse face detection — using 0");
    }
  } else {
    console.warn("  ⚠  Face detection failed — using 0");
  }
}

writeFileSync(metaPath, JSON.stringify(meta, null, 2));

// ─── Step 3: Transcribe ───────────────────────────────────────────────────────

console.log("\n🎙  Transcribing footage...");

const probeResult = execSync(
  `ffprobe -v quiet -print_format json -show_streams -show_format "${footagePath}"`
).toString();
const probe = JSON.parse(probeResult);
const duration = parseFloat(probe.format.duration);

// ── Helpers for chunked transcription ────────────────────────────────────────

const GROQ_LIMIT_BYTES = 24 * 1024 * 1024; // 24 MB (Groq hard cap is 25 MB)
const CHUNK_SECONDS    = 20 * 60;           // 20-minute chunks with overlap
const CHUNK_OVERLAP    = 3;                 // seconds of overlap between chunks

/**
 * Extract compressed mono audio from any video/audio file.
 * Output is a small .mp3 — typically 1–2 MB per minute of speech.
 */
function extractAudio(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -vn -ac 1 -ar 16000 -ab 32k -f mp3 "${outputPath}"`,
    { stdio: "pipe", timeout: 300000 }
  );
}


/**
 * Transcribe one audio file via Groq Whisper. Returns raw API response.
 */
async function transcribeChunk(groq, audioPath) {
  const { createReadStream } = await import("fs");
  return groq.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
}

/**
 * Merge chunk transcripts into one, applying time offsets and deduping
 * overlapping words at chunk boundaries.
 */
function mergeTranscripts(chunks) {
  const allWords = [];
  const allSegments = [];

  for (const { response, startOffset, endOffset } of chunks) {
    const words = (response.words || [])
      .map((w) => ({ word: w.word, start: w.start + startOffset, end: w.end + startOffset }))
      // Drop words that fall in the overlap zone of the previous chunk
      .filter((w) => w.start >= (startOffset === 0 ? 0 : startOffset + CHUNK_OVERLAP / 2));

    const segs = (response.segments || [])
      .map((s) => ({ text: s.text.trim(), start: s.start + startOffset, end: s.end + startOffset }))
      .filter((s) => s.start >= (startOffset === 0 ? 0 : startOffset + CHUNK_OVERLAP / 2));

    allWords.push(...words);
    allSegments.push(...segs);
  }

  return {
    text: allSegments.map((s) => s.text).join(" "),
    words: allWords,
    segments: allSegments,
  };
}

// ── Run transcription ─────────────────────────────────────────────────────────

// Use Groq Whisper API (free tier) instead of local faster-whisper.
// Falls back to local transcribe.py if GROQ_API_KEY is not set.
let transcript;
if (process.env.GROQ_API_KEY) {
  const { default: Groq } = await import("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // 1. Extract compressed mono audio — shrinks a 2GB video to ~60–120 MB
  const tmpDir = join(PROJECT_ROOT, "tmp", "audio");
  mkdirSync(tmpDir, { recursive: true });
  const audioPath = join(tmpDir, `_audio_${label}.mp3`);

  console.log("  Extracting audio (mono 32kbps)...");
  extractAudio(footagePath, audioPath);

  const audioSizeBytes = parseInt(execSync(`wc -c < "${audioPath}"`).toString().trim());
  console.log(`  Audio extracted: ${(audioSizeBytes / 1024 / 1024).toFixed(1)} MB`);

  // 2. Split into chunks if still over Groq's 25MB limit
  const chunks = [];
  if (audioSizeBytes <= GROQ_LIMIT_BYTES) {
    chunks.push({ path: audioPath, startOffset: 0 });
  } else {
    let chunkStart = 0;
    let chunkIndex = 0;
    while (chunkStart < duration) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SECONDS, duration);
      const chunkPath = join(tmpDir, `_audio_${label}_${chunkIndex}.mp3`);
      execSync(
        `ffmpeg -y -i "${audioPath}" -ss ${chunkStart} -to ${chunkEnd} -c copy "${chunkPath}"`,
        { stdio: "pipe", timeout: 120000 }
      );
      chunks.push({ path: chunkPath, startOffset: chunkStart });
      chunkStart = chunkEnd - CHUNK_OVERLAP;
      chunkIndex++;
      if (chunkEnd >= duration) break;
    }
    console.log(`  Split into ${chunks.length} chunks`);
  }

  // 3. Transcribe each chunk
  let groqFailed = false;
  const chunkResults = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const { path: chunkPath, startOffset } = chunks[i];
      if (chunks.length > 1) console.log(`  Transcribing chunk ${i + 1}/${chunks.length}...`);
      const response = await transcribeChunk(groq, chunkPath);
      chunkResults.push({ response, startOffset });
    }
  } catch (groqErr) {
    if (groqErr.status === 401 || groqErr.status === 403) {
      console.warn(`  ⚠  Groq key invalid (${groqErr.status}) — falling back to local Whisper`);
      groqFailed = true;
    } else {
      throw groqErr;
    }
  }

  if (!groqFailed) {
    // 4. Merge and normalise
    transcript = mergeTranscripts(chunkResults);
    console.log(`  ✓ Groq transcription complete`);
  }
}

if (!transcript) {
  // Local fallback — use the `whisper` CLI (installed via pip install openai-whisper)
  console.log("  Falling back to local Whisper CLI...");

  const localTmpDir = join(PROJECT_ROOT, "tmp", "audio");
  mkdirSync(localTmpDir, { recursive: true });
  const localAudioPath = join(localTmpDir, `_audio_${label}_local.mp3`);

  if (!existsSync(localAudioPath)) {
    console.log("  Extracting audio...");
    extractAudio(footagePath, localAudioPath);
  }

  const whisperOut = join(localTmpDir, `_whisper_${label}`);
  mkdirSync(whisperOut, { recursive: true });

  console.log("  Running whisper (base model, may take a few minutes)...");
  const whisperResult = spawnSync(
    "whisper",
    [localAudioPath, "--model", "base", "--output_format", "json",
     "--output_dir", whisperOut, "--word_timestamps", "True"],
    { maxBuffer: 100 * 1024 * 1024, timeout: 900000, encoding: "utf8" }
  );

  if (whisperResult.status !== 0) {
    console.error("✗ Local Whisper transcription failed:");
    console.error(whisperResult.stderr?.slice(0, 500) || "(no stderr)");
    process.exit(1);
  }

  const { readdirSync } = await import("fs");
  const jsonFile = readdirSync(whisperOut).find(f => f.endsWith(".json"));
  if (!jsonFile) { console.error("✗ Whisper produced no JSON output"); process.exit(1); }

  const whisperData = JSON.parse(readFileSync(join(whisperOut, jsonFile), "utf8"));
  const segs = whisperData.segments || [];
  const words = segs.flatMap(s => (s.words || []).map(w => ({ word: w.word, start: w.start, end: w.end })));

  transcript = {
    text: whisperData.text || segs.map(s => s.text).join(" "),
    words,
    segments: segs.map(s => ({ text: s.text.trim(), start: s.start, end: s.end })),
  };
  console.log("  ✓ Local Whisper transcription complete");
}

console.log(`  ✓ ${transcript.words.length} words transcribed`);

// Cache transcript to disk so refine.mjs can skip re-transcription
const transcriptCachePath = join(__dirname, `_transcript_${label}.json`);
writeFileSync(transcriptCachePath, JSON.stringify({ ...transcript, duration }, null, 2));
console.log(`  ✓ Transcript cached → scripts/_transcript_${label}.json`);

// ─── Step 4: Detect pauses ────────────────────────────────────────────────────

const pauses = [];
for (let i = 1; i < transcript.words.length; i++) {
  const gap = transcript.words[i].start - transcript.words[i - 1].end;
  if (gap > PAUSE_THRESHOLD) {
    pauses.push({
      start: Math.round(transcript.words[i - 1].end * 1000) / 1000,
      end: Math.round(transcript.words[i].start * 1000) / 1000,
      durationMs: Math.round(gap * 1000),
    });
  }
}
console.log(`  ✓ ${pauses.length} pauses detected (threshold: ${PAUSE_THRESHOLD}s)`);

// ─── Step 5: Build dynamic system prompt ──────────────────────────────────────

function buildSystemPrompt(contentType, goal, editStyle, subject, notes) {
  const subjectLine = subject
    ? `SUBJECT: ${subject}.`
    : "SUBJECT: Unknown — infer from context.";

  const goalInstructions = goal === "longform" ? `
OUTPUT TYPE: Long-form single-speaker edit (8–15 minutes).
- Keep natural speech rhythm. Do NOT fragment continuous thoughts.
- Only remove pauses ≥ ${PAUSE_THRESHOLD}s. All shorter pauses are natural breath — keep them.
- This should feel like a polished talking-head YouTube video, not a clip reel.
- Aim for 1–3 clips total, each 5–15 minutes of actual speech.
- Zoom changes should be very subtle (1.10 → 1.12 at most) — imperceptible to casual viewer.
- Score for YouTube watch time and retention, not virality.
` : goal === "both" ? `
OUTPUT TYPE: Both short clips AND a long-form edit.
- First, extract all short viral clips (15–60 seconds each).
- Then include 1 long-form clip (5–15 minutes) as the final entry, id: "longform_01".
- Label short clips clip-01 through clip-NN, long-form clip last.
` : `
OUTPUT TYPE: Short-form viral clips for TikTok, Instagram Reels, YouTube Shorts.
- Each clip must be 15–90 seconds of actual speech.
- Hook must land in first 3 seconds — start on the most compelling word.
- Every clip must work standalone with zero context.
- Score 1–10 for scroll-stopping viral potential. Prioritize strong opinions, surprising facts, emotional moments.
`;

  const styleInstructions = editStyle === "aggressive" ? `
EDITING STYLE: Aggressive.
- Remove every pause ≥ ${PAUSE_THRESHOLD}s without mercy.
- Cut all filler words (um, uh, like, you know) if visible in transcript.
- Energy should feel tight and electric throughout.
` : `
EDITING STYLE: Natural.
- Remove pauses ≥ ${PAUSE_THRESHOLD}s but preserve natural breathing rhythm.
- Speech must sound human and conversational, not robotic.
- When in doubt, keep the pause — removal should never be audible.
`;

  const typeInstructions =
    contentType === "interview" ?
      "CONTENT TYPE: Interview/conversation. Remove all interviewer speech, questions, and crosstalk. Output only the subject's words." :
    contentType === "presentation" ?
      "CONTENT TYPE: Presentation/keynote. Keep transitions between points smooth. Remove audience noise, coughs, dead air." :
      "CONTENT TYPE: Solo talking head / monologue. Speaker is the only voice.";

  const jumpCutRule = noJumpCuts
    ? `\n\nNO JUMP CUTS MODE: Each clip must use EXACTLY ONE segment (a single continuous take). Do NOT split segments to remove pauses — set each clip's segments array to a single { start, end } object. Pauses stay in. Pick timestamps where the speech flows naturally from start to end without needing any cuts.`
    : "";

  const notesLine = notes
    ? `\n\n━━━ USER DIRECTIVE (HIGHEST PRIORITY — follow this exactly) ━━━\n${notes}\n\nThis is what the user specifically asked for. Override your default clip selection strategy if needed to satisfy this directive. If they said "funny moments", find comedy. If they said "under 30 seconds", hard-cap all clips at 30s. If they said "focus on business advice", ignore anything off-topic. Take this literally.${jumpCutRule}`
    : jumpCutRule
      ? `\n\n━━━ RENDERING CONSTRAINT ━━━${jumpCutRule}`
      : "";

  return `You are a senior short-form video editor with a decade of experience cutting viral content for TikTok, Instagram Reels, and YouTube Shorts. You think like a creator, not a transcription service. You work on all kinds of video: podcasts, interviews, speeches, fitness content, comedy, educational content, business advice, news commentary, and more.

Your sole output is a single valid JSON object. Return ONLY raw JSON — no markdown fences, no prose, no explanation.

${subjectLine}
${typeInstructions}
${goalInstructions}
${styleInstructions}
${notesLine}

━━━ EDITORIAL PHILOSOPHY ━━━

You are looking for MOMENTS, not sentences. A great clip has:
1. A HOOK in the first 2 seconds that creates a question the viewer needs answered
2. A PAYOFF that delivers — a surprising fact, a strong conviction, a turn of emotion
3. ENERGY that stays HIGH throughout — no dead weight in the middle
4. A natural END that feels complete, not cut off

WHAT MAKES A GREAT HOOK (first 2–3 seconds):
- A strong, specific number: "We spent $635 million—"
- A provocative claim: "They're lying to you about—"
- An emotional declaration: "I've lived here 37 years and—"
- A contrast: "Everyone else is talking about X. I'm the only one who—"
- An unfinished thought that demands resolution

WHAT KILLS A CLIP:
- Starting on a filler word, soft breath, or "So..." / "Um..." / "Well..."
- Starting in the middle of a thought where context is needed
- Ending mid-sentence or mid-idea
- Dead air, long pauses, or repetitive re-starts in the middle
- Clips that require watching other clips to understand
- Generic content that could come from anyone

SCORE CALIBRATION:
9.0–10.0 = Would stop a scroll. Specific, polarizing, or emotionally resonant.
7.0–8.9  = Good content, solid clip, likely to perform.
5.0–6.9  = Contextual — good if this is a niche audience.
Below 5  = Don't include.

Aim for 8–15 clips for short-form content. Quality over quantity — cut mercilessly.

━━━ OUTPUT SCHEMA ━━━

{
  "clips": [{
    "id": "clip-01",
    "title": "3–7 word title (active voice, specific)",
    "score": 9.2,
    "why": "Hook: what stops the scroll in the first 2s. Payoff: what delivers at the end.",
    "segments": [{ "start": 12.3, "end": 27.8 }],
    "zoomKeyframes": [{ "clipTimeSeconds": 0.0, "scale": 1.10 }]
  }]
}

━━━ SEGMENT RULES ━━━
- Segment start: exact phonetic onset of the FIRST compelling word. Never on a breath, pause, or "um/uh/so/well/like".
  If the speaker takes a breath before saying something great, start AFTER the breath.
- Segment end: last word of a complete thought. Never mid-sentence. If the speaker trails off, end before the trail.
- Gaps between segments = removed pauses = jump cut. Only remove pauses ≥ ${PAUSE_THRESHOLD}s.
- Back-to-back gap cuts less than 2 seconds apart almost always sound robotic — consider keeping the gap instead.
- Maximum 6–8 segments per clip. More than that and it sounds like a word salad.

━━━ ZOOM RULES ━━━
- Base scale: ${BASE_SCALE}. Never go below this.
- EVERY gap-removal cut MUST have a zoom change — viewer sees a framing shift, not a teleport.
- Alternate: ${BASE_SCALE} ↔ ${(BASE_SCALE + 0.08).toFixed(2)} at each gap cut.
- Punch in to 1.20–1.22 on THE single most important line in the clip.
- Max 1.25 for extreme emphasis — use sparingly (once per clip max).
- Hard snap cuts only. Minimum 4 zoom keyframes per clip.
- Place a keyframe at the START of every segment.

━━━ FINAL CHECK (do this before outputting) ━━━
For each clip, verify:
[ ] First word: would a viewer lean in? Or is it soft/contextual?
[ ] Last word: does the clip feel complete, or does it hang?
[ ] Middle: any 3+ second stretch where nothing interesting happens? Cut it.
[ ] Every jump cut has a zoom change?
[ ] Score is honest — not inflated?
If any fails, fix the clip before including it.`;
}

const systemPrompt = buildSystemPrompt(contentType, goal, editStyle, subject, notes);

const userMessage = [
  `VIDEO: ${basename(footagePath)} (${duration.toFixed(1)}s)`,
  `PROXY FILE FOR RENDERING: ${proxyName}`,
  ``,
  `DETECTED PAUSES (${pauses.length}):`,
  JSON.stringify(pauses),
  ``,
  `WORD-LEVEL TIMESTAMPS:`,
  JSON.stringify(transcript.words),
  ``,
  `SEGMENT TRANSCRIPT:`,
  transcript.segments.map(s => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`).join("\n"),
].join("\n");

// ─── Step 6: Call AI API ──────────────────────────────────────────────────────

console.log(`\n🤖 Calling ${providerName()} API for clip analysis...`);

let parsed;

try {
  const raw = await generateClipJson(systemPrompt, userMessage);

  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error("No valid JSON in response");
  }

  // Save response for reference
  const responsePath = join(__dirname, `_response_${label}.txt`);
  writeFileSync(responsePath, raw);
  console.log(`  ✓ ${parsed.clips.length} clips identified`);
  parsed.clips.forEach((c, i) =>
    console.log(`  ${i + 1}. ${c.title} (score: ${c.score}) — ${c.segments.reduce((a,s)=>a+(s.end-s.start),0).toFixed(0)}s`)
  );

} catch (err) {
  console.error(`✗ ${providerName()} API call failed:`, err.message);
  process.exit(1);
}

async function generateClipJson(systemPrompt, userMessage) {
  if (aiProvider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.");

    const client = new OpenAI();
    const response = await client.responses.create({
      model: openaiModel,
      instructions: systemPrompt,
      input: userMessage,
      max_output_tokens: 16000,
      text: {
        format: { type: "json_object" },
      },
    });

    return response.output_text.trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }

  if (aiProvider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: userMessage,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        maxOutputTokens: 16000,
      },
    });

    return response.text.trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: claudeModel,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return message.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function providerName() {
  if (aiProvider === "openai") return "OpenAI";
  if (aiProvider === "gemini") return "Gemini";
  return "Claude";
}

function providerLabel() {
  if (aiProvider === "openai") return `openai (${openaiModel})`;
  if (aiProvider === "gemini") return `gemini (${geminiModel})`;
  return `anthropic (${claudeModel})`;
}

// ─── Step 7: Render clips ─────────────────────────────────────────────────────

if (noRender) {
  console.log("\n⏭  --no-render flag set. Skipping render.");
  console.log(`   Response saved to: scripts/_response_${label}.txt`);
  process.exit(0);
}

console.log("\n🎬 Rendering clips...");

// Versioning helpers
function loadVersions() {
  if (!existsSync(versionsPath)) return {};
  try { return JSON.parse(readFileSync(versionsPath, "utf8")); } catch { return {}; }
}
function saveVersions(v) { writeFileSync(versionsPath, JSON.stringify(v, null, 2)); }
function versionSuffix(v) { return `_V${String(v).padStart(2, "0")}`; }

function cropForScale(scale) {
  const cw = Math.floor(BASE_CROP_W / scale / 2) * 2;
  const ch = Math.floor(SOURCE_H / scale / 2) * 2;
  const rawCx = Math.floor((SOURCE_W - cw) / 2) + offsetX;
  const cx = Math.max(0, Math.min(SOURCE_W - cw, rawCx));
  const cy = Math.floor((SOURCE_H - ch) / 2);
  return { cw, ch, cx, cy };
}

function buildSubClips(segments, zoomKeyframes) {
  const buffered = segments.map((seg, i) => {
    const nextStart = i + 1 < segments.length ? segments[i + 1].start : Infinity;
    const bufferedEnd = Math.min(seg.end + SEGMENT_END_BUFFER, nextStart - 0.02);
    return { start: seg.start, end: Math.max(seg.end, bufferedEnd) };
  });

  let clipTime = 0;
  const timeline = buffered.map((seg, i) => {
    const dur = seg.end - seg.start;
    const entry = {
      sourceStart: seg.start, sourceEnd: seg.end,
      origSourceStart: segments[i].start,
      clipStart: clipTime, clipEnd: clipTime + dur,
    };
    clipTime += dur;
    return entry;
  });
  const totalDur = clipTime;

  const zones = (zoomKeyframes ?? []).map((kf, i) => ({
    clipStart: kf.clipTimeSeconds,
    clipEnd: i + 1 < zoomKeyframes.length ? zoomKeyframes[i + 1].clipTimeSeconds : totalDur,
    scale: Math.min(1.25, Math.max(BASE_SCALE, kf.scale)),
  }));
  if (!zones.length) zones.push({ clipStart: 0, clipEnd: totalDur, scale: BASE_SCALE });

  const subClips = [];
  for (const zone of zones) {
    for (const seg of timeline) {
      const s = Math.max(zone.clipStart, seg.clipStart);
      const e = Math.min(zone.clipEnd, seg.clipEnd);
      if (e <= s + 0.1) continue; // skip slivers under 100ms — AAC needs at least ~23ms per frame
      subClips.push({
        sourceStart: seg.sourceStart + (s - seg.clipStart),
        duration: e - s,
        scale: zone.scale,
        _segSourceStart: seg.origSourceStart,
      });
    }
  }

  // Enforce zoom change at every gap-removal cut
  for (let i = 1; i < subClips.length; i++) {
    const prevSourceEnd = subClips[i - 1].sourceStart + subClips[i - 1].duration;
    const sourceGap = subClips[i].sourceStart - prevSourceEnd;
    const zoomUnchanged = Math.abs(subClips[i].scale - subClips[i - 1].scale) < 0.02;
    if (sourceGap > GAP_CUT_THRESHOLD && zoomUnchanged) {
      subClips[i].scale = subClips[i - 1].scale <= BASE_SCALE + 0.01 ? CUT_ZOOM_ALT : BASE_SCALE;
    }
  }

  return subClips;
}

function renderClip(clip, outFile) {
  const subClips = buildSubClips(clip.segments, clip.zoomKeyframes);
  const tmpDir = join(PROJECT_ROOT, "tmp", "segments");
  mkdirSync(tmpDir, { recursive: true });

  // Step 1: Render each subclip to a temp file (one -ss/-t seek per clip)
  const segFiles = subClips.map((sc, i) => {
    const { cw, ch, cx, cy } = cropForScale(sc.scale);
    const segFile = join(tmpDir, `_seg_${label}_${i}.mp4`);
    const cmd = [
      `ffmpeg -y`,
      `-ss ${sc.sourceStart.toFixed(3)} -t ${sc.duration.toFixed(3)}`,
      `-i "${proxyPath}"`,
      `-vf "crop=${cw}:${ch}:${cx}:${cy},scale=${OUT_W}:${OUT_H}:flags=lanczos"`,
      `-c:v libx264 -crf 20 -preset fast`,
      `-c:a aac -b:a 128k -ar 48000 -ac 2`,
      `-movflags +faststart`,
      `"${segFile}"`,
    ].join(" ");
    try {
      execSync(cmd, { stdio: "pipe", timeout: 120000 });
    } catch (e) {
      throw new Error(`Segment ${i} render failed: ${e.stderr?.toString().slice(-300) || e.message}`);
    }
    return segFile;
  });

  // Step 2: Join with the concat demuxer (stream copy — no re-encode, perfectly reliable)
  const listPath = join(tmpDir, `_concat_${label}.txt`);
  writeFileSync(listPath, segFiles.map(f => `file '${f}'`).join("\n"));

  const joinCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${outFile}"`;
  try {
    execSync(joinCmd, { stdio: "pipe", timeout: 120000 });
  } catch (e) {
    throw new Error(`Concat failed: ${e.stderr?.toString().slice(-300) || e.message}`);
  }

  // Cleanup temp segment files
  for (const f of segFiles) { try { require ? null : null; execSync(`rm -f "${f}"`, { stdio: "pipe" }); } catch {} }
}

const versions = loadVersions();
const clips = (parsed.clips ?? []).map(c => ({ ...c, id: c.id.replace(/_/g, "-") }));
let rendered = 0;
const deliveryFiles = [];

for (let clip of clips) {
  // ── No-jump-cuts enforcement ──────────────────────────────────────────────
  // Collapse all segments to a single continuous span: first start → last end.
  // Pauses stay in. The clip plays as a natural take with no stitching.
  if (noJumpCuts && clip.segments && clip.segments.length > 1) {
    const spanStart = clip.segments[0].start;
    const spanEnd   = clip.segments[clip.segments.length - 1].end;
    clip = {
      ...clip,
      segments: [{ start: spanStart, end: spanEnd }],
      zoomKeyframes: [
        { t: 0,                           scale: BASE_SCALE },
        { t: (spanEnd - spanStart) * 0.3, scale: BASE_SCALE + 0.04 },
        { t: (spanEnd - spanStart) * 0.7, scale: BASE_SCALE + 0.04 },
        { t: (spanEnd - spanStart),       scale: BASE_SCALE },
      ],
    };
    console.log(`  ℹ️  no-jump-cuts: collapsed to single take [${spanStart.toFixed(1)}s → ${spanEnd.toFixed(1)}s]`);
  }

  const safeName = clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 50);
  const baseName = `${label}_${clip.id}_${safeName}`;
  const version = versions[baseName] ? (versions[baseName].version ?? 1) + 1 : 2;
  const outFileName = `${baseName}_V${String(version).padStart(2, "0")}.mp4`;
  const outFile = join(outputDir, outFileName);

  const secs = clip.segments.reduce((a, s) => a + (s.end - s.start), 0).toFixed(0);
  console.log(`\n  ▶ ${clip.id}: ${clip.title} (${secs}s)`);
  process.stdout.write(`  🎬 Rendering... `);

  try {
    renderClip(clip, outFile);
    process.stdout.write(`✓\n`);
    let finalFile = outFile;

    // Caption burn-in pass
    if (!noCaptions && existsSync(transcriptCachePath)) {
      const capFileName = outFileName.replace(".mp4", "_CAP.mp4");
      const capFile = join(outputDir, capFileName);
      process.stdout.write(`\n  🔤 Burning captions (${captionStyle})... `);

      const capResult = spawnSync("python3", [
        join(__dirname, "captions.py"),
        "--transcript", transcriptCachePath,
        "--segments", JSON.stringify(clip.segments),
        "--input",    outFile,
        "--output",   capFile,
        "--style",    captionStyle,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 300000, encoding: "utf8" });

      if (capResult.status === 0) {
        process.stdout.write(`✓\n`);
        finalFile = capFile;
      } else {
        process.stdout.write(`⚠ failed (${capResult.stderr?.slice(-120)})\n`);
      }
    }

    const size = Math.round(
      parseInt(execSync(`stat -f%z "${finalFile}"`).toString().trim()) / 1024 / 1024
    );
    console.log(`  ✅ ${clip.id} → ${basename(finalFile)} (${size}MB)`);

    if (!versions[baseName]) versions[baseName] = { version: 1, history: [] };
    versions[baseName].version = version;
    versions[baseName].history.push({
      version, renderedAt: new Date().toISOString().slice(0, 10),
      notes: `offset: ${offsetX}px, scale: ${BASE_SCALE}, goal: ${goal}, style: ${editStyle}, captions: ${noCaptions ? "off" : captionStyle}`,
      file: basename(finalFile),
    });
    saveVersions(versions);
    rendered++;

    deliveryFiles.push({
      file: basename(finalFile),
      path: finalFile,
      cleanFile: outFileName,
      title: clip.title,
      score: clip.score,
      why: clip.why,
      duration: secs,
    });
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 100)}`);
  }
}

// ─── Step 8: Delivery summary ─────────────────────────────────────────────────

const deliverySummaryPath = join(outputDir, `${label}_delivery.json`);
writeFileSync(deliverySummaryPath, JSON.stringify({
  label,
  footage: basename(footagePath),
  renderedAt: new Date().toISOString(),
  goal, contentType, editStyle,
  clips: deliveryFiles,
}, null, 2));

console.log(`
╔══════════════════════════════════════════════════════════╗
║                    ✅ ALL DONE                           ║
╚══════════════════════════════════════════════════════════╝

  ✂️  ${rendered}/${clips.length} clips rendered
  📁 Output folder: output/
  📋 Delivery summary: output/${label}_delivery.json

  Clips ready to deliver:
${deliveryFiles.map((f, i) => `  ${i + 1}. [${f.score}] ${f.title} (${f.duration}s) → ${f.file}`).join("\n")}

  Next: Upload clips to Google Drive and paste links into admin panel.
`);

// Open output folder on Mac
try { execSync(`open "${outputDir}"`); } catch {}
