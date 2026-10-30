# 🎵 PadStudio Live - Sistema Colaborativo de Áudio para Banda ao Vivo

O **PadStudio Live** transforma um computador ou tablet conectado à mesa de som no **HOST de Áudio**, permitindo que os músicos controlem os sons diretamente de seus celulares e tablets via rede Wi-Fi local ou nuvem persistente, com **latência ultrabaixa (< 10 ms)**.

---

## ☁️ Deploy em Nuvem Persistente (Railway ou Render)

Diferente de plataformas serverless (como a Vercel, que não mantêm WebSockets abertos nem estado em memória), o PadStudio Live deve ser executado em um **serviço Node.js contínuo com WebSockets bidirecionais (`TCP_NODELAY`) e volume persistente**.

### 1. Deploy no Railway (Recomendado - Passo a Passo Exato)
1. Crie ou acesse sua conta em [railway.app](https://railway.app/).
2. No seu painel (Dashboard), clique no botão **"New Project"**.
3. Selecione a opção **"Deploy from GitHub repo"** e escolha o repositório privado do `PadStudio-Live`.
4. O Railway detectará o arquivo `Procfile` e o `package.json` de forma 100% automática.
5. Clique no card do serviço recém-criado e acesse a aba **"Variables"**:
   - Clique em **"Add Variable"** e defina `NODE_ENV` com o valor `production`.
   - Clique em **"Add Variable"** e defina `JWT_SECRET` com uma chave segura de 32+ caracteres (ex: execute `openssl rand -hex 32` no seu terminal e cole o resultado).
   - Clique em **"Add Variable"** e defina `DATA_DIR` com o valor `/app/data`.
6. Acesse a aba **"Volumes"** do serviço:
   - Clique em **"Add Volume"** (ou **"Mount Volume"**).
   - Defina o **Mount Path** exatamente como: `/app/data`.
   - Salve. Isso garante que o banco de dados (SQLite/JSON) com as contas, salas e repertórios fique gravado permanentemente mesmo quando houver novos deploys.
7. Acesse a aba **"Settings"** -> role até **"Networking"** -> clique no botão **"Generate Domain"** para receber sua URL pública segura com SSL (`https://padstudio-live.up.railway.app`).

### 2. Deploy no Render (Alternativa)
1. Acesse [render.com](https://render.com/) e clique no botão azul **"New +"** -> selecione **"Web Service"**.
2. Conecte sua conta do GitHub e selecione o repositório `PadStudio-Live`.
3. Preencha os campos da tela de configuração:
   - **Name:** `padstudio-live`
   - **Region:** Selecione a região mais próxima (ex: Ohio ou Frankfurt).
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health` (o Render usará para verificar se o serviço e o disco estão operacionais).
4. Em **Environment Variables**, adicione:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: sua chave segura gerada via terminal.
   - `DATA_DIR`: `/var/data`
5. Na seção **Disks** (requer plano com suporte a disco persistente):
   - Clique em **"Add Disk"**.
   - Defina o **Name**: `padstudio-data`.
   - Defina o **Mount Path**: `/var/data`.
   - Defina o **Size**: 1 GB.
6. Clique no botão inferior **"Create Web Service"**. O Render fará o build e fornecerá sua URL pública.

### 3. Conexão Cliente-Servidor (Zero Config)
- **Mesmo domínio (padrão):** O app usa automaticamente `window.location.host` e se conecta via `wss://` (ou `ws://`) sem precisar de configuração alguma.
- **Frontend hospedado separadamente:** Se hospedar o HTML em outro servidor, basta definir antes do `app.js`:
  ```html
  <script>window.PADSTUDIO_WS_URL = "wss://seu-servico.up.railway.app";</script>
  ```

---

## 🚀 Como Iniciar no Modo Local (Offline no Wi-Fi do Ensaio)

Ideal para shows, cultos e ensaios **sem depender de internet**:

```bash
# 1. Instalar as dependências
npm install

# 2. Iniciar o servidor local
npm start
```

O terminal exibirá os endereços:
* **No computador/mesa:** `http://localhost:3000`
* **Nos celulares dos músicos (mesmo Wi-Fi):** `http://<IP-LOCAL>:3000` (ex: `http://192.168.1.15:3000`)
* O QR Code gerado na tela do HOST usa o IP local real automaticamente.

---

## 🔒 HTTPS Local com `mkcert` (Para PWA e Wake Lock no Celular)

Navegadores móveis (Safari no iOS e Chrome no Android) exigem conexão segura (**HTTPS**) para:
1. **Wake Lock API:** Manter a tela do celular sempre acesa durante o culto.
2. **PWA (Instalar na tela inicial):** Instalar como app nativo em tela cheia.

### Passo a passo no Mac:
```bash
# 1. Instalar o mkcert
brew install mkcert
mkcert -install

# 2. Descubra seu IP local (ex: 192.168.1.15) e gere os certificados na raiz do projeto:
mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 <SEU-IP-LOCAL>

# 3. Reinicie o servidor:
npm start
```
O servidor detectará automaticamente `key.pem` e `cert.pem` e iniciará em `https://`.

---

## 🎛️ Otimização dos Arquivos de Áudio

- Os 96 timbres contínuos de pads foram otimizados de WAV (610 MB) para **AAC M4A a 160 kbps** (70 MB):
  - Redução de tamanho de **653 MB para 113 MB total**.
  - O áudio toca o swell inicial de ataque uma única vez e entra em loop contínuo de sustentação com crossfade senoidal de igual potência pré-renderizado.
  - **Validação Objetiva Concluída (100% de Aprovação):** Todos os 96 pads cumprem os critérios de variação de volume na emenda $\le 1.5$ dB e salto de amostra $\le 0.02$.
  - Para auditar ou verificar as métricas de cada arquivo, execute:
    ```bash
    node scripts/generate-official-table.js
    ```
  - Compatibilidade universal com Web Audio API em iOS, Android, macOS e Windows.
- Os arquivos originais WAV não compactados estão preservados em backup local em `_audio_backup_wav/` fora do pacote de deploy.

---

## 🛡️ Endpoints de Verificação e Health Check

- `GET /health` -> Retorna status operacional, uptime e timestamp (para balanceadores e monitoramento).
- `GET /api/server-info` -> Retorna os IPs de rede local e porta.
- `GET /api/auth/me` -> Perfil da banda e repertório na nuvem (protegido por JWT).
