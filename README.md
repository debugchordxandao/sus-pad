# 🎵 PadStudio Live - Sistema Colaborativo de Áudio para Banda ao Vivo

O **PadStudio Live** transforma um computador ou tablet conectado à mesa de som no **HOST de Áudio**, permitindo que os músicos controlem os sons diretamente de seus celulares e tablets via rede Wi-Fi local ou nuvem persistente, com **latência ultrabaixa (< 10 ms)**.

---

## ☁️ Deploy em Nuvem Persistente (Railway ou Render)

Diferente de plataformas serverless (como a Vercel, que não mantêm WebSockets abertos nem estado em memória), o PadStudio Live deve ser executado em um **serviço Node.js contínuo com WebSockets bidirecionais (`TCP_NODELAY`) e volume persistente**.

### 1. Deploy no Railway (Recomendado - 2 minutos)
1. Crie uma conta em [railway.app](https://railway.app/).
2. Clique em **"New Project"** -> **"Deploy from GitHub repo"** e selecione o repositório do PadStudio Live.
3. O Railway detectará o arquivo `Procfile` e `package.json` automaticamente.
4. Em **Variables** do serviço, configure:
   - `JWT_SECRET`: Insira uma chave aleatória longa e segura (ex: `openssl rand -hex 32`).
   - `DATA_DIR`: `/app/data` (ou deixe o padrão `./data`).
   - `PORT`: O Railway define automaticamente.
5. *(Opcional)* Em **Volumes**, adicione um volume persistente montado em `/app/data` para que as contas e repertórios nunca sejam perdidos entre deploys.
6. Em **Networking**, clique em **Generate Domain** para obter a URL pública (ex: `https://padstudio-live.up.railway.app`).

### 2. Deploy no Render
1. Acesse [render.com](https://render.com/) e clique em **"New +"** -> **"Web Service"**.
2. Conecte o repositório GitHub.
3. Configure os campos:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
4. Em **Environment Variables**, adicione:
   - `JWT_SECRET`: Chave secreta de 64 caracteres.
   - `DATA_DIR`: `/var/data`
5. Em **Disks** (plano com disco persistente), monte um disco em `/var/data`.
6. Conclua o deploy. O Render fornecerá a URL pública com SSL gratuito.

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

- Os 96 timbres contínuos de pads foram otimizados de WAV (610 MB) para **AAC M4A a 160 kbps de altíssima fidelidade** (70 MB), garantindo:
  - Redução de tamanho de **653 MB para 113 MB total**.
  - Loops perfeitamente suaves e sem estalos.
  - Carregamento quase instantâneo em conexões móveis.
  - Compatibilidade universal com o Web Audio API em todos os dispositivos (iOS, macOS, Android, Windows).
- Os arquivos originais WAV não compactados estão preservados em backup local em `_audio_backup_wav/` fora do pacote de deploy.

---

## 🛡️ Endpoints de Verificação e Health Check

- `GET /health` -> Retorna status operacional, uptime e timestamp (para balanceadores e monitoramento).
- `GET /api/server-info` -> Retorna os IPs de rede local e porta.
- `GET /api/auth/me` -> Perfil da banda e repertório na nuvem (protegido por JWT).
