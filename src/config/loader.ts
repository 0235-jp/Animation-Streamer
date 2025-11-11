import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import ffprobeStatic from 'ffprobe-static';
import { streamProfileSchema } from './schema';
import type { StreamProfileConfig, MotionAsset } from '../types/stream';

const execFileAsync = promisify(execFile);
const FFPROBE_TIMEOUT_MS = Number(process.env.FFPROBE_TIMEOUT_MS ?? 4000);
const DEFAULT_FFPROBE_PATH = ffprobeStatic?.path ?? 'ffprobe';

async function ensureReadable(filePath: string): Promise<void> {
  await fs.access(filePath, fs.constants.R_OK);
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function probeMotionDuration(filePath: string): Promise<number | null> {
  const ffprobePath = process.env.FFPROBE_BIN || DEFAULT_FFPROBE_PATH;
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath
    ], { timeout: FFPROBE_TIMEOUT_MS });
    const parsed = JSON.parse(stdout);
    const durationValue = parsed?.format?.duration;
    const durationSeconds = durationValue ? Number(durationValue) : Number.NaN;
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return Math.round(durationSeconds * 1000);
    }
  } catch (err) {
    if (process.env.DEBUG_MEDIA_PROBE === 'true') {
      // eslint-disable-next-line no-console
      console.warn(`Failed to probe duration for ${filePath}:`, err);
    }
  }
  return null;
}

async function resolveMotions(baseDir: string, motions: MotionAsset[]): Promise<MotionAsset[]> {
  const resolved: MotionAsset[] = [];
  for (const motion of motions) {
    const absolutePath = path.resolve(baseDir, motion.path);
    await ensureReadable(absolutePath);
    const durationMs = await probeMotionDuration(absolutePath);
    resolved.push({ ...motion, path: absolutePath, durationMs });
  }
  return resolved;
}

export async function loadStreamProfile(configPath: string): Promise<StreamProfileConfig> {
  const absoluteConfigPath = path.resolve(configPath);
  const rawContent = await fs.readFile(absoluteConfigPath, 'utf-8');
  const parsed = streamProfileSchema.parse(JSON.parse(rawContent));
  const baseDir = path.dirname(absoluteConfigPath);
  const waitingMotions = await resolveMotions(baseDir, parsed.waitingMotions as MotionAsset[]);
  const speechMotions = await resolveMotions(baseDir, parsed.speechMotions as MotionAsset[]);
  const tempDir = path.resolve(baseDir, parsed.assets.tempDir);
  await ensureDirectory(tempDir);

  const profile: StreamProfileConfig = {
    server: parsed.server,
    rtmp: parsed.rtmp,
    waitingMotions,
    speechMotions,
    audioProfile: parsed.audioProfile,
    assets: { tempDir }
  };

  return profile;
}
