/**
 * Minute log files for debugging production: everything the API prints (Nest logger, console, stderr)
 * is also appended to one file per UTC minute, `<prefix>_YYYY-MM-DD_HH-MMZ.log`, so the minutes around a
 * bug are picked by name. Every `pruneEveryMs` the files older than the last `keepMinutes` minutes are
 * deleted: the last `keepMinutes` minutes are always there. See DEBUGGING.md for fetching them.
 *
 * Enabled by LOG_MINUTE_DIR (docker-compose mounts it on the host). stdout/stderr keep working as before
 * (`docker compose logs` is untouched).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MinuteLogOptions {
  dir: string;
  prefix?: string;
  keepMinutes?: number;
  pruneEveryMs?: number;
  now?: () => Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `api_2026-11-26_14-26Z.log` for any instant in 14:26 UTC. */
export function minuteLogName(prefix: string, at: Date): string {
  return `${prefix}_${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}_${pad(at.getUTCHours())}-${pad(at.getUTCMinutes())}Z.log`;
}

/** Start of the minute a file name stands for, or null for any other file. */
export function minuteOfLogName(prefix: string, name: string): number | null {
  const match = new RegExp(`^${prefix}_(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})Z\\.log$`).exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
}

/** Deletes the files of minutes before the last `keepMinutes` (the current minute counts as one). */
export function pruneMinuteLogs(dir: string, prefix: string, keepMinutes: number, now: Date): string[] {
  const currentMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const oldestKept = currentMinute - (keepMinutes - 1) * 60_000;
  const deleted: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return deleted; }
  for (const name of names) {
    const minute = minuteOfLogName(prefix, name);
    if (minute === null || minute >= oldestKept) continue;
    try { fs.unlinkSync(path.join(dir, name)); deleted.push(name); } catch { /* already gone */ }
  }
  return deleted;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function installMinuteLogFiles(options: MinuteLogOptions): { stop(): void } {
  const prefix = options.prefix ?? 'api';
  const keepMinutes = options.keepMinutes ?? 30;
  const pruneEveryMs = options.pruneEveryMs ?? 30 * 60_000;
  const now = options.now ?? (() => new Date());
  fs.mkdirSync(options.dir, { recursive: true });

  let openName: string | null = null;
  let stream: fs.WriteStream | null = null;
  const append = (chunk: unknown, encoding?: unknown) => {
    try {
      const name = minuteLogName(prefix, now());
      if (name !== openName) {
        stream?.end();
        openName = name;
        stream = fs.createWriteStream(path.join(options.dir, name), { flags: 'a' });
        stream.on('error', () => { stream = null; openName = null; });
      }
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString(typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8') : String(chunk);
      stream?.write(text.replace(ANSI, ''));
    } catch { /* logging must never break the API */ }
  };

  const tee = (target: NodeJS.WriteStream) => {
    const original = target.write.bind(target);
    target.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      append(chunk, encoding);
      return (original as (...args: unknown[]) => boolean)(chunk, encoding, callback);
    }) as typeof target.write;
    return () => { target.write = original as typeof target.write; };
  };
  const restoreOut = tee(process.stdout);
  const restoreErr = tee(process.stderr);

  const prune = () => { try { pruneMinuteLogs(options.dir, prefix, keepMinutes, now()); } catch { /* ignore */ } };
  prune();
  const timer = setInterval(prune, pruneEveryMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
      restoreOut();
      restoreErr();
      stream?.end();
      stream = null;
      openName = null;
    },
  };
}
