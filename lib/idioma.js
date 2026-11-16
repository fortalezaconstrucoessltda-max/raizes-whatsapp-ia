/**
 * Detecção de idioma — heurística rápida
 * Nunca bloqueia o atendimento: se falhar, assume português.
 */
import { chamarClaude } from './ia.js';

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

function heuristica(texto) {
  if (!texto || texto.length < 2) return 'pt';
  const t = texto.toLowerCase();

  // Scripts não-latinos — detectáveis por Unicode
  if (/[一-鿿]/.test(texto)) return 'zh';
  if (/[぀-ヿㇰ-ㇿ]/.test(texto)) return 'ja';
  if (/[가-힯]/.test(texto)) return 'ko';
  if (/[؀-ۿ]/.test(texto)) return 'ar';
  if (/[Ѐ-ӿ]/.test(texto)) return 'ru';
  if (/[ऀ-ॿ]/.test(texto)) return 'hi';

  // Português — detecção positiva (palavras exclusivas ou muito frequentes em PT)
  if (/\b(oi|olá|ola|bom dia|boa tarde|boa noite|obrigado|obrigada|quero|gostaria|preciso|investir|usina|funciona|faço|faco|como|quanto|posso|tenho|você|voce|seu|sua|nossa|nosso|isso|esse|essa|aqui|para|pelo|pela|mais|muito|não|nao|sim|meu|minha|tudo|bem|certo|ok|claro|entendi|perfeito)\b/.test(t)) return 'pt';

  // Inglês
  if (/\b(hello|hi|hey|invest|interest|return|how|what|when|thanks|money|project|good morning|good afternoon)\b/.test(t)) return 'en';

  // Espanhol — palavras exclusivas (não compartilhadas com PT)
  if (/\b(hola|invertir|cómo|cuándo|qué|gracias|dinero|proyecto|buenos días|buenas)\b/.test(t)) return 'es';

  // Francês — palavras exclusivas
  if (/\b(bonjour|bonsoir|merci|investir|intérêt|comment|quand|argent|projet|salut)\b/.test(t)) return 'fr';

  // Alemão
  if (/\b(hallo|guten|investieren|wie|wann|danke|geld|projekt)\b/.test(t)) return 'de';

  // Italiano
  if (/\b(ciao|buongiorno|investire|come|quando|grazie|soldi|progetto)\b/.test(t)) return 'it';

  // Turco
  if (/\b(merhaba|yatırım|nasıl|teşekkür|para|proje)\b/.test(t)) return 'tr';

  // PT como fallback para qualquer texto latino
  return 'pt';
}

/** Detecta idioma. Usa apenas heurística — IA desativada para evitar erros. */
export async function detectarIdioma(texto) {
  if (!texto) return 'pt';
  return heuristica(texto);
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
