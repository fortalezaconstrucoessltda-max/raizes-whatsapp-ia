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

const processados = new Set();
const modoHumano = new Set();

router.post('/', async (req, res) => {
  res.status(200).json({ ok: true });
  const payload = req.body;

  try {
    if (payload?.type === 'MessageStatusCallback') return;

    if (payload?.type === 'ConnectionCallback' || payload?.type === 'DisconnectedCallback') {
      if (payload?.type === 'DisconnectedCallback' && process.env.ADMIN_PHONE) {
        await enviarTexto(process.env.ADMIN_PHONE, '⚠️ *WhatsApp desconectado*\n\nAcesse app.z-api.io para reconectar.');
      }
      return;
    }

    if (payload?.fromMe === true) return;
    if (!['ReceivedCallback', 'AudioCallback'].includes(payload?.type)) return;

    const msgId = payload?.messageId;
    if (msgId && processados.has(msgId)) return;
    if (msgId) processados.add(msgId);
    if (processados.size > 500) {
      const iter = processados.values();
      for (let i = 0; i < 100; i++) processados.delete(iter.next().value);
    }

    const fone = normalizarFone(payload.phone || payload.senderPhone || '');
    const nomeWpp = payload.senderName || payload.chatName || '';
    if (!fone) return;

    let texto = payload.text?.message || payload.caption || '';
    let isAudio = false;

    if (payload.type === 'AudioCallback' || (!texto && payload?.audio)) {
      const audioData = extrairAudioPayload(payload);
      if (audioData) {
        const transcricao = await transcreverAudio(audioData.url, audioData.base64);
        if (transcricao) { texto = transcricao; isAudio = true; }
        else {
          await enviarTexto(fone, 'Recebi seu áudio! Poderia escrever por texto? 🌱');
          return;
        }
      }
    }

    if (!texto) return;

    const optOut = /\b(parar|stop|cancelar|unsubscribe|não quero|nao quero|desinscrever)\b/i.test(texto);
    if (optOut) {
      modoHumano.add(fone);
      const lead = await buscarLeadPorFone(fone);
      if (lead) await atualizarEtapa(lead.id, 'perdido', { opt_out: true });
      await enviarTexto(fone, 'Entendido. Não enviaremos mais mensagens. 🌱');
      return;
    }

    const querHumano = /\b(humano|pessoa|atendente|equipe|falar com algu[eé]m|gerente|responsável)\b/i.test(texto);
    if (querHumano) {
      modoHumano.add(fone);
      const lead = await buscarLeadPorFone(fone);
      if (lead) await atualizarEtapa(lead.id, 'reuniao_solicitada', { agente_atual: 'humano' });
      await enviarTexto(fone, 'Claro! Nossa equipe vai falar com você em breve.\n\nContato direto: +55 95 99135-1787 🤝');
      if (process.env.ADMIN_PHONE) {
        await enviarTexto(process.env.ADMIN_PHONE, `🚨 *Atendimento humano solicitado*\n\nLead: ${nomeWpp || fone}\nFone: ${fone}\nMensagem: "${texto}"`);
      }
      return;
    }

    if (modoHumano.has(fone)) return;

    // Busca lead — isNovoLead é TRUE apenas na primeira mensagem de sempre
    let lead = await buscarLeadPorFone(fone);
    const isNovoLead = !lead;

    const idioma = lead?.idioma ? lead.idioma : await detectarIdioma(texto);

    if (!lead) {
      lead = await criarLeadWhatsApp({ fone, nome: nomeWpp, mensagem: texto, idioma, afiliadoCodigo: null });
    } else {
      const extras = {};
      if (!lead.idioma && idioma) extras.idioma = idioma;
      if (nomeWpp && (!lead.nome || lead.nome === 'Desconhecido')) { extras.nome = nomeWpp; lead.nome = nomeWpp; }
      if (isAudio) extras.audio_transcrito = true;
      await registrarMensagem(lead.id, 'recebida', texto, Object.keys(extras).length ? extras : undefined);
    }

    if (!lead) { logger.error('[WEBHOOK] lead não encontrado', { fone }); return; }

    if (idioma && !lead.idioma) lead.idioma = idioma;
    lead._isNovo = isNovoLead; // flag usada pelos agentes para saber se cumprimentar

    const historico = formatarHistorico(lead.historico);
    const agente = rotearAgente(lead);
    logger.info('[WEBHOOK] roteando', { fone, agente, isNovoLead, idioma });

    let systemPrompt;
    if (agente === 'closer')         systemPrompt = promptCloser(lead, historico, texto);
    else if (agente === 'consultor') systemPrompt = promptConsultor(lead, historico, texto);
    else                             systemPrompt = promptSDR(lead, historico, texto);

    const respostaRaw = await chamarClaude(systemPrompt, texto);
    if (!respostaRaw) {
      await enviarTexto(fone, 'Desculpe, problema técnico. Nossa equipe entrará em contato. 🌱');
      return;
    }

    const crm = extrairCRM(respostaRaw);
    const resumoEquipe = extrairResumoEquipe(respostaRaw);
    const resposta = limparResposta(respostaRaw);

    await simularDigitando(fone, resposta);
    await enviarTexto(fone, resposta);

    const extrasLead = { agente_atual: agente };
    if (crm?.etapa) extrasLead.etapa_funil = crm.etapa;
    if (crm?.perfil) extrasLead.perfil_interesse = crm.perfil;
    if (idioma) extrasLead.idioma = idioma;
    await registrarMensagem(lead.id, 'enviada', resposta, extrasLead);

    if (resumoEquipe && process.env.ADMIN_PHONE) {
      await enviarTexto(process.env.ADMIN_PHONE, `🌍 *Lead internacional — ${idioma?.toUpperCase()}*\n\n${resumoEquipe}`);
    }

    monitorarSupervisor(lead, historico + `\n[lead]: ${texto}\n[raizes]: ${resposta}`).catch(() => {});

  } catch (e) {
    logger.error('[WEBHOOK] erro não tratado', e.message);
  }
});

router.post('/controle', (req, res) => {
  const { acao, fone, secret } = req.body;
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ erro: 'não autorizado' });
  const f = normalizarFone(fone);
  if (!f) return res.status(400).json({ erro: 'fone inválido' });
  if (acao === 'pausar')  { modoHumano.add(f);   return res.json({ ok: true, fone: f, modo: 'humano' }); }
  if (acao === 'retomar') { modoHumano.delete(f); return res.json({ ok: true, fone: f, modo: 'ia' }); }
  res.json({ modoHumano: [...modoHumano] });
});

async function monitorarSupervisor(lead, historico) {
  const sp = promptSupervisor(lead, historico);
  const raw = await chamarClaude(sp, 'analise');
  if (!raw) return;
  try {
    const diag = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (diag.alerta && diag.urgencia === 'alta' && process.env.ADMIN_PHONE) {
      await enviarTexto(process.env.ADMIN_PHONE,
        `⚡ *Supervisor — Alerta ALTA*\n\nLead: ${lead.nome} (${lead.whatsapp})\nTipo: ${diag.tipo_alerta}\n${diag.descricao}\n\nAção: ${diag.acao_recomendada}`
      );
    }
  } catch { /* não era JSON */ }
}
