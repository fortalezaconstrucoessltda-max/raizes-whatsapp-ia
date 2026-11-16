/**
 * Detecção de idioma — heurística rápida + fallback via Claude
 * Nunca bloqueia o atendimento: se falhar, assume português.
 */
import { chamarClaude } from './ia.js';

// Mapa completo: código ISO → nome nativo + nome em PT
export const IDIOMAS = {
  pt: { nativo: 'Português',          ptbr: 'Português',      formal: false },
  en: { nativo: 'English',            ptbr: 'Inglês',         formal: false },
  es: { nativo: 'Español',            ptbr: 'Espanhol',       formal: true  },
  fr: { nativo: 'Français',           ptbr: 'Francês',        formal: true  },
  de: { nativo: 'Deutsch',            ptbr: 'Alemão',         formal: true  },
  it: { nativo: 'Italiano',           ptbr: 'Italiano',       formal: true  },
  nl: { nativo: 'Nederlands',         ptbr: 'Holandês',       formal: true  },
  ru: { nativo: 'Русский',            ptbr: 'Russo',          formal: true  },
  ar: { nativo: 'العربية',            ptbr: 'Árabe',          formal: true  },
  zh: { nativo: '中文 (简体)',         ptbr: 'Chinês simpl.',  formal: true  },
  'zh-tw': { nativo: '中文 (繁體)',   ptbr: 'Chinês trad.',   formal: true  },
  ja: { nativo: '日本語',             ptbr: 'Japonês',        formal: true  },
  ko: { nativo: '한국어',             ptbr: 'Coreano',        formal: true  },
  hi: { nativo: 'हिन्दी',             ptbr: 'Hindi',          formal: true  },
  tr: { nativo: 'Türkçe',            ptbr: 'Turco',          formal: true  },
};

// Heurística leve — sem chamada de API
function heuristica(texto) {
  if (!texto || texto.length < 3) return null;
  const t = texto.toLowerCase();

  // Scripts não-latinos — detectáveis por Unicode range
  if (/[一-鿿]/.test(texto)) return 'zh';
  if (/[぀-ヿㇰ-ㇿ]/.test(texto)) return 'ja';
  if (/[가-힯]/.test(texto)) return 'ko';
  if (/[؀-ۿ]/.test(texto)) return 'ar';
  if (/[Ѐ-ӿ]/.test(texto)) return 'ru';
  if (/[ऀ-ॿ]/.test(texto)) return 'hi';

  // Palavras-chave latinas
  if (/\b(hello|hi|invest|interest|return|how|what|when|thanks|money|project)\b/.test(t)) return 'en';
  if (/\b(hola|invertir|interés|cómo|cuándo|qué|gracias|dinero|proyecto)\b/.test(t)) return 'es';
  if (/\b(bonjour|investir|intérêt|comment|quand|merci|argent|projet)\b/.test(t)) return 'fr';
  if (/\b(hallo|investieren|interesse|wie|wann|danke|geld|projekt)\b/.test(t)) return 'de';
  if (/\b(ciao|investire|interesse|come|quando|grazie|soldi|progetto)\b/.test(t)) return 'it';
  if (/\b(hoi|investeren|interesse|hoe|wanneer|dank|geld|project)\b/.test(t)) return 'nl';
  if (/\b(merhaba|yatırım|ilgi|nasıl|ne|teşekkür|para|proje)\b/.test(t)) return 'tr';

  // PT como fallback para texto latino
  return 'pt';
}

/** Detecta idioma. Usa heurística; se incerto, chama Claude. */
export async function detectarIdioma(texto, usarIA = false) {
  if (!texto) return 'pt';

  const heur = heuristica(texto);

  // Para scripts não-latinos a heurística é precisa — não precisa de IA
  if (['zh','ja','ko','ar','ru','hi'].includes(heur)) return heur;

  // Para latínico curto e ambíguo, pode usar IA se disponível
  if (usarIA && texto.length < 50 && process.env.ANTHROPIC_API_KEY !== 'COLE_SUA_CHAVE_AQUI') {
    try {
      const r = await chamarClaude(
        'You are a language detector. Reply with ONLY the ISO 639-1 code (e.g. pt, en, es, fr, de, it, nl, ru, ar, zh, ja, ko, hi, tr). Nothing else.',
        texto
      );
      const code = r?.trim().toLowerCase().slice(0, 5);
      if (code && IDIOMAS[code]) return code;
    } catch { /* usa heurística */ }
  }

  return heur || 'pt';
}

/** Retorna instrução de idioma para o prompt do agente */
export function instrucaoIdioma(codigoIdioma) {
  const info = IDIOMAS[codigoIdioma] || IDIOMAS.pt;
  return `INSTRUÇÃO DE IDIOMA — OBRIGATÓRIA:
Responda EXCLUSIVAMENTE em ${info.nativo} (${info.ptbr}).
Escreva como falante nativo — não traduza do português, construa a resposta diretamente em ${info.nativo}.
Use vocabulário empresarial natural, formalidade adequada ao contexto ${info.formal ? '(formal)' : '(conversacional)' }.
Preserve todos os valores numéricos, percentuais e datas exatamente como estão na base de conhecimento.`;
}

/** Resumo em PT para a equipe quando transferir lead internacional */
export function instrucaoResumoEquipe(codigoIdioma) {
  if (codigoIdioma === 'pt') return '';
  const info = IDIOMAS[codigoIdioma] || { ptbr: 'idioma desconhecido' };
  return `\n\n[INSTRUÇÃO ADICIONAL PARA TRANSFERÊNCIA]: Ao encaminhar para a equipe, gere também um resumo em PORTUGUÊS BRASILEIRO com: nome do lead, idioma (${info.ptbr}), principais dúvidas levantadas, etapa comercial atual e próxima ação recomendada. Coloque este resumo entre as tags <!--RESUMO_EQUIPE: ... -->.`;
}
