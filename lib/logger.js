// Structured logger — prefixes every line with ISO timestamp and level
const levels = { INFO: '✅', WARN: '⚠️', ERROR: '❌', DEBUG: '🔍' };

function log(level, msg, data) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}]`;
  if (data !== undefined) {
    console.log(prefix, msg, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(prefix, msg);
  }
}

export const logger = {
  info:  (msg, data) => log('INFO',  msg, data),
  warn:  (msg, data) => log('WARN',  msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  debug: (msg, data) => log('DEBUG', msg, data),
};
