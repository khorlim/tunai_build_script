const MAX_NOTES_CHARS = 1500;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function platformLabel(platform) {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  return String(platform || '');
}

// Telegram HTML supports only a few tags, so release-note Markdown is reduced
// to bold headings, bullets, bold/italic/code and http links.
function inlineToTelegram(text) {
  const codes = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  html = html
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<i>$2</i>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<i>$2</i>');
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index) => codes[Number(index)]);
}

/** Converts release-note Markdown to Telegram HTML lines, capped in length. */
export function notesToTelegram(markdown, maxChars = MAX_NOTES_CHARS) {
  const lines = [];
  let used = 0;
  let truncated = false;
  let inCode = false;
  for (const raw of String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    let line;
    if (inCode) {
      line = `<code>${escapeHtml(raw)}</code>`;
    } else if (!raw.trim()) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      continue;
    } else {
      const heading = raw.match(/^\s*#{1,6}\s+(.*)$/);
      const item = raw.match(/^(\s*)(?:[-*•+]|(\d+)[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
      if (heading) line = `<b>${inlineToTelegram(heading[1])}</b>`;
      else if (item) {
        const indent = '  '.repeat(Math.min(Math.floor(item[1].replace(/\t/g, '  ').length / 2), 3));
        line = `${indent}${item[2] ? `${item[2]}.` : '•'} ${inlineToTelegram(item[3])}`;
      } else line = inlineToTelegram(raw.trim());
    }
    if (used + line.length > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { text: lines.join('\n'), truncated };
}

/**
 * Telegram HTML message for a build uploaded to BuildPort.
 *
 * @param {object} params
 * @param {string} params.platform  'ios' | 'android'
 * @param {string} params.version   Version the build script built
 * @param {string} params.fallbackAppName  Used when BuildPort returns no app name
 * @param {{ url: string, response?: object }} params.upload  Result of uploadToBuildport
 */
export function formatBuildportUploadMessage({ platform, version, fallbackAppName, upload }) {
  const response = upload?.response || {};
  const appName = response.app_name || fallbackAppName || 'App';
  const releaseVersion = response.release_version || version;
  const trackName = response.track?.name;

  const lines = [
    `✅ <b>${escapeHtml(appName)} ${escapeHtml(releaseVersion)}</b> is ready to test`,
    [platformLabel(platform), trackName ? `Track: <b>${escapeHtml(trackName)}</b>` : null]
      .filter(Boolean)
      .join(' · '),
  ];

  const notes = notesToTelegram(response.notes);
  if (notes.text) {
    lines.push('', notes.text);
    if (notes.truncated) lines.push('…more on the install page');
  }

  lines.push('', '📲 <b>Install</b>', escapeHtml(upload.url));
  return lines.join('\n');
}
