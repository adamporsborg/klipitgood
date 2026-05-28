#!/usr/bin/env node
/**
 * apply-clips.mjs — Step 2 of 2
 *
 * Usage: node scripts/apply-clips.mjs
 *
 * Reads _claude_response.txt, validates the JSON, writes src/clips-config.json,
 * and prints a summary of what was found.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const responsePath = process.argv[2]
  ? (process.argv[2].startsWith("/") ? process.argv[2] : join(process.cwd(), process.argv[2]))
  : join(__dirname, "_claude_response.txt");
const metaPath = join(__dirname, "_pending_meta.json");
const configPath = join(PROJECT_ROOT, "src", "clips-config.json");

if (!existsSync(responsePath)) {
  console.error(`\n⚠️  No response file found at:\n   ${responsePath}\n\nPaste Claude's response into that file and re-run.\n`);
  process.exit(1);
}

if (!existsSync(metaPath)) {
  console.error(`\n⚠️  No metadata found. Run analyze.mjs first.\n`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const raw = readFileSync(responsePath, "utf8").trim();

// Strip markdown code fences if Claude wrapped the JSON
const stripped = raw
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```\s*$/, "")
  .trim();

let clipsConfig;
try {
  clipsConfig = JSON.parse(stripped);
} catch (e) {
  // Try to extract JSON object from the response in case there's surrounding text
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      clipsConfig = JSON.parse(match[0]);
    } catch {
      console.error("\n⚠️  Could not parse JSON from Claude's response.");
      console.error("    Make sure you copied the full response including the opening { and closing }");
      console.error("\n    Parse error:", e.message, "\n");
      process.exit(1);
    }
  } else {
    console.error("\n⚠️  No JSON object found in the response file.");
    console.error("    Parse error:", e.message, "\n");
    process.exit(1);
  }
}

if (!clipsConfig.clips || !Array.isArray(clipsConfig.clips)) {
  console.error('\n⚠️  Response JSON must have a "clips" array at the top level.\n');
  process.exit(1);
}

// Attach video metadata
// Remotion IDs can't have underscores
clipsConfig.clips = clipsConfig.clips.map((c) => ({ ...c, id: c.id.replace(/_/g, "-") }));
clipsConfig.footage = meta.footage;
clipsConfig.footureWidth = meta.width;
clipsConfig.footureHeight = meta.height;
clipsConfig.generatedAt = new Date().toISOString();

writeFileSync(configPath, JSON.stringify(clipsConfig, null, 2));

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n✅ ${clipsConfig.clips.length} clips loaded from Claude's response:\n`);

let totalSpeechSecs = 0;
clipsConfig.clips.forEach((clip, i) => {
  const secs = clip.segments.reduce((acc, s) => acc + (s.to - s.from), 0);
  totalSpeechSecs += secs;
  const scoreBar = "█".repeat(Math.round(clip.score)) + "░".repeat(10 - Math.round(clip.score));
  console.log(`  ${String(i + 1).padStart(2)}. [${clip.score}/10] ${scoreBar}  ${clip.title}`);
  console.log(`      ${secs.toFixed(1)}s speech  |  ${clip.segments.length} segment(s)  |  ${clip.zoomKeyframes.length} zoom keyframes`);
  console.log(`      ${clip.why}`);
  console.log();
});

console.log(`   Total content: ${totalSpeechSecs.toFixed(0)}s across all clips`);
console.log(`\n📝 Written to: src/clips-config.json`);
console.log(`\n▶  Preview in Remotion Studio:   npm run dev`);
console.log(`   Render all clips to output/:   node scripts/render-all.mjs\n`);
