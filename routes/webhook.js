/**
 * Rota POST /webhook/zapi
 * Recebe eventos do Z-API: mensagens recebidas, status, áudio
 */
import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { enviarTexto, normalizarFone, simularDigitando } from '../lib/zapi.js';
import {
  buscarLeadPorFone, criarLeadWhatsApp, registrarMensagem,
  atualizarEtapa, formatarHistorico,
} from '../lib/lead.js';
import {
  promptSDR, promptConsultor, promptCloser, promptSupervisor,
  rotearAgente, extrairCRM, limparResposta, extrairResumoEquipe,
} from '../lib/agentes.js';
import { chamarClaude } from '../lib/ia.js';
import { detectarIdioma } from '../lib/idioma.js';
import { transcreverAudio, extrairAudioPayload } from '../lib/audio.js';

export const router = Router();

// IDs processados — evita duplicidade
const processados = new Set();
// Números em modo humano (IA pausada)
const modoHumano = new Set();

// ── WEBHOOK PRINCIPAL ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  res.status(200).json({ ok: true }); // responde imediatamente ao Z-API

  const payload = req.body;
  logger.info('[WEBHOOK] payload recebido', { type: payload?.type, phone: payload?.phone });

  try {
    // ── Status de entrega/leitura ──────────────────────────────────────────
    if (payload?.type === 'MessageStatusCallback') {
      logger.info('[WEBHOOK] status de mensagem', {
        phone: payload.phone,
        status: payload.status,
        messageId: payload.messageId,
      });
      return;
    }

    // ── Conexão/desconexão da instância ───────────────────────────────────
    if (payload?.type === 'ConnectionCallback' || payload?.type === 'DisconnectedCallback') {
      logger.warn('[WEBHOOK] evento de conexão', { type: payload.type });
      if (payload?.type === 'DisconnectedCallback' && process.env.ADMIN_PHONE) {
        await enviarTexto(process.env.ADMIN_PHONE,
          `⚠️ *WhatsApp desconectado*\n\nInstância Z-API ficou offline. Acesse app.z-api.io para reconectar.`
        );
      }
      return;
    }

    // ── Apenas mensagens recebidas (não enviadas por nós) ─────────────────
    if (payload?.fromMe === true) return;
    const tiposAceitos = ['ReceivedCallback', 'AudioCallback'];
    if (!tiposAceitos.includes(payload?.type)) return;

    // ── Deduplicação ───────────────────────────────────────────────────────
    const msgId = payload?.messageId;
    if (msgId && processados.has(msgId)) {
      logger.debug('[WEBHOOK] mensagem duplicada ignorada', { msgId });
      return;
    }
    if (msgId) processados.add(msgId);
    if (processados.size > 500) {
      const iter = processados.values();
      for (let i = 0; i < 100; i++) processados.delete(iter.next().value);
    }

    const fone = normalizarFone(payload.phone || payload.senderPhone || '');
    const nomeWpp = payload.senderName || payload.chatName || '';
    if (!fone) return;

    // ── Áudio: transcrever via Whisper ────────────────────────────────────
    let texto = payload.text?.message || payload.caption || '';
    let isAudio = false;

    if (payload.type === 'AudioCallback' || (!texto && payload?.audio)) {
      const audioData = extrairAudioPayload(payload);
      if (audioData) {
        logger.info('[WEBHOOK] mensagem de áudio detectada — transcrevendo', { fone });
        const transcricao = await transcreverAudio(audioData.url, audioData.base64);
        if (transcricao) {
          texto = transcricao;
          isAudio = true;
          logger.info('[WEBHOOK] áudio transcrito', { fone, chars: texto.length });
        } else {
          await enviarTexto(fone,
            'Recebi seu áudio! No momento não consigo transcrever mensagens de voz. ' +
            'Poderia escrever sua mensagem por texto? Será um prazer ajudar! 🌱'
          );
          return;
        }
      }
    }

    if (!texto) return;

    logger.info('[WEBHOOK] mensagem recebida', {
      fone,
      tipo: isAudio ? 'áudio' : 'texto',
      preview: texto.slice(0, 60),
    });

    // ── Verificar opt-out ─────────────────────────────────────────────────
    const optOut = /\b(parar|stop|cancelar|unsubscribe|não quero|nao quero|desinscrever)\b/i.test(texto);
    if (optOut) {
      logger.info('[WEBHOOK] opt-out solicitado', { fone });
      modoHumano.add(fone);
      const lead = await buscarLeadPorFone(fone);
      if (lead) await atualizarEtapa(lead.id, 'perdido', { opt_out: true });
      await enviarTexto(fone, 'Entendido. Não enviaremos mais mensagens. Se mudar de ideia, estamos aqui. 🌱');
      return;
    }

    // ── Verificar pedido de atendimento humano ────────────────────────────
    const querHumano = /\b(humano|pessoa|atendente|equipe|falar com algu[eé]m|gerente|responsável)\b/i.test(texto);
    if (querHumano) {
      modoHumano.add(fone);
      const lead = await buscarLeadPorFone(fone);
      if (lead) await atualizarEtapa(lead.id, 'reuniao_solicitada', { agente_atual: 'humano' });
      await enviarTexto(fone,
        'Claro! Vou chamar nossa equipe agora.\n\nEnquanto isso, você pode nos contatar diretamente: +55 95 99135-1787\n\nFalaremos em breve! 🤝'
      );
      if (process.env.ADMIN_PHONE) {
        await enviarTexto(process.env.ADMIN_PHONE,
          `🚨 *Atendimento humano solicitado*\n\nLead: ${nomeWpp || fone}\nFone: ${fone}\nMensagem: "${texto}"\n\nAssuma o atendimento.`
        );
      }
      return;
    }

    // ── IA pausada para este número ───────────────────────────────────────
    if (modoHumano.has(fone)) {
      logger.info('[WEBHOOK] IA pausada — ignorando', { fone });
      return;
    }

    // ── Buscar ou criar lead ───────────────────────────────────────────────
    let lead = await buscarLeadPorFone(fone);

    // ── Detectar idioma — trava no idioma já definido do lead ──────────────
    const idiomaDetectado = lead?.idioma ? lead.idioma : await detectarIdioma(texto, true);
    const idioma = idiomaDetectado;

    if (!lead) {
      lead = await criarLeadWhatsApp({
        fone,
        nome: nomeWpp,
        mensagem: texto,
        idioma,
        afiliadoCodigo: null,
      });
    } else {
      const extras = {};
      if (!lead.idioma && idioma) extras.idioma = idioma;
      if (nomeWpp && (!lead.nome || lead.nome === 'Desconhecido')) {
        extras.nome = nomeWpp;
        lead.nome = nomeWpp;
      }
      if (isAudio) extras.audio_transcrito = true;
      await registrarMensagem(lead.id, 'recebida', texto, Object.keys(extras).length ? extras : undefined);
    }

    if (!lead) {
      logger.error('[WEBHOOK] não foi possível criar/encontrar lead', { fone });
      return;
    }

    if (idioma && !lead.idioma) lead.idioma = idioma;

    // ── Rotear para agente ────────────────────────────────────────────────
    const historico = formatarHistorico(lead.historico);
    const agente = rotearAgente(lead);
    logger.info('[WEBHOOK] roteando', { fone, agente, etapa: lead.etapa_funil, idioma });

    let systemPrompt;
    if (agente === 'closer')         systemPrompt = promptCloser(lead, historico, texto);
    else if (agente === 'consultor') systemPrompt = promptConsultor(lead, historico, texto);
    else                             systemPrompt = promptSDR(lead, historico, texto);

    // ── Chamar IA ─────────────────────────────────────────────────────────
    const respostaRaw = await chamarClaude(systemPrompt, texto);
    if (!respostaRaw) {
      await enviarTexto(fone, 'Desculpe, tivemos um problema técnico. Nossa equipe entrará em contato em breve. 🌱');
      return;
    }

    // ── Extrair CRM + resumo equipe + limpar resposta ─────────────────────
    const crm = extrairCRM(respostaRaw);
    const resumoEquipe = extrairResumoEquipe(respostaRaw);
    const resposta = limparResposta(respostaRaw);

    // ── Enviar resposta com typing indicator ─────────────────────────────
    await simularDigitando(fone, resposta);
    await enviarTexto(fone, resposta);

    // ── Atualizar CRM ─────────────────────────────────────────────────────
    const extrasLead = { agente_atual: agente };
    if (crm?.etapa) extrasLead.etapa_funil = crm.etapa;
    if (crm?.perfil) extrasLead.perfil_interesse = crm.perfil;
    if (idioma) extrasLead.idioma = idioma;
    await registrarMensagem(lead.id, 'enviada', resposta, extrasLead);

    // ── Notificar admin sobre resumo de transferência internacional ────────
    if (resumoEquipe && process.env.ADMIN_PHONE) {
      await enviarTexto(process.env.ADMIN_PHONE,
        `🌍 *Lead internacional — ${idioma?.toUpperCase()}*\n\n${resumoEquipe}`
      );
    }

    // ── Supervisor monitora silenciosamente ───────────────────────────────
    monitorarSupervisor(lead, historico + `\n[lead]: ${texto}\n[raizes]: ${resposta}`).catch(() => {});

  } catch (e) {
    logger.error('[WEBHOOK] erro não tratado', e.message);
  }
});

