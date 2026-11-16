/**
 * Cliente Claude API (Anthropic) — processa mensagens com os agentes IA
 */
import { logger } from './logger.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function chamarClaude(systemPrompt, mensagemUsuario) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'COLE_SUA_CHAVE_AQUI') {
    logger.warn('[IA] ANTHROPIC_API_KEY não configurada — retornando resposta padrão');
    return 'Obrigado pela mensagem! Em breve nossa equipe entrará em contato. 🌱';
  }

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: mensagemUsuario }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Anthropic HTTP ${r.status}: ${err}`);
    }

    const json = await r.json();
    return json.content?.[0]?.text ?? '';
  } catch (e) {
    logger.error('[IA] falha ao chamar Claude', e.message);
    return null;
  }
}
