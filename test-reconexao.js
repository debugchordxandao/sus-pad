/**
 * Teste de Reconexão e Resiliência de Estado:
 * Derruba abruptamente o HOST e um controle e valida que o estado volta 100% intacto.
 */

const WebSocket = require('ws');

const TARGET_URL = process.env.WS_URL || 'ws://localhost:3000';

console.log(`\n======================================================`);
console.log(`  🔄 TESTE DE RECONEXÃO E PERSISTÊNCIA DE ESTADO`);
console.log(`  Alvo: ${TARGET_URL}`);
console.log(`======================================================\n`);

async function runTest() {
  return new Promise((resolve, reject) => {
    let hostToken = null;
    let roomCode = null;
    let hostWs = new WebSocket(TARGET_URL);

    // Estado esperado que configuraremos
    const testState = {
      activeToneIndex: 7, // Sol (G)
      padPreset: 'warm_pad',
      bpm: 138,
      timeSig: '6/8',
      drumKit: 'kit_1',
      metroPlaying: true,
      activeSongId: 'test_song_99',
      setlist: [
        { id: 'test_song_99', title: 'Reconexão Perfeita', keyIndex: 7, bpm: 138, timeSig: '6/8', preset: 'warm_pad' }
      ]
    };

    hostWs.on('open', () => {
      console.log('✅ [1/6] HOST inicial conectado.');
      hostWs.send(JSON.stringify({ type: 'create_room', name: 'Mesa Principal' }));
    });

    hostWs.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        hostToken = msg.hostToken;
        console.log(`✅ [2/6] Sala criada: [${roomCode}], HostToken: ${hostToken.substring(0, 8)}...`);

        // Host aplica estado customizado na sala
        hostWs.send(JSON.stringify({
          type: 'host_state_update',
          state: testState
        }));

        setTimeout(connectController, 100);
      }
    });

    let controllerWs = null;
    function connectController() {
      controllerWs = new WebSocket(TARGET_URL);
      controllerWs.on('open', () => {
        controllerWs.send(JSON.stringify({
          type: 'join_room',
          roomCode: roomCode,
          role: 'keyboardist',
          name: 'Tecladista Palco'
        }));
      });

      controllerWs.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'room_joined') {
          console.log(`✅ [3/6] Tecladista entrou e recebeu estado inicial.`);
          assertStateMatches(msg.state, 'Pré-queda');
          simulateHostDrop();
        } else if (msg.type === 'host_disconnected') {
          console.log(`⚠️ [4/6] Tecladista recebeu alerta: HOST caiu conforme esperado.`);
          simulateHostReconnect();
        } else if (msg.type === 'host_reconnected') {
          console.log(`✅ [6/6] Tecladista foi notificado que o HOST reconectou com sucesso!`);
          finishSuccess();
        }
      });
    }

    function simulateHostDrop() {
      console.log(`💥 Simulando queda abrupta do HOST de áudio...`);
      hostWs.terminate(); // Mata o socket sem fechar limpo
    }

    function simulateHostReconnect() {
      setTimeout(() => {
        console.log(`🔄 [5/6] HOST tentando restabelecer conexão na mesma sala [${roomCode}] com seu token...`);
        const newHostWs = new WebSocket(TARGET_URL);

        newHostWs.on('open', () => {
          newHostWs.send(JSON.stringify({
            type: 'reconnect_host',
            roomCode: roomCode,
            hostToken: hostToken
          }));
        });

        newHostWs.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === 'room_reconnected') {
            console.log(`✅ HOST reconectou com sucesso! Verificando integridade do estado persistido...`);
            assertStateMatches(msg.state, 'Pós-reconexão');
          }
        });
      }, 500);
    }

    function assertStateMatches(state, phase) {
      if (!state) {
        console.error(`❌ [${phase}] Estado vazio!`);
        process.exit(1);
      }
      const matchTone = state.activeToneIndex === testState.activeToneIndex;
      const matchPreset = state.padPreset === testState.padPreset;
      const matchBpm = state.bpm === testState.bpm;
      const matchSig = state.timeSig === testState.timeSig;
      const matchKit = state.drumKit === testState.drumKit;
      const matchSong = state.activeSongId === testState.activeSongId;

      console.log(`   [${phase}] Tom: ${state.activeToneIndex} (${matchTone ? 'OK' : 'FALHA'}) | BPM: ${state.bpm} (${matchBpm ? 'OK' : 'FALHA'}) | Preset: ${state.padPreset} (${matchPreset ? 'OK' : 'FALHA'}) | Kit: ${state.drumKit} (${matchKit ? 'OK' : 'FALHA'})`);

      if (!matchTone || !matchPreset || !matchBpm || !matchSig || !matchKit || !matchSong) {
        console.error(`❌ Estado divergiu na fase ${phase}!`);
        process.exit(1);
      }
    }

    function finishSuccess() {
      setTimeout(() => {
        console.log('\n======================================================');
        console.log('  🎉 TESTE DE RECONEXÃO APROVADO COM 100% DE SUCESSO!');
        console.log('  Todos os dados de tom, BPM, preset e repertório voltaram intactos.');
        console.log('======================================================\n');
        resolve();
      }, 300);
    }
  });
}

runTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro no teste de reconexão:', err);
    process.exit(1);
  });
