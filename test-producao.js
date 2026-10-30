/**
 * Benchmark de Produção: Host + Tecladista + Baterista + Líder
 * Envia 100 mensagens por papel e calcula Média, P95 e Máximo de latência.
 */

const WebSocket = require('ws');

const TARGET_URL = process.env.WS_URL || 'ws://localhost:3000';
const MESSAGES_PER_ROLE = 100;

console.log(`\n======================================================`);
console.log(`  🔥 BENCHMARK DE PRODUÇÃO - PADSTUDIO LIVE`);
console.log(`  Alvo: ${TARGET_URL}`);
console.log(`  Mensagens por papel: ${MESSAGES_PER_ROLE} (Total: ${MESSAGES_PER_ROLE * 3})`);
console.log(`======================================================\n`);

function calculateStats(samples) {
  if (!samples || samples.length === 0) return { avg: 0, p95: 0, max: 0, min: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[p95Index];
  return {
    min: min.toFixed(2),
    avg: avg.toFixed(2),
    p95: p95.toFixed(2),
    max: max.toFixed(2)
  };
}

async function runBenchmark() {
  return new Promise((resolve, reject) => {
    let roomCode = null;

    const latencies = {
      pingKeyboardist: [],
      pingDrummer: [],
      pingLeader: [],
      relayPad: [],
      relayDrum: [],
      relayLeader: []
    };

    const hostWs = new WebSocket(TARGET_URL);
    let kbWs = null;
    let drumWs = null;
    let leaderWs = null;

    // 1. HOST setup
    hostWs.on('open', () => {
      hostWs.send(JSON.stringify({ type: 'create_room', name: 'PA de Produção' }));
    });

    hostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        console.log(`✅ [1/5] Sala de Alta Performance Criada: [${roomCode}]`);
        connectAllClients(roomCode);
      } else if (msg._sentAt) {
        const delta = performance.now() - msg._sentAt;
        if (msg.type === 'pad_on') latencies.relayPad.push(delta);
        if (msg.type === 'drum') latencies.relayDrum.push(delta);
        if (msg.type === 'bpm') latencies.relayLeader.push(delta);
      }
    });

    function connectAllClients(code) {
      let connectedCount = 0;
      function checkAllReady() {
        connectedCount++;
        if (connectedCount === 3) {
          console.log(`✅ [2/5] Todos os 4 membros conectados (Host, Tecladista, Baterista, Líder).`);
          startStressTest();
        }
      }

      // Tecladista
      kbWs = new WebSocket(TARGET_URL);
      kbWs.on('open', () => {
        kbWs.send(JSON.stringify({ type: 'join_room', roomCode: code, role: 'keyboardist', name: 'Tecladista Test' }));
      });
      kbWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') checkAllReady();
        if (msg.type === 'pong' && msg.clientTime) {
          latencies.pingKeyboardist.push(performance.now() - msg.clientTime);
        }
      });

      // Baterista
      drumWs = new WebSocket(TARGET_URL);
      drumWs.on('open', () => {
        drumWs.send(JSON.stringify({ type: 'join_room', roomCode: code, role: 'drummer', name: 'Baterista Test' }));
      });
      drumWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') checkAllReady();
        if (msg.type === 'pong' && msg.clientTime) {
          latencies.pingDrummer.push(performance.now() - msg.clientTime);
        }
      });

      // Líder
      leaderWs = new WebSocket(TARGET_URL);
      leaderWs.on('open', () => {
        leaderWs.send(JSON.stringify({ type: 'join_room', roomCode: code, role: 'leader', name: 'Líder Test' }));
      });
      leaderWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') checkAllReady();
        if (msg.type === 'pong' && msg.clientTime) {
          latencies.pingLeader.push(performance.now() - msg.clientTime);
        }
      });
    }

    async function startStressTest() {
      console.log(`⚡ [3/5] Enviando ${MESSAGES_PER_ROLE} pings simultâneos de cada papel...`);
      for (let i = 0; i < MESSAGES_PER_ROLE; i++) {
        kbWs.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
        drumWs.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
        leaderWs.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
        await new Promise(r => setTimeout(r, 10));
      }

      console.log(`⚡ [4/5] Disparando ${MESSAGES_PER_ROLE} comandos de som e controle em tempo real...`);
      for (let i = 0; i < MESSAGES_PER_ROLE; i++) {
        // Tecladista toca tom
        kbWs.send(JSON.stringify({
          type: 'pad_on',
          toneIndex: i % 12,
          _sentAt: performance.now()
        }));

        // Baterista bate pad
        drumWs.send(JSON.stringify({
          type: 'drum',
          drumId: `p${(i % 8) + 1}`,
          velocity: 0.9,
          _sentAt: performance.now()
        }));

        // Líder ajusta BPM
        leaderWs.send(JSON.stringify({
          type: 'bpm',
          value: 100 + (i % 50),
          _sentAt: performance.now()
        }));

        await new Promise(r => setTimeout(r, 12));
      }

      setTimeout(() => {
        console.log(`✅ [5/5] Carga concluída com sucesso! Calculando métricas...`);

        const kbPingStats = calculateStats(latencies.pingKeyboardist);
        const drPingStats = calculateStats(latencies.pingDrummer);
        const ldPingStats = calculateStats(latencies.pingLeader);

        const padRelayStats = calculateStats(latencies.relayPad);
        const drumRelayStats = calculateStats(latencies.relayDrum);
        const leaderRelayStats = calculateStats(latencies.relayLeader);

        console.log('\n===================================================================');
        console.log('              📊 RESULTADOS FINAIS DE BENCHMARK');
        console.log('===================================================================');
        console.log('Operação              | Amostras | Mín (ms) | Méd (ms) | P95 (ms) | Máx (ms)');
        console.log('----------------------|----------|----------|----------|----------|---------');
        console.log(`Ping Tecladista (RTT) | ${latencies.pingKeyboardist.length.toString().padEnd(8)} | ${kbPingStats.min.padEnd(8)} | ${kbPingStats.avg.padEnd(8)} | ${kbPingStats.p95.padEnd(8)} | ${kbPingStats.max}`);
        console.log(`Ping Baterista  (RTT) | ${latencies.pingDrummer.length.toString().padEnd(8)} | ${drPingStats.min.padEnd(8)} | ${drPingStats.avg.padEnd(8)} | ${drPingStats.p95.padEnd(8)} | ${drPingStats.max}`);
        console.log(`Ping Líder      (RTT) | ${latencies.pingLeader.length.toString().padEnd(8)} | ${ldPingStats.min.padEnd(8)} | ${ldPingStats.avg.padEnd(8)} | ${ldPingStats.p95.padEnd(8)} | ${ldPingStats.max}`);
        console.log(`Relay Pad  (Tecl->PA) | ${latencies.relayPad.length.toString().padEnd(8)} | ${padRelayStats.min.padEnd(8)} | ${padRelayStats.avg.padEnd(8)} | ${padRelayStats.p95.padEnd(8)} | ${padRelayStats.max}`);
        console.log(`Relay Drum (Bate->PA) | ${latencies.relayDrum.length.toString().padEnd(8)} | ${drumRelayStats.min.padEnd(8)} | ${drumRelayStats.avg.padEnd(8)} | ${drumRelayStats.p95.padEnd(8)} | ${drumRelayStats.max}`);
        console.log(`Relay BPM  (Líde->PA) | ${latencies.relayLeader.length.toString().padEnd(8)} | ${leaderRelayStats.min.padEnd(8)} | ${leaderRelayStats.avg.padEnd(8)} | ${leaderRelayStats.p95.padEnd(8)} | ${leaderRelayStats.max}`);
        console.log('===================================================================\n');

        hostWs.close();
        kbWs.close();
        drumWs.close();
        leaderWs.close();
        resolve();
      }, 500);
    }
  });
}

runBenchmark()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Falha no benchmark:', err);
    process.exit(1);
  });

