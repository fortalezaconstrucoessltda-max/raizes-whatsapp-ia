import { logger } from './logger.js';

const BASE = () =>
  `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;

const HEADERS = () => ({
  'Content-Type': 'application/json',
  'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
});

/** Normaliza número: remove tudo que não é dígito, garante prefixo 55 */
export function normalizarFone(numero) {
  let n = String(numero).replace(/\D/g, '');
  if (!n.startsWith('55') && n.length <= 11) n = '55' + n;
  return n;
}

/** Simula "digitando..." antes de enviar — humaniza o atendimento */
export async function simularDigitando(numero, mensagem) {
  const phone = normalizarFone(numero);
  // Z-API quer SEGUNDOS (não ms). Entre 3s e 6s proporcional ao tamanho.
  const segundos = Math.min(Math.max(3 + Math.floor(mensagem.length / 80), 3), 6);
  try {
    await fetch(`${BASE()}/send-typing`, {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify({ phone, time: segundos }),
    });
  } catch { /* silencioso — não bloqueia o envio */ }
  await new Promise(r => setTimeout(r, segundos * 1000));
}

/** Envia mensagem de texto */
export async function enviarTexto(numero, mensagem) {
  const phone = normalizarFone(numero);
  try {
    const r = await fetch(`${BASE()}/send-text`, {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify({ phone, message: mensagem }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(json));
    logger.info(`[ZAPI] texto enviado → ${phone}`, { messageId: json.messageId });
    return json;
  } catch (e) {
    logger.error(`[ZAPI] falha ao enviar texto → ${phone}`, e.message);
    return null;
  }
}

/** Verifica se o número está conectado/ativo no WhatsApp */
export async function verificarNumero(numero) {
  const phone = normalizarFone(numero);
  try {
    const r = await fetch(`${BASE()}/phone-exists?phone=${phone}`, { headers: HEADERS() });
    const json = await r.json();
    return json?.exists === true;
  } catch {
    return false;
  }
}

/** Busca informações do contato (nome salvo no WhatsApp) */
export async function infoContato(numero) {
  const phone = normalizarFone(numero);
  try {
    const r = await fetch(`${BASE()}/contacts?phone=${phone}`, { headers: HEADERS() });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Configura webhook no Z-API */
export async function configurarWebhook(webhookUrl, secret) {
  try {
    const r = await fetch(`${BASE()}/update-webhook`, {
      method: 'PUT',
      headers: HEADERS(),
      body: JSON.stringify({
        webhookUrl,
        webhookByEvents: false,
        base64: false,
      }),
    });
    const json = await r.json();
    logger.info('[ZAPI] webhook configurado', { url: webhookUrl, resp: json });
    return json;
  } catch (e) {
    logger.error('[ZAPI] falha ao configurar webhook', e.message);
    return null;
  }
}

/** Status da instância (conexão) */
export async function statusInstancia() {
  try {
    const r = await fetch(`${BASE()}/status`, { headers: HEADERS() });
    return await r.json();
  } catch (e) {
    logger.error('[ZAPI] falha ao verificar status', e.message);
    return null;
  }
}
