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

  if (res.ok) {
    console.log('Telegram notification sent successfully');
  } else {
    const err = await formatTelegramApiError(res);
    console.error(
      `Failed to send Telegram notification: ${res.status} - ${err}`,
    );
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

  if (res.ok) {
    console.log(`Telegram file sent successfully: ${path.basename(filePath)}`);
  } else {
    const err = await formatTelegramApiError(res);
    console.error(`Failed to send Telegram file: ${res.status} - ${err}`);
  }
}
