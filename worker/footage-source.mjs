import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { extname, join } from "path";
import { spawn, spawnSync } from "child_process";

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export function isYouTubeUrl(value) {
  try {
    const host = new URL(String(value || "").trim()).hostname.replace(/^www\./, "");
    return host === "youtube.com"
      || host === "m.youtube.com"
      || host === "music.youtube.com"
      || host === "youtu.be"
      || host === "youtube-nocookie.com";
  } catch {
    return false;
  }
}

export function ytDlpAvailable() {
  const result = spawnSync("yt-dlp", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

export function findDownloadedFootage(downloadsDir, projectId) {
  if (!existsSync(downloadsDir)) return null;

  const prefix = `${projectId}.`;
  const candidates = readdirSync(downloadsDir)
    .filter((file) => file.startsWith(prefix))
    .filter((file) => videoExtensions.has(extname(file).toLowerCase()))
    .map((file) => {
      const filePath = join(downloadsDir, file);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.filePath || null;
}

export async function downloadYouTubeToFile(url, project, downloadsDir) {
  mkdirSync(downloadsDir, { recursive: true });

  const existing = findDownloadedFootage(downloadsDir, project.id);
  if (existing) return existing;

  if (!ytDlpAvailable()) {
    throw new Error("yt-dlp is required to download YouTube footage. Install it with: brew install yt-dlp");
  }

  const outputTemplate = join(downloadsDir, `${project.id}.%(ext)s`);
  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", outputTemplate,
    url,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });

  const downloaded = findDownloadedFootage(downloadsDir, project.id);
  if (!downloaded) {
    throw new Error("yt-dlp finished but no downloaded video file was found.");
  }

  return downloaded;
}
