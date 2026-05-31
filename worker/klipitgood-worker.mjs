#!/usr/bin/env node
/**
 * Supabase bridge for the existing KlipitGood clipping engine.
 *
 * This intentionally wraps scripts/process.mjs instead of changing it.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, dirname, extname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { downloadYouTubeToFile, isYouTubeUrl } from "./footage-source.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const downloadsDir = join(rootDir, "tmp", "submissions");

const args = process.argv.slice(2);
const get = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const has = (flag) => args.includes(flag);

const projectId = get("--project");
const once = has("--once");
const dryRun = has("--dry-run");
const noRender = has("--no-render");
const aiProvider = get("--ai-provider", process.env.KLIPITGOOD_AI_PROVIDER || null);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const workerApiUrl = process.env.KLIPITGOOD_WORKER_API_URL || "";
const workerToken = process.env.KLIPITGOOD_WORKER_TOKEN || "";
const outputBaseUrl = process.env.KLIPITGOOD_OUTPUT_BASE_URL || "";

const useWorkerApi = Boolean(workerApiUrl);
if (useWorkerApi && !workerToken) {
  console.error("Missing KLIPITGOOD_WORKER_TOKEN for KLIPITGOOD_WORKER_API_URL mode.");
  process.exit(1);
}

if (!useWorkerApi && (!supabaseUrl || !supabaseKey)) {
  console.error("Missing Supabase env. Set either:");
  console.error("  KLIPITGOOD_WORKER_API_URL + KLIPITGOOD_WORKER_TOKEN");
  console.error("  or VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (!projectId && !once) {
  console.error("Usage: npm run worker -- --project <id> [--dry-run] [--no-render]");
  console.error("   or: npm run worker:once");
  process.exit(1);
}

const supabase = !useWorkerApi ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

function slug(value, fallback = "project") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || fallback;
}

function seconds(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicClipUrl(file) {
  if (!outputBaseUrl) return `file://${join(outputDir, file)}`;
  return `${outputBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

function mergeIntake(project, patch) {
  return {
    ...(project.intake_data || {}),
    worker: {
      ...((project.intake_data || {}).worker || {}),
      ...patch,
    },
  };
}

async function updateProject(project, patch, workerPatch = {}) {
  if (useWorkerApi) {
    await workerRequest("/project/update", {
      project_id: project.id,
      patch,
      worker_patch: workerPatch,
    });
    return;
  }

  const update = {
    ...patch,
    intake_data: mergeIntake(project, workerPatch),
  };

  const { error } = await supabase.from("projects").update(update).eq("id", project.id);
  if (error) throw new Error(`Could not update project ${project.id}: ${error.message}`);
}

async function workerRequest(path, body) {
  const response = await fetch(`${workerApiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${workerToken}`,
    },
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(payload.error || `Worker API ${path} failed with ${response.status}`);
  }

  return payload;
}

async function loadProject() {
  if (useWorkerApi) {
    const payload = await workerRequest("/project/claim", { project_id: projectId || null });
    return payload.project || null;
  }

  if (projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (error) throw new Error(`Could not load project ${projectId}: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .in("status", ["new", "queued", "submitted"])
    .not("footage_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load next project: ${error.message}`);
  return data;
}

async function downloadToFile(url, project) {
  mkdirSync(downloadsDir, { recursive: true });

  let extension = extname(new URL(url).pathname);
  if (!extension || extension.length > 8) extension = ".mp4";

  const target = join(downloadsDir, `${project.id}${extension}`);
  if (existsSync(target)) return target;

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download footage (${response.status} ${response.statusText})`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  return target;
}

async function resolveFootage(project) {
  const source = String(project.footage_url || "").trim();
  if (!source) throw new Error("Project has no footage_url.");

  if (source.startsWith("file://")) {
    const path = decodeURIComponent(new URL(source).pathname);
    if (!existsSync(path)) throw new Error(`Local footage file does not exist: ${path}`);
    return path;
  }

  if (isAbsolute(source)) {
    if (!existsSync(source)) throw new Error(`Local footage file does not exist: ${source}`);
    return source;
  }

  if (/^https?:\/\//i.test(source)) {
    if (isYouTubeUrl(source)) {
      return downloadYouTubeToFile(source, project, downloadsDir);
    }

    return downloadToFile(source, project);
  }

  throw new Error(`Unsupported footage_url. Use a local path, file:// URL, YouTube URL, or direct https URL: ${source}`);
}

/**
 * parseBrief(text) — reads the serialized creative brief from the portal.
 * Brief lines look like:  DIRECTIVE: ...\nJUMP_CUTS: none\nCAPTIONS: off\n...
 * Returns an object with parsed values, falling back to defaults.
 */
