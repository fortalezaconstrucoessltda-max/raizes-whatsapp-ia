/**
 * Base44 REST client — server-side only.
 * Usa a API Key de serviço (não o JWT do usuário).
 * Base URL: https://app-server.base44.com/api/apps/{appId}/entities/{Entity}
 */
import { logger } from './logger.js';

const BASE = () =>
  `https://app-server.base44.com/api/apps/${process.env.BASE44_APP_ID}/entities`;

const HEADERS = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.BASE44_API_KEY}`,
});

async function req(method, path, body) {
  const url = `${BASE()}${path}`;
  try {
    const r = await fetch(url, {
      method,
      headers: HEADERS(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    return await r.json();
  } catch (e) {
    logger.error(`[BASE44] ${method} ${path} falhou`, e.message);
    throw e;
  }
}

export const base44 = {
  Lead: {
    list:   (params = {}) => req('GET',  `/Lead?${new URLSearchParams(params)}`),
    get:    (id)           => req('GET',  `/Lead/${id}`),
    create: (data)         => req('POST', '/Lead', data),
    update: (id, data)     => req('PUT',  `/Lead/${id}`, data),
  },
  Afiliado: {
    list: (params = {}) => req('GET', `/Afiliado?${new URLSearchParams(params)}`),
    get:  (id)          => req('GET', `/Afiliado/${id}`),
  },
  Investimento: {
    list: (params = {}) => req('GET', `/Investimento?${new URLSearchParams(params)}`),
  },
};
