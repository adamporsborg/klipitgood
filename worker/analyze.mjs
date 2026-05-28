#!/usr/bin/env node
/**
 * analyze.mjs — Step 1 of 2
 *
 * Usage: node scripts/analyze.mjs <path-to-video>
 *
 * Transcribes the video, then writes a prompt file you paste into Claude.
 * After Claude responds, run: node scripts/apply-clips.mjs
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { createReadStream } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// ─── 1. Validate input ────────────────────────────────────────────────────────

const videoPath = process.argv[2];
if (!videoPath || !existsSync(videoPath)) {
  console.error("Usage: node scripts/analyze.mjs <path-to-video>");
  process.exit(1);
}

const videoFilename = basename(videoPath);
console.log(`\n🎬 Analyzing: ${videoFilename}\n`);

// ─── 2. Copy video to public/ if not already there ───────────────────────────

const publicDir = join(PROJECT_ROOT, "public");
mkdirSync(publicDir, { recursive: true });
const publicVideoPath = join(publicDir, videoFilename);
if (!existsSync(publicVideoPath)) {
  console.log("📁 Copying footage to public/...");
  execSync(`cp "${videoPath}" "${publicVideoPath}"`);
}

// ─── 3. Get video metadata ───────────────────────────────────────────────────

console.log("📊 Reading video metadata...");
const probeResult = execSync(
  `ffprobe -v quiet -print_format json -show_streams -show_format "${videoPath}"`
).toString();
const probe = JSON.parse(probeResult);
const videoStream = probe.streams.find((s) => s.codec_type === "video");
const duration = parseFloat(probe.format.duration);
const width = videoStream?.width || 1920;
const height = videoStream?.height || 1080;
console.log(`   Duration: ${duration.toFixed(1)}s | Resolution: ${width}x${height}`);

// ─── 4. Transcribe ───────────────────────────────────────────────────────────

const audioPath = join(PROJECT_ROOT, "scripts", "_audio_tmp.wav");
let transcript;

const whisperCheck = spawnSync("python3", ["-c", "from faster_whisper import WhisperModel; print('ok')"]);
const hasLocalWhisper = whisperCheck.status === 0 && whisperCheck.stdout.toString().includes("ok");

if (hasLocalWhisper) {
  console.log("🔊 Transcribing with local Whisper (this takes 1-2 min for a 12-min video)...");
  const result = spawnSync(
    "python3",
    [join(__dirname, "transcribe.py"), videoPath],
    { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
  );
  if (result.status !== 0) {
    console.error("Whisper error:", result.stderr.toString());
    process.exit(1);
  }
  transcript = JSON.parse(result.stdout.toString());
} else {
  console.log("🔊 Transcribing via OpenAI Whisper API...");
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "\n⚠️  No local whisper found and OPENAI_API_KEY not set.\n" +
      "   Install faster-whisper: pip3 install faster-whisper\n"
    );
    process.exit(1);
  }
  console.log("🎙️  Extracting audio for API upload...");
  execSync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 -f wav "${audioPath}" 2>/dev/null`);
  const openai = new OpenAI();
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  transcript = {
    text: response.text,
    words: (response.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    segments: (response.segments || []).map((s) => ({ text: s.text.trim(), start: s.start, end: s.end })),
  };
  try { execSync(`rm "${audioPath}"`); } catch {}
}

console.log(`   ✓ Transcribed ${transcript.words.length} words across ${transcript.segments.length} segments`);

// ─── 5. Detect pauses ────────────────────────────────────────────────────────

const PAUSE_THRESHOLD = 0.4;
const pauses = [];
for (let i = 1; i < transcript.words.length; i++) {
  const gap = transcript.words[i].start - transcript.words[i - 1].end;
  if (gap > PAUSE_THRESHOLD) {
    pauses.push({
      start: round(transcript.words[i - 1].end),
      end: round(transcript.words[i].start),
      duration: round(gap),
    });
  }
}
function round(n) { return Math.round(n * 1000) / 1000; }

// ─── 6. Save transcript + metadata for apply-clips.mjs ───────────────────────

const metaPath = join(PROJECT_ROOT, "scripts", "_pending_meta.json");
writeFileSync(metaPath, JSON.stringify({ footage: videoFilename, width, height, duration }, null, 2));
const transcriptPath = join(PROJECT_ROOT, "scripts", "_pending_transcript.json");
writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

// ─── 7. Build the prompt to paste into Claude ────────────────────────────────

const systemPrompt = `You are an expert social media video editor specializing in political content for TikTok and Instagram Reels. Your job is to find the most compelling, shareable moments from raw footage of a political candidate speaking.

You will receive a full transcript with word-level timestamps and a list of detected pauses.

Your output is a JSON array of clips. Each clip must be:
- A complete, standalone statement or argument (no mid-thought cuts, listener must understand it without context)
- Under 90 seconds of ACTUAL SPEECH (not counting removed pauses)
- Punchy, emotionally resonant, and optimized for short-form video performance
- Free of: filler words at the start/end, long pauses, false-starts, repeated sentences, coughs, interruptions, anything weird

For each clip, design the zoom/punch animation like a cinematographer:
- Start at scale 1.05 (slightly punched in for the cropped vertical frame)
- "Punch in" (scale 1.2–1.4) on key words, emotional peaks, strong claims, or punchlines
- "Punch out" (back toward 1.05) for setup or context moments
- Vary the scale throughout — flat video kills engagement
- Zoom transitions should feel dynamic, not nauseating

Return ONLY valid JSON with no markdown fences, no explanation text — just the raw JSON object:

{
  "clips": [
    {
      "id": "clip_01",
      "title": "Short descriptive title",
      "score": 8.5,
      "why": "One sentence on why this will perform well on TikTok/Reels",
      "segments": [
        { "from": 12.3, "to": 27.8 },
        { "from": 29.1, "to": 45.2 }
      ],
      "zoomKeyframes": [
        { "t": 0.0, "scale": 1.05 },
        { "t": 5.2, "scale": 1.3 },
        { "t": 8.0, "scale": 1.3 },
        { "t": 9.5, "scale": 1.05 }
      ]
    }
  ]
}

CRITICAL RULES:
- "segments" are SOURCE VIDEO timestamps in seconds — gaps between segments = removed pauses/cuts
- "zoomKeyframes.t" is CLIP time in seconds starting from 0 (not source video time)
- Extract EVERY compelling standalone moment — don't stop at 3 or 5. If 12 good moments exist, return all 12.
- Order clips by score descending
- Score 1–10 (10 = viral-worthy)`;

const userMessage = `VIDEO: ${videoFilename} (${duration.toFixed(1)}s total)
DETECTED PAUSES: ${pauses.length} pauses detected
${pauses.slice(0, 40).map(p => `  [${p.start}s–${p.end}s] ${p.duration.toFixed(1)}s gap`).join("\n")}

FULL TRANSCRIPT (with timestamps):
${transcript.segments.map((s) => `[${s.start.toFixed(1)}s–${s.end.toFixed(1)}s] ${s.text}`).join("\n")}

WORD-LEVEL TIMESTAMPS (all ${transcript.words.length} words):
${transcript.words.map((w) => `${w.word}(${w.start.toFixed(2)}-${w.end.toFixed(2)})`).join(" ")}

Find every great clip. Be thorough.`;

const fullPrompt = `SYSTEM INSTRUCTIONS:\n${systemPrompt}\n\n---\n\nUSER MESSAGE:\n${userMessage}`;

// Write prompt file
const promptPath = join(PROJECT_ROOT, "scripts", "_prompt_for_claude.txt");
writeFileSync(promptPath, fullPrompt);

// ─── 8. Print instructions ───────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    STEP 1 COMPLETE                               ║
╚══════════════════════════════════════════════════════════════════╝

✅ Transcript done. Now do this:

  1. Open this file and copy ALL of its contents:
     ${promptPath}

  2. Go to claude.ai and paste it into a new conversation

  3. Wait for Claude to respond with a JSON block

  4. Copy Claude's ENTIRE response

  5. Save it to this file (just paste and save):
     ${join(PROJECT_ROOT, "scripts", "_claude_response.txt")}

  6. Then run:
     node scripts/apply-clips.mjs

That's it — the rest is automatic.
`);
