/**
 * Raízes do Etanol — WhatsApp IA Server
 * Webhook receiver + agentes SDR/Consultor/Closer/Supervisor
 * Partes 2, 3, 4, 5 — multilíngue + follow-up inteligente
 */
import 'dotenv/config';
import express from 'express';

// Erros globais — captura qualquer crash
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', String(reason));
});

console.log('[BOOT] iniciando servidor...');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  if (req.path !== '/health') console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

function authAdmin(req, res, next) {
  const secret = req.headers['x-secret'] || req.query.secret || req.body?.secret;
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ erro: 'não autorizado' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'raizes-whatsapp-ia',
    version: '2.0.0',
    ts: new Date().toISOString(),
  });
});

async function bootstrap() {
  console.log('[BOOT] carregando módulos...');

  let logger, webhookRouter, statusInstancia, enviarTexto, executarFollowups, base44;

  try {
    console.log('[BOOT] carregando lib/logger.js...');
    const mod = await import('./lib/logger.js');
    logger = mod.logger;
    console.log('[BOOT] logger OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar logger:', e.message);
    return;
  }

  try {
    console.log('[BOOT] carregando lib/base44.js...');
    const mod = await import('./lib/base44.js');
    base44 = mod.base44;
    logger.info('[BOOT] base44 OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar base44:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/zapi.js...');
    const mod = await import('./lib/zapi.js');
    statusInstancia = mod.statusInstancia;
    enviarTexto = mod.enviarTexto;
    logger.info('[BOOT] zapi OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar zapi:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/ia.js...');
    await import('./lib/ia.js');
    logger.info('[BOOT] ia OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar ia:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/idioma.js...');
    await import('./lib/idioma.js');
    logger.info('[BOOT] idioma OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar idioma:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/audio.js...');
    await import('./lib/audio.js');
    logger.info('[BOOT] audio OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar audio:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/lead.js...');
    await import('./lib/lead.js');
    logger.info('[BOOT] lead OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar lead:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/agentes.js...');
    await import('./lib/agentes.js');
    logger.info('[BOOT] agentes OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar agentes:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando lib/followup.js...');
    const mod = await import('./lib/followup.js');
    executarFollowups = mod.executarFollowups;
    logger.info('[BOOT] followup OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar followup:', e.message);
    return;
  }

  try {
    logger.info('[BOOT] carregando routes/webhook.js...');
    const mod = await import('./routes/webhook.js');
    webhookRouter = mod.router;
    logger.info('[BOOT] webhook router OK');
  } catch (e) {
    console.error('[BOOT] ERRO ao carregar webhook router:', e.message);
    return;
  }

  logger.info('[BOOT] todos os módulos carregados — registrando rotas...');

  app.use('/webhook/zapi', webhookRouter);

  app.post('/send', authAdmin, async (req, res) => {
    const { fone, mensagem } = req.body;
    if (!fone || !mensagem) return res.status(400).json({ erro: 'fone e mensagem obrigatórios' });
    const result = await enviarTexto(fone, mensagem);
    res.json({ ok: !!result, result });
  });

  app.get('/status/zapi', authAdmin, async (_req, res) => {
    const st = await statusInstancia();
    res.json(st ?? { erro: 'não foi possível verificar' });
  });

  app.post('/admin/followup', authAdmin, async (req, res) => {
    const result = await executarFollowups(process.env.WEBHOOK_SECRET);
    res.json(result);
  });

  app.get('/admin/leads/resumo', authAdmin, async (_req, res) => {
    try {
      const leads = await base44.Lead.list();
      const total = leads.length;
      const porEtapa = {};
      const porIdioma = {};
      const agora = Date.now();
      let semResposta = 0;
      for (const l of leads) {
        const e = l.etapa_funil || 'novo';
        porEtapa[e] = (porEtapa[e] || 0) + 1;
        const i = l.idioma || 'pt';
        porIdioma[i] = (porIdioma[i] || 0) + 1;
        if (l.ultima_interacao) {
          const h = (agora - new Date(l.ultima_interacao).getTime()) / 3600000;
          if (h > 24 && !['convertido','perdido'].includes(e)) semResposta++;
        }
      }
      res.json({ total, porEtapa, porIdioma, semResposta, atualizadoEm: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  });

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

  app.use((_req, res) => res.status(404).json({ erro: 'rota não encontrada' }));
  app.use((err, _req, res, _next) => {
    console.error('[SERVER] erro não tratado', err.message);
    res.status(500).json({ erro: 'erro interno' });
  });

  logger.info(`🌱 Raízes WhatsApp IA v2 — porta ${PORT}`);

  const st = await statusInstancia();
  if (st) {
    logger.info('[ZAPI] instância', { status: st.connected ? 'CONECTADA' : 'DESCONECTADA' });
  } else {
    logger.warn('[ZAPI] não foi possível verificar');
  }

  if (process.env.ADMIN_PHONE && process.env.ANTHROPIC_API_KEY !== 'COLE_SUA_CHAVE_AQUI') {
    await enviarTexto(process.env.ADMIN_PHONE,
      `🤖 *Raízes WhatsApp IA v2 — online*\n\nServidor iniciado em ${new Date().toLocaleString('pt-BR')}\nStatus: aguardando mensagens`
    );
  }
}

app.listen(PORT, () => {
  console.log(`[BOOT] Express escutando na porta ${PORT}`);
  bootstrap().catch(err => {
    console.error('[BOOT] bootstrap falhou:', err.message, err.stack);
  });
});

process.on('SIGTERM', () => { console.log('[SERVER] encerrando...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[SERVER] encerrando...'); process.exit(0); });
