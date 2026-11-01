# Sus Pad

Pads, bateria, click e repertório para banda ao vivo. Um computador ou tablet ligado à mesa de som é o **host** (a saída de áudio). Os músicos controlam tudo pelo celular, pela rede local ou pela internet.

## Como usar

1. **No aparelho da mesa:** abra o app e toque em **Criar sala**. Os PINs são opcionais.
2. **Nos celulares:** escaneie o QR Code da sala (toque no código, no canto superior esquerdo) ou digite o código de 4 caracteres e escolha a função.
3. **Para tocar sozinho,** sem sala, use **Tocar sem sala**.

| Recurso | O que faz |
| --- | --- |
| Pads | 12 tons × 8 timbres em loop contínuo. Ao trocar de timbre, o som atual continua até o novo carregar e então faz crossfade. No Mixer: **Brilho** (filtro) e **Transição** (tempo da troca entre tons). |
| Bateria | 5 kits com 8 sons cada. No computador, use as teclas Q W E R · A S D F. |
| Click | BPM, tap, compasso, 4 sons, colcheias, modo **Só contagem** (um compasso e para) e pan para mandar o click só ao fone da banda. No 6/8 o tempo 4 também é acentuado. Os celulares mostram o tempo piscando junto com o host. |
| Músicas | Vários repertórios, arrastar para reordenar, anotações por música, **Próxima** e ±½ tom ao vivo. **Colar lista** lê a mensagem do WhatsApp (com o tom de cada música) e **Compartilhar** gera o texto para o grupo. |
| Cifras | Aba **Cifra**: cole a cifra do Cifra Club (ou **Colar do clipboard**, que já salva) e o app tira o título, reconhece os acordes e o tom, e mostra a cifra. Também aceita `[G]Letra` na mesma linha. Sem música ativa, ele cria a música. −½/+½ transpõe cifra e pad juntos. Em cada aparelho: **Capo** (com sugestão de qual deixa os acordes em formas abertas), **Simples** (só tríades), **Rolar** (rolagem automática com velocidade) e **Palco** (tela cheia, letra grande; Esc sai). Todos da sala leem a cifra da música ativa; só o aparelho da mesa cola e edita. |
| Sinais | Avisos grandes em todos os aparelhos: Repete, Última vez, Segura, Volta ao início, Fim… ou um texto livre. |
| Mixer | Volume de pads, bateria, click e master, sincronizado com a sala. |
| Permissões | O host escolhe o que tecladista, baterista e host remoto podem controlar (tela da sala). Cada músico pode informar o nome ao entrar. |
| Teclado do computador | 1–0, − e = tocam os 12 tons; Espaço para o pad; → próxima música; Q W E R · A S D F bateria. |
| MIDI | Em **Ajustes**: qualquer nota toca o pad do mesmo tom e o pedal de sustain avança para a próxima música. Funciona no Chrome e no Edge. |
| Sem internet | Em **Ajustes**, **Baixar todos os sons** (~85 MB) deixa o app tocando com a internet instável. Requer HTTPS. |
| Conta da banda | Os repertórios ficam salvos na conta e aparecem em qualquer aparelho. Entra com e-mail e senha ou, se o servidor tiver `GOOGLE_CLIENT_ID`, com o botão do Google. |

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
npm test           # 44 testes: servidor real + WebSocket, segurança, repertórios, leitura de listas, cifras e transposição, permissões, catálogo de áudio
npm run lint       # ESLint
npm run check      # os dois
```

No GitHub, `.github/workflows/ci.yml` roda lint e testes a cada push.

## Deploy (Railway ou Render)

O servidor precisa de um processo Node contínuo, por causa dos WebSockets e do estado em memória, e de um disco persistente para o SQLite.

| Variável | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Chave longa e aleatória (`openssl rand -hex 32`). Obrigatória em produção. |
| `DATA_DIR` | Pasta do volume persistente: Railway `/app/data`, Render `/var/data` |
| `GOOGLE_CLIENT_ID` | Opcional. Ativa "Continuar com o Google" (veja abaixo). |

**Railway:** crie um projeto em New Project → Deploy from GitHub repo, defina as variáveis e adicione um Volume em `/app/data`. Depois, em Networking, use Generate Domain.

**Render:** crie um Web Service com o comando de build `npm install` e o de start `npm start`. Defina as variáveis e adicione um Disk em `/var/data`.

### Entrar com o Google (opcional)

1. Em console.cloud.google.com, crie um projeto e vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth** (tipo **Aplicativo da Web**).
2. Em **Origens JavaScript autorizadas**, adicione o endereço do app (por exemplo `https://seu-app.up.railway.app`). Para testar no computador, adicione também `http://localhost:3000`.
3. Copie o ID do cliente e defina `GOOGLE_CLIENT_ID` no servidor. O botão aparece sozinho na tela de conta.

Quem entra pelo Google e quem usa e-mail e senha com o mesmo e-mail caem na mesma conta.

Se o front-end ficar em outro domínio, defina `window.SUSPAD_WS_URL = "wss://seu-servico"` antes de carregar `js/main.js`.

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
  js/setlist-text.js                   colar/compartilhar repertório em texto
  js/chords.js                         cifras: reconhecer acordes e transpor
  js/shortcuts.js                      atalhos do teclado
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
