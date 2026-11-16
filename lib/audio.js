/**
 * Transcrição de áudio via OpenAI Whisper (opcional).
 * Ativado quando OPENAI_API_KEY estiver configurado.
 * Z-API envia áudio como URL ou base64 no campo audioUrl / audio.base64.
 */
import { logger } from './logger.js';

/** Baixa o áudio de uma URL e retorna como Buffer */
async function baixarAudio(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar áudio`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Transcreve áudio usando Whisper API.
 * Retorna texto transcrito ou null se não disponível.
 */
export async function transcreverAudio(audioUrl, audioBase64, mimeType = 'audio/ogg') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('[AUDIO] OPENAI_API_KEY não configurada — transcrição de áudio desabilitada');
    return null;
  }

  try {
    let buffer;
    if (audioBase64) {
      buffer = Buffer.from(audioBase64, 'base64');
    } else if (audioUrl) {
      buffer = await baixarAudio(audioUrl);
    } else {
      return null;
    }

    // Whisper aceita multipart/form-data
    const { FormData, Blob } = await import('node:buffer').catch(() => {
      return { FormData: globalThis.FormData, Blob: globalThis.Blob };
    });

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), 'audio.ogg');
    form.append('model', 'whisper-1');
    // Sem language fixo — Whisper detecta automaticamente

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Whisper HTTP ${r.status}: ${err}`);
    }

    const json = await r.json();
    logger.info('[AUDIO] transcrição concluída', { chars: json.text?.length });
    return json.text ?? null;

  } catch (e) {
    logger.error('[AUDIO] falha na transcrição', e.message);
    return null;
  }
}

/** Extrai dados de áudio do payload Z-API */
export function extrairAudioPayload(payload) {
  // Z-API: campo "audio" com subcampos audioUrl ou base64
  if (payload?.audio?.audioUrl) return { url: payload.audio.audioUrl, base64: null };
  if (payload?.audio?.base64)   return { url: null, base64: payload.audio.base64 };
  if (payload?.type === 'AudioCallback' && payload?.audio) {
    return { url: payload.audio, base64: null };
  }
  return null;
}
