/**
 * Raízes do Etanol — WhatsApp IA Server
 * Webhook receiver + agentes SDR/Consultor/Closer/Supervisor
 * Partes 2, 3, 4, 5 — multilíngue + follow-up inteligente
 */
import 'dotenv/config';
import express from 'express';
import { logger } from './lib/logger.js';
import { router as webhookRouter } from './routes/webhook.js';
import { statusInstancia, enviarTexto } from './lib/zapi.js';
import { executarFollowups } from './lib/followup.js';
import { base44 } from './lib/base44.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  if (req.path !== '/health') logger.debug(`${req.method} ${req.path}`);
  next();
});

// ── Autenticação de rotas admin ───────────────────────────────────────────────
function authAdmin(req, res, next) {
  const secret = req.headers['x-secret'] || req.query.secret || req.body?.secret;
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ erro: 'não autorizado' });
  next();
}

// ── Rotas públicas ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'raizes-whatsapp-ia',
    version: '2.0.0',
    ts: new Date().toISOString(),
  });
});

// Webhook Z-API
app.use('/webhook/zapi', webhookRouter);

// ── Rotas admin (requerem WEBHOOK_SECRET) ─────────────────────────────────────

// Envio manual
app.post('/send', authAdmin, async (req, res) => {
  const { fone, mensagem } = req.body;
  if (!fone || !mensagem) return res.status(400).json({ erro: 'fone e mensagem obrigatórios' });
  const result = await enviarTexto(fone, mensagem);
  res.json({ ok: !!result, result });
});

// Status da instância Z-API
app.get('/status/zapi', authAdmin, async (_req, res) => {
  const st = await statusInstancia();
  res.json(st ?? { erro: 'não foi possível verificar' });
});

// Follow-up manual (disparo pelo admin)
app.post('/admin/followup', authAdmin, async (req, res) => {
  const result = await executarFollowups(process.env.WEBHOOK_SECRET);
  res.json(result);
});

// Resumo de leads (Parte 6 — inteligência de gestão)
app.get('/admin/leads/resumo', authAdmin, async (_req, res) => {
  try {
    const leads = await base44.Lead.list();
    const total = leads.length;

    const porEtapa = {};
    const porIdioma = {};
    const porOrigem = {};
    let semResposta = 0;

    const agora = Date.now();
    for (const l of leads) {
      const e = l.etapa_funil || 'novo';
      porEtapa[e] = (porEtapa[e] || 0) + 1;

      const i = l.idioma || 'pt';
      porIdioma[i] = (porIdioma[i] || 0) + 1;

      const o = l.origem || 'desconhecida';
      porOrigem[o] = (porOrigem[o] || 0) + 1;

      // Lead sem resposta há mais de 24h
      if (l.ultima_interacao) {
        const h = (agora - new Date(l.ultima_interacao).getTime()) / 3600000;
        if (h > 24 && !['convertido','perdido'].includes(e)) semResposta++;
      }
    }

    res.json({
      total,
      porEtapa,
      porIdioma,
      porOrigem,
      semResposta,
      atualizadoEm: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Leads sem resposta (Parte 6 — alertas)
app.get('/admin/leads/sem-resposta', authAdmin, async (req, res) => {
  const horas = parseInt(req.query.horas || '24', 10);
  try {
    const leads = await base44.Lead.list();
    const agora = Date.now();
    const semResposta = leads.filter(l => {
      if (['convertido','perdido'].includes(l.etapa_funil)) return false;
      if (!l.ultima_interacao) return true;
      const h = (agora - new Date(l.ultima_interacao).getTime()) / 3600000;
      return h > horas;
    });
    res.json({ total: semResposta.length, leads: semResposta.map(l => ({
      id: l.id, nome: l.nome, whatsapp: l.whatsapp, etapa: l.etapa_funil,
      idioma: l.idioma, ultima_interacao: l.ultima_interacao,
    }))});
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

// ── Erros ─────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('[SERVER] erro não tratado', err.message);
  res.status(500).json({ erro: 'erro interno' });
});

// ── Inicialização ─────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  logger.info(`🌱 Raízes WhatsApp IA v2 — porta ${PORT}`);
  logger.info(`📡 Webhook: POST /webhook/zapi`);
  logger.info(`💊 Health:  GET  /health`);
  logger.info(`🔧 Admin:   POST /admin/followup | GET /admin/leads/resumo`);

  const st = await statusInstancia();
  if (st) {
    logger.info('[ZAPI] instância', { status: st.connected ? 'CONECTADA' : 'DESCONECTADA' });
  } else {
    logger.warn('[ZAPI] não foi possível verificar — verifique credenciais');
  }

  if (process.env.ADMIN_PHONE && process.env.ANTHROPIC_API_KEY !== 'COLE_SUA_CHAVE_AQUI') {
    await enviarTexto(process.env.ADMIN_PHONE,
      `🤖 *Raízes WhatsApp IA v2 — online*\n\nServidor iniciado em ${new Date().toLocaleString('pt-BR')}\n` +
      `Agentes: SDR · Consultor · Closer · Supervisor\n` +
      `Idiomas: PT · EN · ES · FR · DE · IT · ZH · JA · KO · AR · RU · HI · NL · TR\n` +
      `Áudio: ${process.env.OPENAI_API_KEY ? 'habilitado (Whisper)' : 'desabilitado'}\n` +
      `Status: aguardando mensagens`
    );
  }
});

process.on('SIGTERM', () => { logger.info('[SERVER] encerrando...'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('[SERVER] encerrando...'); process.exit(0); });
