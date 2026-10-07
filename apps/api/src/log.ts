/** Minimal structured logger (JSON lines in production, readable in dev). */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let min: Level = (process.env.LOG_LEVEL as Level) || 'info';
const json = process.env.NODE_ENV === 'production';

export function setLogLevel(level: Level) {
  min = level;
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (order[level] < order[min]) return;
  if (process.env.VITEST && level !== 'error') return;
  const line = json
    ? JSON.stringify({ t: new Date().toISOString(), level, msg, ...data })
    : `${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, d?: Record<string, unknown>) => write('debug', m, d),
  info: (m: string, d?: Record<string, unknown>) => write('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => write('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => write('error', m, d),
};
