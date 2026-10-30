/**
 * Automated Test: Host + Keyboardist + Drummer via WebSocket
 * Measures round-trip ping latency and relay time for audio events.
 */

const WebSocket = require('ws');

const TARGET_URL = process.env.WS_URL || 'ws://localhost:3000';

console.log(`\n====================================================`);
console.log(`  🚀 INICIANDO TESTE AUTOMATIZADO DE RELAY & LATÊNCIA`);
console.log(`  Alvo: ${TARGET_URL}`);
console.log(`====================================================\n`);

async function run() {
  return new Promise((resolve, reject) => {
    let roomCode = null;
    const results = {
      pingLatency: {},
      relayLatency: {}
    };

    // 1. Conectar HOST
    const hostWs = new WebSocket(TARGET_URL);

    hostWs.on('open', () => {
      console.log('✅ [1/7] Conexão HOST estabelecida.');
      hostWs.send(JSON.stringify({
        type: 'create_room',
        name: 'Mesa de Som (PA)'
      }));
    });

    hostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);

      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        console.log(`✅ [2/7] Sala criada com sucesso: [${roomCode}]`);
        connectKeyboardist(roomCode);
      } else if (msg.type === 'pad_on') {
        const receivedAt = performance.now();
        const duration = (receivedAt - msg._sentAt).toFixed(2);
        results.relayLatency.padOn = duration;
        console.log(`⚡ [RELAY PAD] HOST recebeu pad_on (tom: ${msg.toneIndex}) em ${duration} ms`);
      } else if (msg.type === 'drum') {
        const receivedAt = performance.now();
        const duration = (receivedAt - msg._sentAt).toFixed(2);
        results.relayLatency.drum = duration;
        console.log(`⚡ [RELAY BATERIA] HOST recebeu drum (${msg.drumId}) em ${duration} ms`);
      }
    });

    // 2. Conectar Tecladista
    let kbWs = null;
    function connectKeyboardist(code) {
      kbWs = new WebSocket(TARGET_URL);
      kbWs.on('open', () => {
        console.log('✅ [3/7] Conexão Tecladista estabelecida.');
        kbWs.send(JSON.stringify({
          type: 'join_room',
          roomCode: code,
          role: 'keyboardist',
          name: 'Tecladista Mobile'
        }));
      });

      kbWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') {
          console.log('✅ [4/7] Tecladista entrou na sala!');
          connectDrummer(code);
        } else if (msg.type === 'pong') {
          const now = performance.now();
          const rtt = (now - msg.clientTime).toFixed(2);
          results.pingLatency.keyboardist = rtt;
          console.log(`🏓 [PING TECLADISTA] Round-Trip Time (RTT): ${rtt} ms`);
        } else if (msg.type === 'permission_denied') {
          console.log(`🛡️ [SEGURANÇA] Ação bloqueada pelo servidor conforme esperado: ${msg.action || msg.message}`);
          results.permissionDeniedPassed = true;
          finishTest();
        }
      });
    }

    // 3. Conectar Baterista
    let drumWs = null;
    function connectDrummer(code) {
      drumWs = new WebSocket(TARGET_URL);
      drumWs.on('open', () => {
        console.log('✅ [5/7] Conexão Baterista estabelecida.');
        drumWs.send(JSON.stringify({
          type: 'join_room',
          roomCode: code,
          role: 'drummer',
          name: 'Baterista Mobile'
        }));
      });

      drumWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') {
          console.log('✅ [6/7] Baterista entrou na sala!');
          measurePingsAndEvents();
        } else if (msg.type === 'pong') {
          const now = performance.now();
          const rtt = (now - msg.clientTime).toFixed(2);
          results.pingLatency.drummer = rtt;
          console.log(`🏓 [PING BATERISTA] Round-Trip Time (RTT): ${rtt} ms`);
        }
      });
    }

    // 4. Medir Pings e Ações em Tempo Real
    function measurePingsAndEvents() {
      console.log('⏱️ [7/7] Disparando medições de latência...');

      // Medir Ping Tecladista
      kbWs.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));

      // Medir Ping Baterista
      drumWs.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));

      // Disparar Pad do Tecladista
      setTimeout(() => {
        kbWs.send(JSON.stringify({
          type: 'pad_on',
          toneIndex: 0,
          _sentAt: performance.now()
        }));
      }, 100);

      // Disparar Drum do Baterista
      setTimeout(() => {
        drumWs.send(JSON.stringify({
          type: 'drum',
          drumId: 'p1',
          velocity: 1.0,
          _sentAt: performance.now()
        }));
      }, 200);

      // Testar Bloqueio de Permissão: Tecladista tenta enviar comando não autorizado (drum)
      setTimeout(() => {
        kbWs.send(JSON.stringify({
          type: 'drum',
          drumId: 'p2'
        }));
      }, 350);
    }

    function finishTest() {
      setTimeout(() => {
        console.log('\n====================================================');
        console.log('  📊 RELATÓRIO FINAL DE PERFORMANCE');
        console.log('====================================================');
        console.log(`• RTT Ping Tecladista:  ${results.pingLatency.keyboardist || 'N/A'} ms`);
        console.log(`• RTT Ping Baterista:   ${results.pingLatency.drummer || 'N/A'} ms`);
        console.log(`• Relay de Pad (KB->PA): ${results.relayLatency.padOn || 'N/A'} ms`);
        console.log(`• Relay Bateria (DR->PA):${results.relayLatency.drum || 'N/A'} ms`);
        console.log(`• Bloqueio de Permissão: ${results.permissionDeniedPassed ? 'APROVADO (Seguro)' : 'FALHOU'}`);
        console.log('====================================================\n');

        hostWs.close();
        kbWs.close();
        drumWs.close();
        resolve(results);
      }, 300);
    }
  });
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro no teste:', err);
    process.exit(1);
  });