// ── CONTROLE: pausar/retomar IA por número ───────────────────────────────────
router.post('/controle', (req, res) => {
  const { acao, fone, secret } = req.body;
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ erro: 'não autorizado' });
  const f = normalizarFone(fone);
  if (!f) return res.status(400).json({ erro: 'fone inválido' });
  if (acao === 'pausar')  { modoHumano.add(f);    return res.json({ ok: true, fone: f, modo: 'humano' }); }
  if (acao === 'retomar') { modoHumano.delete(f);  return res.json({ ok: true, fone: f, modo: 'ia' }); }
  res.json({ modoHumano: [...modoHumano] });
});

// ── SUPERVISOR (background) ───────────────────────────────────────────────────
async function monitorarSupervisor(lead, historico) {
  const sp = promptSupervisor(lead, historico);
  const raw = await chamarClaude(sp, 'analise');
  if (!raw) return;
  try {
    const diag = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (diag.alerta) {
      logger.warn('[SUPERVISOR] alerta detectado', diag);
      if (diag.urgencia === 'alta' && process.env.ADMIN_PHONE) {
        await enviarTexto(process.env.ADMIN_PHONE,
          `⚡ *Supervisor — Alerta ${diag.urgencia.toUpperCase()}*\n\n` +
          `Lead: ${lead.nome} (${lead.whatsapp})\n` +
          `Tipo: ${diag.tipo_alerta}\n` +
          `${diag.descricao}\n\n` +
          `Ação: ${diag.acao_recomendada}`
        );
      }
    }
  } catch { /* resposta não era JSON */ }
}
