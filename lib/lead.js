/**
 * Operações de Lead — busca, cria, atualiza, registra mensagens.
 * Todo acesso ao CRM passa por aqui.
 */
import { base44 } from './base44.js';
import { logger } from './logger.js';
import { normalizarFone } from './zapi.js';

/** Detecta idioma pela mensagem (heurística + lista de palavras-chave) */
export function detectarIdioma(texto) {
  if (!texto) return 'pt';
  const t = texto.toLowerCase();
  if (/\b(hello|hi|invest|interest|return|how|what|when)\b/.test(t)) return 'en';
  if (/\b(hola|invertir|interés|cómo|cuándo|qué)\b/.test(t)) return 'es';
  if (/\b(bonjour|investir|intérêt|comment|quand|merci)\b/.test(t)) return 'fr';
  if (/\b(hallo|investieren|interesse|wie|wann|danke)\b/.test(t)) return 'de';
  if (/\b(مرحبا|استثمار|كيف|متى)\b/.test(t)) return 'ar';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/\b(ciao|investire|interesse|come|quando|grazie)\b/.test(t)) return 'it';
  return 'pt';
}

/** Busca lead pelo número de WhatsApp. Retorna null se não encontrar. */
export async function buscarLeadPorFone(fone) {
  const normalizado = normalizarFone(fone);
  try {
    const res = await base44.Lead.list({ limit: 10 });
    const lista = Array.isArray(res) ? res : (res?.items ?? []);
    return lista.find(l => normalizarFone(l.whatsapp || '') === normalizado) ?? null;
  } catch (e) {
    logger.error('[LEAD] falha ao buscar por fone', e.message);
    return null;
  }
}

/** Cria novo lead a partir de uma mensagem recebida */
export async function criarLeadWhatsApp({ fone, nome, mensagem, idioma, afiliadoCodigo }) {
  const payload = {
    nome: nome || 'Desconhecido',
    whatsapp: normalizarFone(fone),
    origem: 'whatsapp',
    idioma: idioma || detectarIdioma(mensagem),
    status: 'novo',
    etapa_funil: 'primeiro_contato',
    historico: JSON.stringify([entradaMensagem('recebida', mensagem)]),
    ultima_interacao: new Date().toISOString(),
  };
  if (afiliadoCodigo) payload.afiliado_codigo = afiliadoCodigo;
  try {
    const lead = await base44.Lead.create(payload);
    logger.info('[LEAD] criado via WhatsApp', { id: lead.id, fone });
    return lead;
  } catch (e) {
    logger.error('[LEAD] falha ao criar', e.message);
    return null;
  }
}

/** Adiciona mensagem ao histórico do lead e atualiza campos */
export async function registrarMensagem(leadId, direcao, texto, extras = {}) {
  try {
    const lead = await base44.Lead.get(leadId);
    const historico = parseHistorico(lead.historico);
    historico.push(entradaMensagem(direcao, texto));

    const update = {
      historico: JSON.stringify(historico),
      ultima_interacao: new Date().toISOString(),
      ...extras,
    };
    await base44.Lead.update(leadId, update);
    logger.debug('[LEAD] mensagem registrada', { leadId, direcao });
  } catch (e) {
    logger.error('[LEAD] falha ao registrar mensagem', e.message);
  }
}

/** Atualiza etapa do funil e status */
export async function atualizarEtapa(leadId, etapa, extras = {}) {
  const mapaStatus = {
    novo: 'novo',
    primeiro_contato: 'contato_feito',
    qualificando: 'contato_feito',
    interessado: 'qualificado',
    apresentacao_enviada: 'qualificado',
    qualificado: 'qualificado',
    reuniao_solicitada: 'qualificado',
    reuniao_agendada: 'qualificado',
    documentacao: 'qualificado',
    negociacao: 'qualificado',
    convertido: 'investiu',
    perdido: 'perdido',
    follow_up: 'contato_feito',
  };
  try {
    await base44.Lead.update(leadId, {
      etapa_funil: etapa,
      status: mapaStatus[etapa] ?? 'contato_feito',
      ultima_interacao: new Date().toISOString(),
      ...extras,
    });
    logger.info('[LEAD] etapa atualizada', { leadId, etapa });
  } catch (e) {
    logger.error('[LEAD] falha ao atualizar etapa', e.message);
  }
}

// ── helpers internos ──────────────────────────────────────────────────────────
function entradaMensagem(direcao, texto) {
  return { ts: new Date().toISOString(), dir: direcao, txt: texto };
}

function parseHistorico(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** Retorna histórico formatado como string para o contexto do agente IA */
export function formatarHistorico(raw, maxMensagens = 20) {
  const lista = parseHistorico(raw);
  return lista
    .slice(-maxMensagens)
    .map(e => `[${e.ts?.slice(11, 16)}] ${e.dir === 'recebida' ? '👤 Lead' : '🤖 Raízes'}: ${e.txt}`)
    .join('\n');
}
