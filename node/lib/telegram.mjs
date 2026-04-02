import { createReadStream } from 'fs';
import path from 'path';
import FormData from 'form-data';

function threadIdField(topicId) {
  if (topicId === undefined || topicId === null) return undefined;
  const s = String(topicId).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
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
    const err = await res.text();
    console.error(
      `Failed to send Telegram notification: ${res.status} - ${err}`,
    );
  }
}

export async function sendTelegramDocument({
  botToken,
  chatId,
  filePath,
  topicId,
  caption,
}) {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const form = new FormData();
  form.append('chat_id', chatId);
  const tid = threadIdField(topicId);
  if (tid !== undefined) form.append('message_thread_id', String(tid));
  if (caption) form.append('caption', caption);
  form.append('document', createReadStream(filePath), {
    filename: path.basename(filePath),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: form.getHeaders(),
    body: form,
  });

  if (res.ok) {
    console.log(`Telegram file sent successfully: ${path.basename(filePath)}`);
  } else {
    const err = await res.text();
    console.error(`Failed to send Telegram file: ${res.status} - ${err}`);
  }
}
