/**
 * Sistema de Follow-up Inteligente — Raízes do Etanol
 * Parte 5: acompanhamento contextual, multilíngue, respeitando opt-out
 */
import { logger } from './logger.js';
import { buscarLeadPorFone, registrarMensagem, formatarHistorico } from './lead.js';
import { base44 } from './base44.js';
import { chamarClaude } from './ia.js';
import { instrucaoIdioma } from './idioma.js';
import { enviarTexto } from './zapi.js';

// Intervalo mínimo entre follow-ups (em horas)
const INTERVALO_MINIMO_H = 24;
// Número máximo de tentativas antes de desistir
const MAX_TENTATIVAS = 3;

// Cache de números que já receberam follow-up hoje (em memória — reiniciado com o servidor)
const tentativasHoje = new Map(); // fone → count

/**
 * Verifica se um lead merece follow-up e gera a mensagem.
 * Retorna { mensagem, enviar: true/false } ou null.
 */
export async function gerarFollowup(lead) {
  const etapa = lead.etapa_funil || 'novo';
  const idioma = lead.idioma || 'pt';

  // Não fazer follow-up nessas etapas
  const etapasParar = ['convertido', 'perdido', 'reuniao_agendada'];
  if (etapasParar.includes(etapa)) return null;

  // Verifica opt-out no histórico
  if (lead.historico?.includes('"opt_out":true')) return null;

  // Verifica tentativas
  const fone = lead.whatsapp;
  const tentativas = tentativasHoje.get(fone) || 0;
  if (tentativas >= MAX_TENTATIVAS) {
    logger.info('[FOLLOWUP] máximo de tentativas atingido', { fone });
    return null;
  }

  // Verifica última interação
  const ultimaInteracao = lead.ultima_interacao ? new Date(lead.ultima_interacao) : null;
  if (ultimaInteracao) {
    const horasSemContato = (Date.now() - ultimaInteracao.getTime()) / 3600000;
    if (horasSemContato < INTERVALO_MINIMO_H) {
      logger.debug('[FOLLOWUP] muito cedo para follow-up', { fone, horasSemContato: Math.round(horasSemContato) });
      return null;
    }
  }

  const historico = formatarHistorico(lead.historico);

  const instrucaoLing = instrucaoIdioma(idioma);

  // Mapeia etapa para contexto do follow-up
  const contextos = {
    novo:               'O lead entrou em contato mas ainda não recebeu atendimento.',
    primeiro_contato:   'O lead recebeu o primeiro contato mas não respondeu.',
    qualificando:       'O lead estava sendo qualificado mas a conversa parou.',
    interessado:        'O lead demonstrou interesse no projeto mas a conversa pausou.',
    apresentacao_enviada: 'O lead recebeu a apresentação do projeto mas não deu retorno.',
    qualificado:        'O lead está qualificado. Uma oportunidade real aguarda acompanhamento.',
    reuniao_solicitada: 'O lead solicitou reunião mas ainda não foi agendada.',
    follow_up:          'Este lead está marcado para acompanhamento.',
  };

  const contexto = contextos[etapa] || 'O lead precisa de acompanhamento.';

  const prompt = `Você é o agente de follow-up da Raízes do Etanol.

${instrucaoLing}

Situação: ${contexto}

Lead: ${lead.nome || 'Investidor'}
Histórico recente:
${historico || '(sem histórico disponível)'}

Escreva UMA mensagem de follow-up natural, breve (máximo 2 parágrafos), que:
- Retome a conversa com base no contexto
- NÃO seja genérica ou repetitiva
- NÃO pressione ou crie urgência artificial
- NÃO prometa retorno financeiro garantido
- Ofereça valor: informação útil, próximo passo concreto ou pergunta aberta
- Esteja no idioma do lead

Escreva APENAS a mensagem, sem explicações.`;

  const mensagem = await chamarClaude(prompt, 'gerar follow-up');
  if (!mensagem) return null;

  return { mensagem: mensagem.trim(), idioma };
}

/**
 * Executa follow-up para todos os leads elegíveis.
 * Chamado pelo endpoint /admin/followup ou por cron externo.
 */
export async function executarFollowups(secret) {
  if (secret !== process.env.WEBHOOK_SECRET) return { erro: 'não autorizado' };

  logger.info('[FOLLOWUP] iniciando varredura de follow-ups');

  let leads = [];
  try {
    leads = await base44.Lead.list({ etapa_funil__ne: 'convertido', etapa_funil__ne2: 'perdido' });
  } catch (e) {
    logger.error('[FOLLOWUP] erro ao listar leads', e.message);
    return { erro: 'falha ao listar leads' };
  }

  const resultados = { enviados: 0, ignorados: 0, erros: 0 };

  for (const lead of leads) {
    if (!lead.whatsapp) { resultados.ignorados++; continue; }

    try {
      const fu = await gerarFollowup(lead);
      if (!fu) { resultados.ignorados++; continue; }

      await enviarTexto(lead.whatsapp, fu.mensagem);
      await registrarMensagem(lead.id, 'enviada', fu.mensagem, { tipo: 'follow_up' });

      const tentativas = (tentativasHoje.get(lead.whatsapp) || 0) + 1;
      tentativasHoje.set(lead.whatsapp, tentativas);

      resultados.enviados++;
      logger.info('[FOLLOWUP] enviado', { fone: lead.whatsapp, etapa: lead.etapa_funil });

      // Pausa entre envios para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      logger.error('[FOLLOWUP] erro ao processar lead', { id: lead.id, erro: e.message });
      resultados.erros++;
    }
  }

  // Limpa cache de tentativas ao fim
  if (new Date().getHours() === 23) tentativasHoje.clear();

  logger.info('[FOLLOWUP] varredura concluída', resultados);
  return resultados;
}