function parseBrief(text = "") {
  const lines = text.split("\n");
  const get = (key) => {
    const line = lines.find(l => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : null;
  };
  return {
    directive:     get("DIRECTIVE"),
    jumpCuts:      get("JUMP_CUTS"),      // "none" | null
    captions:      get("CAPTIONS"),       // "off" | null
    captionStyle:  get("CAPTION_STYLE"),  // "bold-pop" | "word-pop" | "minimal"
    clipLength:    get("CLIP_LENGTH"),    // "15-30s" | "30-60s" | "60-90s" | "any"
    contentType:   get("CONTENT_TYPE"),   // "solo" | "interview" | "presentation" | "auto"
    referenceUrl:  get("REFERENCE_CLIP"),
  };
}

function processArgs(project, footagePath, label) {
  const intake = project.intake_data || {};

  // Parse structured brief from clip_goal if it contains brief directives
  const rawBrief = intake.clipGoal || intake.clip_goal || intake.userDirective || "";
  const brief = parseBrief(rawBrief);

  // Build notes — directive goes first, then any legacy context fields
  const notes = [
    brief.directive || rawBrief, // user's free-text prompt
    brief.referenceUrl ? `STYLE REFERENCE: ${brief.referenceUrl}` : null,
    brief.clipLength && brief.clipLength !== "any"
      ? `CLIP LENGTH CONSTRAINT: All clips must be ${brief.clipLength}. Hard cap — reject anything outside this range.`
      : null,
    project.prompt !== rawBrief ? project.prompt : null, // avoid duplicating if same text
    intake.notes,
    intake.business,
    intake.offer,
    intake.audience,
  ].filter(Boolean).join("\n\n");

  // Map brief contentType → process.mjs --type flag
  const contentTypeMap = { auto: null, solo: "solo", interview: "interview", presentation: "presentation" };
  const resolvedType = contentTypeMap[brief.contentType] || intake.content_type || intake.contentType || "solo";

  const command = [
    "scripts/process.mjs",
    "--footage", footagePath,
    "--type",   resolvedType,
    "--goal",   intake.goal || "short",
    "--style",  intake.style || "natural",
    "--label",  label,
  ];

  if (notes) command.push("--notes", notes);
  if (intake.subject) command.push("--subject", intake.subject);

  // Brief-driven flags — these override defaults
  const captionStyle = brief.captionStyle || intake.caption_style || "bold-pop";
  if (brief.captions === "off") {
    command.push("--no-captions");
  } else {
    command.push("--caption-style", captionStyle);
  }

  if (brief.jumpCuts === "none") command.push("--no-jump-cuts");

  if (intake.ai_provider || aiProvider) command.push("--ai-provider", intake.ai_provider || aiProvider);
  if (noRender) command.push("--no-render");

  return command;
}

function runProcess(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", command, {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`process.mjs exited with code ${code}`));
    });
  });
}

async function uploadClipToStorage(localFilePath, projectId) {
  if (!supabase) return null;
  const filename = basename(localFilePath);
  const storagePath = `clips/${projectId}/${filename}`;
  const fileBuffer = readFileSync(localFilePath);

  const { error } = await supabase.storage
    .from("klipitgood-uploads")
    .upload(storagePath, fileBuffer, { contentType: "video/mp4", upsert: true });

  if (error) {
    console.warn(`  ⚠ Storage upload failed for ${filename}: ${error.message}`);
    return null;
  }

  const { data } = supabase.storage
    .from("klipitgood-uploads")
    .getPublicUrl(storagePath);

  console.log(`  ✓ Uploaded to Storage: ${filename}`);
  return data.publicUrl;
}

async function saveClips(project, deliverySummaryPath) {
  if (!existsSync(deliverySummaryPath)) {
    throw new Error(`Delivery summary was not created: ${deliverySummaryPath}`);
  }

  const delivery = JSON.parse(readFileSync(deliverySummaryPath, "utf8"));

  // Upload each clip to Supabase Storage so the portal can serve public URLs
  const rows = await Promise.all((delivery.clips || []).map(async (clip) => {
    const localPath = join(outputDir, clip.file);
    const publicUrl = existsSync(localPath)
      ? await uploadClipToStorage(localPath, project.id)
      : null;
    const url = publicUrl || publicClipUrl(clip.file);

    return {
      project_id: project.id,
      title: clip.title,
      score: clip.score,
      description: clip.why || null,
      duration_seconds: seconds(clip.duration),
      caption: clip.caption || null,
      thumbnail_url: null,
      download_url: url,
      preview_url: url,
    };
  }));

  if (!rows.length) throw new Error("Delivery summary contains no clips.");

  if (useWorkerApi) {
    await workerRequest("/project/complete", {
      project_id: project.id,
      clips: rows,
      admin_message: `Your clips are ready. I found ${rows.length} strong clips and sorted them by score.`,
      worker_patch: {
        completed_at: new Date().toISOString(),
        delivery_summary_path: deliverySummaryPath,
        clips_inserted: rows.length,
      },
    });
    return { delivery, count: rows.length };
  }

  const { error } = await supabase.from("clips").insert(rows);
  if (error) throw new Error(`Could not insert clips: ${error.message}`);

  return { delivery, count: rows.length };
}

async function main() {
  const project = await loadProject();
  if (!project) {
    console.log("No queued projects found.");
    return;
  }

  const footagePath = await resolveFootage(project);
  const label = `kg_${slug(project.title || basename(footagePath, extname(footagePath)))}_${project.id.slice(0, 8)}`;
  const command = processArgs(project, footagePath, label);
  const deliverySummaryPath = join(outputDir, `${label}_delivery.json`);

  console.log(`Project: ${project.id}`);
  console.log(`Footage: ${footagePath}`);
  console.log(`Command: node ${command.map((part) => JSON.stringify(part)).join(" ")}`);

  if (dryRun) return;

  await updateProject(project, { status: "processing" }, {
    started_at: new Date().toISOString(),
    footage_path: footagePath,
    label,
  });

  try {
    await runProcess(command);

    if (noRender) {
      await updateProject(project, { status: "analyzed" }, {
        completed_at: new Date().toISOString(),
        delivery_summary_path: deliverySummaryPath,
      });
      return;
    }

    const { count } = await saveClips(project, deliverySummaryPath);
    if (!useWorkerApi) {
      await updateProject(project, {
        status: "completed",
        admin_message: `Your clips are ready. I found ${count} strong clips and sorted them by score.`,
      }, {
        completed_at: new Date().toISOString(),
        delivery_summary_path: deliverySummaryPath,
        clips_inserted: count,
      });
    }

    console.log(`Saved ${count} clips to Supabase.`);
  } catch (error) {
    await updateProject(project, { status: "failed" }, {
      failed_at: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
