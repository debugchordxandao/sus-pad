# PadStudio Live

Pads, bateria, click e repertório para banda ao vivo. Um computador ou tablet ligado à mesa de som é o **host** (a saída de áudio). Os músicos controlam tudo pelo celular, pela rede local ou pela internet.

## Como usar

1. **No aparelho da mesa:** abra o app e toque em **Criar sala**. Os PINs são opcionais.
2. **Nos celulares:** escaneie o QR Code da sala (toque no código, no canto superior esquerdo) ou digite o código de 4 caracteres e escolha a função.
3. **Para tocar sozinho,** sem sala, use **Tocar sem sala**.

| Recurso | O que faz |
| --- | --- |
| Pads | 12 tons × 8 timbres em loop contínuo. Ao trocar de timbre, o som atual continua até o novo carregar e então faz crossfade. |
| Bateria | 5 kits com 8 sons cada. No computador, use as teclas Q W E R · A S D F. |
| Click | BPM, tap, compasso, 4 sons, colcheias, modo **Só contagem** (um compasso e para) e pan para mandar o click só ao fone da banda. |
| Músicas | Vários repertórios, arrastar para reordenar, anotações por música, **Próxima** e ±½ tom ao vivo. |
| Mixer | Volume de pads, bateria, click e master, sincronizado com a sala. |
| Permissões | O host escolhe o que tecladista, baterista e líder podem controlar (tela da sala). |
| MIDI | Em **Ajustes**: qualquer nota toca o pad do mesmo tom e o pedal de sustain avança para a próxima música. Funciona no Chrome e no Edge. |
| Sem internet | Em **Ajustes**, **Baixar todos os sons** (~85 MB) deixa o app tocando com a internet instável. Requer HTTPS. |
| Conta da banda | Os repertórios ficam salvos na conta e aparecem em qualquer aparelho. |

Se a aba do host for fechada, ao reabrir o app aparece **Voltar para a sala**. A banda continua na mesma sala, com mixer, permissões e repertório recuperados.

## Rodar localmente

Requer Node.js 22 ou mais novo.

```bash
npm install
npm start          # http://localhost:3000 e o IP da rede local no terminal
npm run dev        # reinicia sozinho ao salvar arquivos do servidor
```

### HTTPS na rede local

Com HTTPS, os celulares mantêm a tela acesa, instalam o app e guardam os sons offline.

```bash
npm run cert       # gera key.pem e cert.pem (usa mkcert se instalado; senão, openssl)
npm start          # sobe em https:// automaticamente
```

Sem HTTPS o app funciona normalmente. Para a tela não apagar, ele usa um vídeo mudo em loop.

## Qualidade

```bash
npm test           # 24 testes: servidor real + WebSocket, segurança, biblioteca, permissões, catálogo de áudio
npm run lint       # ESLint
npm run check      # os dois
```

## Deploy (Railway ou Render)

O servidor precisa de um processo Node contínuo, por causa dos WebSockets e do estado em memória, e de um disco persistente para o SQLite.

| Variável | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Chave longa e aleatória (`openssl rand -hex 32`). Obrigatória em produção. |
| `DATA_DIR` | Pasta do volume persistente: Railway `/app/data`, Render `/var/data` |

**Railway:** crie um projeto em New Project → Deploy from GitHub repo, defina as variáveis e adicione um Volume em `/app/data`. Depois, em Networking, use Generate Domain.

**Render:** crie um Web Service com o comando de build `npm install` e o de start `npm start`. Defina as variáveis e adicione um Disk em `/var/data`.

Se o front-end ficar em outro domínio, defina `window.PADSTUDIO_WS_URL = "wss://seu-servico"` antes de carregar `js/main.js`.

## Estrutura

```
public/
  index.html, styles.css, sw.js        interface e app offline (PWA)
  js/main.js                           ponto de entrada
  js/catalog.js                        timbres, kits e clicks (fonte única)
  js/audio-engine.js                   motor de áudio do host/solo
  js/library.js                        repertórios
  js/permissions.js                    o que cada função pode fazer
  js/store.js, js/actions.js           estado e ações (tudo passa por dispatch)
  js/net.js, js/midi.js, js/wake.js    sala, MIDI e tela acesa
  js/views/*.js                        telas
server/
  server.js        HTTP + WebSocket
  rooms.js         salas, estado e persistência
  routes.js        API (/api/auth, /api/rooms, /api/qr)
  permissions.js   mesma tabela do app (um teste garante)
  rate-limit.js    limites de tentativas (PIN, códigos de sala, login)
  db.js            SQLite
tests/             testes automáticos (npm test); tests/manual/ tem os roteiros antigos
tools/             calibração dos loops (em desenvolvimento: /dev/loop-test)
scripts/           certificado HTTPS, conversão de áudio, Git LFS, calibração
audio/             pads em M4A (com loop calibrado em pad-loops.json), bateria e clicks em FLAC
```

## Áudio

- **Pads:** 96 arquivos AAC/M4A (~71 MB). O ataque toca uma vez e o corpo entra em loop com crossfade senoidal calibrado. Todos têm emenda de no máximo 1,5 dB (`node scripts/generate-official-table.js`).
- **Bateria e clicks:** FLAC, sem perda. Saem idênticos aos WAV originais amostra a amostra e são 70% menores. Não foram para M4A porque o AAC adiciona 20–40 ms de silêncio no início de cada som.
- **Originais:** os WAV ficam em `_audio_backup_wav/`, fora do Git e do deploy.
- **Ao substituir um arquivo de áudio mantendo o nome,** aumente `AUDIO_CACHE` em `public/js/audio-engine.js`, para os aparelhos baixarem a versão nova.

## Endpoints

- `GET /health`: estado do servidor e do disco
- `GET /api/server-info`: IPs da rede local e porta
- `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
- `GET` e `PUT /api/auth/library`: repertórios da conta
- `GET /api/qr?text=`: QR Code
