import fs from 'fs';

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function interpolateString(str) {
  if (typeof str !== 'string') return str;
  return str.replaceAll(ENV_PATTERN, (_, name) => {
    const v = process.env[name];
    return v !== undefined && v !== '' ? v : '';
  });
}

/** Deep-interpolate ${VAR} in all string values. Mutates plain objects. */
export function interpolateEnv(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return interpolateString(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = interpolateEnv(value[i]);
    }
    return value;
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) {
      value[k] = interpolateEnv(value[k]);
    }
    return value;
  }
  return value;
}

export function loadConfigFile(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const data = JSON.parse(raw);
  return interpolateEnv(data);
}

/** @param {ReturnType<typeof loadConfigFile>} config */
export function getApphostSection(config) {
  return config?.apphost ?? null;
}

/** @param {ReturnType<typeof loadConfigFile>} config */
export function getTelegramSection(config) {
  const t = config?.telegram;
  if (!t || typeof t !== 'object') return null;
  const botToken = t.bot_token?.trim();
  const chatId = t.chat_id?.trim();
  if (!botToken || !chatId) return null;
  return {
    bot_token: botToken,
    chat_id: chatId,
    topic_id: t.topic_id?.trim() || undefined,
  };
}
