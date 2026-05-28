import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultEngineRoot = path.resolve(__dirname, '..', '..', 'my-videos');

export const engineRoot = process.env.KLIPITGOOD_ENGINE_ROOT || defaultEngineRoot;
export const outputDir = path.join(engineRoot, 'output');
export const uploadDir = process.env.KLIPITGOOD_UPLOAD_DIR || path.join(engineRoot, 'tmp', 'portal-uploads');

const QUEUED_STATUSES = new Set(['new', 'queued', 'submitted']);
const PROJECT_PATCH_FIELDS = new Set(['status', 'admin_message']);

export function sanitizeFilename(value) {
  const cleaned = String(value || 'footage.mp4')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return cleaned || 'footage.mp4';
}

export function ensureUploadDir() {
  mkdirSync(uploadDir, { recursive: true });
  return uploadDir;
}

export function selectNextQueuedProject(projects = [], projectId = null) {
  if (projectId) return projects.find((project) => project.id === projectId) || null;

  return projects
    .filter((project) => QUEUED_STATUSES.has(project.status))
    .filter((project) => String(project.footage_url || '').trim())
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0] || null;
}

export function buildWorkerProjectUpdate(project, patch = {}, workerPatch = {}) {
  const cleanPatch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (PROJECT_PATCH_FIELDS.has(key)) cleanPatch[key] = value;
  }

  return {
    ...cleanPatch,
    intake_data: {
      ...(project.intake_data || {}),
      worker: {
        ...((project.intake_data || {}).worker || {}),
        ...(workerPatch || {})
      }
    }
  };
}

export function isAllowedClipUrl(value) {
  const url = String(value || '').trim();
  if (!url) return true;
  if (/^https?:\/\//i.test(url)) return true;

  if (url.startsWith('file://')) {
    const filePath = decodeURIComponent(new URL(url).pathname);
    return path.normalize(filePath).startsWith(path.normalize(outputDir));
  }

  return false;
}

export function normalizeClipRows(projectId, clips = []) {
  return clips.map((clip, index) => {
    const title = String(clip.title || `Clip ${index + 1}`).trim().slice(0, 160);
    const thumbnailUrl = String(clip.thumbnail_url || '').trim() || null;
    const downloadUrl = String(clip.download_url || '').trim() || null;
    const previewUrl = String(clip.preview_url || '').trim() || downloadUrl;

    if (!isAllowedClipUrl(thumbnailUrl) || !isAllowedClipUrl(downloadUrl) || !isAllowedClipUrl(previewUrl)) {
      throw new Error('Worker returned a clip URL outside the allowed output folder.');
    }

    return {
      project_id: projectId,
      title,
      score: Number.isFinite(Number(clip.score)) ? Number(clip.score) : null,
      description: String(clip.description || '').trim().slice(0, 2000) || null,
      duration_seconds: Number.isFinite(Number(clip.duration_seconds)) ? Number(clip.duration_seconds) : null,
      thumbnail_url: thumbnailUrl,
      download_url: downloadUrl,
      preview_url: previewUrl
    };
  });
}

export function uploadedFootagePath(filename) {
  ensureUploadDir();
  return path.join(uploadDir, `${Date.now()}-${sanitizeFilename(filename)}`);
}

export function engineReady() {
  return existsSync(path.join(engineRoot, 'scripts', 'klipitgood-worker.mjs'));
}
