# Deploy — Raízes WhatsApp IA Server

## 1. Railway (recomendado)

1. Acessa **railway.app** e entra na sua conta
2. Clica em **New Project → Deploy from GitHub repo**
   - Se não tiver GitHub, usa **New Project → Empty Project → Add a Service → GitHub Repo**
   - Faz upload deste ZIP como repositório novo
3. No serviço criado, vai em **Variables** e adiciona:

```
ZAPI_INSTANCE_ID     = 3FC38DCF200AC12EF009CE9821AFC667
ZAPI_TOKEN           = 0A0DBE595099BC344959BCBF
ZAPI_CLIENT_TOKEN    = F0512db98899d4c7f9acb5b95c55c571cS
ADMIN_PHONE          = 5571996578028
BASE44_APP_ID        = 6ad852c7083c3f0fb2b1d586
BASE44_API_KEY       = (pegar em Base44 > Settings > API Keys)
ANTHROPIC_API_KEY    = (pegar em console.anthropic.com)
WEBHOOK_SECRET       = raizes2025
NODE_ENV             = production
```

4. Clica em **Deploy**
5. Quando ficar verde, pega a URL gerada (ex: `https://raizes-wa.up.railway.app`)

## 2. Configurar webhook no Z-API

1. Acessa **app.z-api.io** → sua instância do número 71
2. Vai em **Webhooks**
3. Em "URL do webhook", cola:
   ```
   https://SUA-URL-RAILWAY.up.railway.app/webhook/zapi
   ```
4. Salva

## 3. Testar

Testar health:
```
GET https://SUA-URL/health
```

Testar envio manual:
```
POST https://SUA-URL/send
{
  "fone": "5571...",
  "mensagem": "teste",
  "secret": "raizes2025"
}
```

Testar webhook: envie uma mensagem para o número 71 no WhatsApp.

## 4. Controle de atendimento humano

Pausar IA para um número:
```
POST https://SUA-URL/webhook/zapi/controle
{
  "acao": "pausar",
  "fone": "5571...",
  "secret": "raizes2025"
}
```

Retomar IA:
```
POST https://SUA-URL/webhook/zapi/controle
{
  "acao": "retomar",
  "fone": "5571...",
  "secret": "raizes2025"
}
```

## 5. Pegar API Key do Base44

1. Acessa **app.base44.com** → seu projeto
2. Vai em **Settings** (engrenagem) → **API Keys**
3. Cria uma nova chave com permissão de leitura e escrita em Lead
4. Cola no Railway como `BASE44_API_KEY`

## 6. Pegar API Key do Claude

1. Acessa **console.anthropic.com**
2. Vai em **API Keys → Create Key**
3. Cola no Railway como `ANTHROPIC_API_KEY`
