#!/usr/bin/env node
/**
 * director-pass.mjs — AI editorial review before rendering
 *
 * WHAT IT DOES:
 *   Reads each _response_file_XX.txt (raw AI clip JSON) and generates a
 *   _director_prompt_file_XX.txt for each one. You paste that into Claude,
 *   save the response as _director_response_file_XX.txt, then run:
 *
 *     node scripts/batch-apply.mjs --use-director
 *
 *   The Director is a second Claude pass that acts as a critical editor:
 *   - Checks every cut point has a zoom change
 *   - Verifies segment starts/ends are on word boundaries, not in silence
 *   - Checks for robotic double-cuts or cuts too close together
 *   - Improves zoom rhythm and timing
 *   - Removes clips that won't survive the edit (too choppy, no payoff)
 *   - Can promote clips it thinks are underscored
 *
 * Usage:
 *   node scripts/director-pass.mjs
 *   → generates scripts/_director_prompt_file_XX.txt for each label
 *
 *   Then for each file:
 *     1. Open _director_prompt_file_XX.txt, copy all
 *     2. Paste into a new claude.ai conversation
 *     3. Save the response as scripts/_director_response_file_XX.txt
 *
 *   Then render using the improved clips:
 *     node scripts/batch-apply.mjs --use-director
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LABELS = ["file_02", "file_03", "file_04", "file_05"];

const directorSystemPrompt = `You are a senior video editor and creative director specializing in short-form social content. Your job is NOT to create new clips — it is to critically review a set of already-defined clips and improve their execution.

You will receive a JSON object containing clips with segments and zoom keyframes. Your job is to review every clip and return an IMPROVED version of the same JSON.

WHAT TO FIX:

1. ZOOM AT EVERY CUT (most important)
   Every segment boundary represents a removed pause — a cut where the speaker jumped position. If two adjacent segments have the same zoom scale, the jump will look like a glitch. EVERY gap cut must have a different scale than the previous segment.
   - Scan every clip's zoomKeyframes. There must be a keyframe at the START of every segment (clipTimeSeconds matching the cumulative start of that segment in clip time).
   - Adjacent segments: alternate 1.10 ↔ 1.18, or use emphasis zooms (1.20–1.25) on strong statements.
   - If a clip is missing keyframes at segment boundaries, ADD them.

2. RHYTHM AND TIMING
   - Segment starts should hit on the beat of speech — the instant the first consonant of a word fires. Check that no segment starts in trailing silence from the previous word.
   - Cuts should land at the natural end of a phrase or thought, not mid-breath mid-word.
   - If two segments are very close together (< 2s apart), consider whether the combined content flows better as one segment with a preserved breath, rather than two segments with a cut.

3. CLIP QUALITY AUDIT
   - Flag and REMOVE any clip where the segments, when played back, would feel choppy, incoherent, or confusing without context.
   - If a clip score seems too high for its content, correct it down.
   - If a clip is a strong standalone moment but was underscored, correct it up.
   - Clips under 10 seconds of total speech are usually too short unless the content is exceptionally punchy.

4. DO NOT:
   - Change segment timestamps by more than ±0.3 seconds.
   - Add new clips that didn't exist in the original.
   - Remove more than 20% of clips (only remove genuinely broken ones).
   - Change titles, IDs, or the "why" field.

OUTPUT: Return the full clips JSON object with all improvements applied. ONLY return raw JSON — no markdown, no explanation, no commentary.`;

let generated = 0;

for (const label of LABELS) {
  const responsePath = join(__dirname, `_response_${label}.txt`);
  const metaPath     = join(__dirname, `_meta_${label}.json`);

  if (!existsSync(responsePath)) {
    console.log(`⏭  Skipping ${label} — no response file`);
    continue;
  }
  if (!existsSync(metaPath)) {
    console.log(`⚠  Skipping ${label} — no meta file`);
    continue;
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const raw  = readFileSync(responsePath, "utf8").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // Build the director prompt
  const directorPrompt = [
    `SYSTEM:`,
    directorSystemPrompt,
    ``,
    `---`,
    ``,
    `USER:`,
    `VIDEO FILE: ${meta.footage}  (duration: ${meta.duration?.toFixed(1) ?? "?"}s)`,
    ``,
    `Review and improve the following clip definitions. Return only the corrected JSON.`,
    ``,
    `CLIP JSON TO REVIEW:`,
    raw,
  ].join("\n");

  const outPath = join(__dirname, `_director_prompt_${label}.txt`);
  writeFileSync(outPath, directorPrompt);
  console.log(`📋 Director prompt saved: scripts/_director_prompt_${label}.txt`);
  generated++;
}

if (generated === 0) {
  console.log(`\n⚠  No response files found. Run batch-analyze.mjs first.\n`);
} else {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              DIRECTOR PROMPTS READY                      ║
╚══════════════════════════════════════════════════════════╝

For each _director_prompt_file_XX.txt:

  1. Open the file, select all, copy
  2. Paste into a new claude.ai conversation
  3. Copy Claude's JSON response
  4. Save as scripts/_director_response_file_XX.txt

Then render the director-approved clips:
  node scripts/batch-apply.mjs --use-director

The director-approved clips will render as the next version
with all timing and zoom issues corrected.
`);
}
