import fs from 'fs';
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

function telegramDeliveryResult(payload, fallbackChatId, fallbackTopicId) {
  const result = payload?.result;
  const messageId = result?.message_id;
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new Error(
      'Telegram accepted the request without returning a valid result.message_id',
    );
  }
  return {
    ok: true,
    messageId,
    chatId: String(result?.chat?.id ?? fallbackChatId),
    topicId: result?.message_thread_id ?? fallbackTopicId ?? null,
  };
}

function writeTelegramReceipt(receiptPath, delivery, result) {
  if (!receiptPath) return;
  if (!path.isAbsolute(receiptPath)) {
    throw new Error('Telegram receipt path must be absolute');
  }
  const parent = path.dirname(receiptPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`Telegram receipt directory does not exist: ${parent}`);
  }

  let receipt = { schema: 1, deliveries: [] };
  if (fs.existsSync(receiptPath)) {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt?.schema !== 1 || !Array.isArray(receipt.deliveries)) {
      throw new Error(`Invalid Telegram delivery receipt: ${receiptPath}`);
    }
  }

  const deliveredAt = new Date().toISOString();
  receipt.deliveries.push({
    ...delivery,
    kind: delivery?.kind ?? 'message',
    message_id: result.messageId,
    chat_id: result.chatId,
    message_thread_id: result.topicId,
    delivered_at: deliveredAt,
  });
  receipt.updated_at = deliveredAt;

  const temporaryPath = `${receiptPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const descriptor = fs.openSync(temporaryPath, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, receiptPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function persistTelegramReceipt(receiptPath, delivery, result) {
  try {
    writeTelegramReceipt(receiptPath, delivery, result);
  } catch (error) {
    throw new Error(
      `Telegram delivered message_id=${result.messageId}, but its receipt could not be persisted: ${error?.message ?? error}`,
    );
  }
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  topicId,
  receiptPath,
  receipt,
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
    const result = telegramDeliveryResult(parsed.payload, chatId, tid);
    persistTelegramReceipt(
      receiptPath,
      { ...receipt, kind: 'message' },
      result,
    );
    console.log(
      `Telegram notification sent successfully (message_id=${result.messageId})`,
    );
    return result;
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
  receiptPath,
  receipt,
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
    const result = telegramDeliveryResult(parsed.payload, chatId, tid);
    persistTelegramReceipt(
      receiptPath,
      {
        ...receipt,
        kind: 'document',
        file_name: path.basename(filePath),
      },
      result,
    );
    console.log(
      `Telegram file sent successfully: ${path.basename(filePath)} (message_id=${result.messageId})`,
    );
    return result;
  } else {
    const err =
      parsed.description ||
      (await formatTelegramApiError(res)) ||
      'Unknown Telegram error';
    console.error(`Failed to send Telegram file: ${res.status} - ${err}`);
    return false;
  }
}
