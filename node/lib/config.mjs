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
export function getLoadlySection(config) {
  const l = config?.loadly;
  if (!l || typeof l !== 'object') return null;
  const apiKey = l.api_key?.trim();
  if (!apiKey) return null;
  const t = l.timeout_seconds;
  const timeoutSeconds =
    typeof t === 'number' && t >= 60 && t <= 1800 ? t : 600;
  return {
    api_key: apiKey,
    build_password: l.build_password?.trim() || undefined,
    build_update_description:
      typeof l.build_update_description === 'string'
        ? l.build_update_description
        : undefined,
    build_install_type:
      typeof l.build_install_type === 'number'
        ? l.build_install_type
        : undefined,
    build_channel_shortcut: l.build_channel_shortcut?.trim() || undefined,
    timeout_seconds: timeoutSeconds,
  };
}

/** @param {ReturnType<typeof loadConfigFile>} config */
export function getBuildportSection(config) {
  const b = config?.buildport;
  const apiToken =
    (typeof b?.api_token === 'string' ? b.api_token.trim() : '') ||
    process.env.BUILDPORT_API_TOKEN?.trim() ||
    '';
  if (!apiToken) return null;

  const t = b?.timeout_seconds;
  const timeoutSeconds =
    typeof t === 'number' && t >= 60 && t <= 1800 ? t : 600;

  return {
    api_token: apiToken,
    app_group:
      typeof b?.app_group === 'string' && b.app_group.trim()
        ? b.app_group.trim()
        : undefined,
    timeout_seconds: timeoutSeconds,
    changes_path:
      typeof b?.changes_path === 'string' && b.changes_path.trim()
        ? b.changes_path.trim()
        : undefined,
  };
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

/** @param {ReturnType<typeof loadConfigFile>} config */
export function getPrepareReleaseSection(config) {
  const r = config?.prepare_release;
  if (!r || typeof r !== 'object') return {};

  const out = {};
  if (Object.prototype.hasOwnProperty.call(r, 'tag_prefix')) {
    if (typeof r.tag_prefix !== 'string') {
      throw new Error(
        'prepare_release.tag_prefix must be a string (use "" for no prefix)',
      );
    }
    out.tag_prefix = r.tag_prefix;
  }
  if (Object.prototype.hasOwnProperty.call(r, 'changelog_paths')) {
    if (
      !Array.isArray(r.changelog_paths) ||
      r.changelog_paths.some((x) => typeof x !== 'string')
    ) {
      throw new Error(
        'prepare_release.changelog_paths must be an array of git pathspec strings',
      );
    }
    out.changelog_paths = r.changelog_paths;
  }
  return out;
}
