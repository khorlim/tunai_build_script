import { readFile } from 'fs/promises';
import path from 'path';
import { Blob } from 'node:buffer';

function threadIdField(topicId) {
  if (topicId === undefined || topicId === null) return undefined;
  const s = String(topicId).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

/**
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function formatTelegramApiError(res) {
  const text = await res.text();
  if (!text?.trim()) return '(empty response body)';
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && j.description) {
      return `${j.description} (ok=${j.ok})`;
    }
    return text;
  } catch {
    return text;
  }
}

/**
 * Telegram Bot API can return HTTP 200 with { ok: false }.
 * We must validate both HTTP and payload-level success.
 *
 * @param {Response} res
 * @returns {Promise<{ success: boolean, description: string, payload: any }>}
 */
async function parseTelegramResponse(res) {
  const text = await res.text();
  let payload = null;
  if (text?.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const description =
      payload && typeof payload === 'object' && payload.description
        ? `${payload.description} (ok=${payload.ok})`
        : text || '(empty response body)';
    return { success: false, description, payload };
  }

  if (payload && typeof payload === 'object' && payload.ok === false) {
    const description = payload.description || 'Telegram API returned ok=false';
    return { success: false, description, payload };
  }

  return { success: true, description: '', payload };
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  topicId,
}) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  const tid = threadIdField(topicId);
  if (tid !== undefined) body.message_thread_id = tid;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const parsed = await parseTelegramResponse(res);
  if (parsed.success) {
    console.log('Telegram notification sent successfully');
    return true;
  } else {
    const err =
      parsed.description ||
      (await formatTelegramApiError(res)) ||
      'Unknown Telegram error';
    console.error(
      `Failed to send Telegram notification: ${res.status} - ${err}`,
    );
    return false;
  }
}

/**
 * Uses Web **FormData** + **Blob** so native `fetch` builds a valid multipart body.
 * The npm `form-data` stream + `fetch` pair often yields **400** from Telegram.
 */
export async function sendTelegramDocument({
  botToken,
  chatId,
  filePath,
  topicId,
  caption,
}) {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const fileBytes = await readFile(filePath);
  const blob = new Blob([fileBytes]);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  const tid = threadIdField(topicId);
  if (tid !== undefined) form.append('message_thread_id', String(tid));
  if (caption) form.append('caption', caption);
  form.append('document', blob, path.basename(filePath));

  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });

  const parsed = await parseTelegramResponse(res);
  if (parsed.success) {
    console.log(`Telegram file sent successfully: ${path.basename(filePath)}`);
    return true;
  } else {
    const err =
      parsed.description ||
      (await formatTelegramApiError(res)) ||
      'Unknown Telegram error';
    console.error(`Failed to send Telegram file: ${res.status} - ${err}`);
    return false;
  }
}
