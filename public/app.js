/**
 * PadStudio Live - Game-like Gateway to Single Stage Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Audio Engine & Setlist
  let audioEngine = null;
  const setlist = new window.PadStudioSetlistManager();

  // Session State
  let ws = null;
  let myRole = 'solo'; // 'host' | 'keyboardist' | 'drummer' | 'leader' | 'solo'
  let currentRoomCode = null;
  let hostToken = sessionStorage.getItem('padstudio_host_token') || null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isManualDisconnect = false;
  let currentActiveTone = null;

  // Visual Toasts & Banners
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px) scale(0.96)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  function showStatusBanner(message, type = 'warning') {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    banner.className = `status-banner ${type}`;
    banner.textContent = message;
    banner.classList.remove('hidden');
  }

  function hideStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (banner) banner.classList.add('hidden');
  }

  // Notation Map
  let notationMode = 'cifra';
  let accidentalMode = 'sharp';
  const notesMap = {
    cifra_sharp:   ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
    cifra_flat:    ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
    solfejo_sharp: ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'],
    solfejo_flat:  ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol♭', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si']
  };

  function getCurrentLabels() {
    return notesMap[`${notationMode}_${accidentalMode}`] || notesMap.cifra_sharp;
  }

  // Screens
  const screenGateway = document.getElementById('screen-room-gateway');
  const screenStage = document.getElementById('screen-main-stage');

  function goToStage() {
    screenGateway.classList.remove('active');
    screenStage.classList.add('active');
    applyRoleUI(myRole);
    requestWakeLock();
    renderGrid();
    renderDrumsGrid();
  }

  function goToGateway() {
    screenStage.classList.remove('active');
    screenGateway.classList.add('active');
    if (audioEngine) audioEngine.panicStop();
  }

  // ==========================================
  // WEBSOCKET HANDLERS & RECONNECTION BACKOFF
  // ==========================================

  function scheduleReconnect() {
    if (isManualDisconnect || myRole === 'solo' || !currentRoomCode) return;
    if (reconnectTimer) return;

    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 10000);
    showStatusBanner(`Conexão perdida. Reconectando em ${(delay / 1000).toFixed(1)}s…`, 'warning');

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      showStatusBanner('Tentando reconectar…', 'warning');
      connectWs(() => {
        reconnectAttempts = 0;
        hideStatusBanner();
        showToast('Reconectado com sucesso!', 'success');
        if (myRole === 'host') {
          const token = hostToken || sessionStorage.getItem('padstudio_host_token');
          sendWs({
            type: 'reconnect_host',
            roomCode: currentRoomCode,
            hostToken: token
          });
        } else if (['keyboardist', 'drummer', 'leader'].includes(myRole)) {
          sendWs({
            type: 'join_room',
            roomCode: currentRoomCode,
            role: myRole
          });
        }
      });
    }, delay);
  }

  function connectWs(onOpen) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (onOpen && ws.readyState === WebSocket.OPEN) onOpen();
      return;
    }

    // Determine target WebSocket URL: configurable window.PADSTUDIO_WS_URL or same origin
    let targetWsUrl = window.PADSTUDIO_WS_URL;
    if (!targetWsUrl) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      targetWsUrl = `${proto}//${window.location.host}`;
    }

    try {
      ws = new WebSocket(targetWsUrl);
    } catch (err) {
      console.warn('[WS] Falha ao instanciar WebSocket:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      if (onOpen) onOpen();
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      console.warn('[WS] Conexão encerrada');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[WS] Erro de rede no socket:', err);
      scheduleReconnect();
    };
  }

  function sendWs(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Ping every 2 seconds to measure live round-trip latency
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && myRole !== 'solo') {
      sendWs({ type: 'ping', clientTime: performance.now() });
    }
  }, 2000);

  function broadcastHostState() {
    if (myRole !== 'host' || !audioEngine) return;
    const faderPad = document.getElementById('fader-pad');
    const faderDrums = document.getElementById('fader-drums');
    const faderMetro = document.getElementById('fader-metro');
    const faderMaster = document.getElementById('fader-master');
    const metroPanSlider = document.getElementById('metro-pan');
    const state = {
      activeToneIndex: audioEngine.activeToneIndex,
      padPreset: audioEngine.padPreset,
      padVolume: faderPad ? parseInt(faderPad.value) : 90,
      drumVolume: faderDrums ? parseInt(faderDrums.value) : 85,
      metroVolume: faderMetro ? parseInt(faderMetro.value) : 80,
      masterVolume: faderMaster ? parseInt(faderMaster.value) : 90,
      metroPan: metroPanSlider ? parseFloat(metroPanSlider.value) : 0,
      bpm: audioEngine.bpm,
      timeSig: audioEngine.timeSig || '4/4',
      metroPlaying: audioEngine.metroPlaying,
      drumKit: audioEngine.activeDrumKit,
      activeSongId: setlist.activeSongId,
      setlist: setlist.songs
    };
    sendWs({ type: 'host_state_update', state });
  }

  // ==========================================
  // TELA 1: GATEWAY (CRIAR OU ENTRAR NA SALA)
  // ==========================================

  // Role Selection PIN toggle
  const selectGatewayRole = document.getElementById('select-gateway-role');
  const inputJoinPin = document.getElementById('input-join-pin');
  if (selectGatewayRole && inputJoinPin) {
    selectGatewayRole.addEventListener('change', () => {
      if (selectGatewayRole.value === 'leader') {
        inputJoinPin.classList.remove('hidden');
        inputJoinPin.placeholder = 'PIN do Líder (se configurado)';
      } else {
        inputJoinPin.placeholder = 'PIN de Acesso (se exigido)';
      }
    });
  }

  // 1. CRIAR SALA (HOST)
  document.getElementById('btn-gateway-create').addEventListener('click', async () => {
    isManualDisconnect = false;
    myRole = 'host';
    audioEngine = new window.PadStudioAudioEngine();
    await audioEngine.unlock();

    const hostRoomPin = document.getElementById('input-host-room-pin')?.value.trim();
    const hostLeaderPin = document.getElementById('input-host-leader-pin')?.value.trim();

    connectWs(() => {
      sendWs({
        type: 'create_room',
        roomPin: hostRoomPin || undefined,
        leaderPin: hostLeaderPin || undefined
      });
    });
  });

  // 2. ENTRAR EM SALA (CONTROLE)
  const inputGatewayCode = document.getElementById('input-gateway-code');
  const gatewayError = document.getElementById('gateway-error');

  document.getElementById('btn-gateway-join').addEventListener('click', () => {
    const code = inputGatewayCode.value.trim().toUpperCase();
    if (code.length < 4) {
      gatewayError.textContent = 'Digite o código de 4 letras.';
      gatewayError.classList.remove('hidden');
      return;
    }

    isManualDisconnect = false;
    myRole = selectGatewayRole.value;
    const pin = inputJoinPin?.value.trim();
    gatewayError.classList.add('hidden');

    connectWs(() => {
      sendWs({
        type: 'join_room',
        roomCode: code,
        role: myRole,
        pin: pin || undefined
      });
    });
  });

  // 3. TOCAR SOLO OFFLINE
  document.getElementById('btn-gateway-solo').addEventListener('click', async () => {
    isManualDisconnect = true;
    myRole = 'solo';
    audioEngine = new window.PadStudioAudioEngine();
    await audioEngine.unlock();
    document.getElementById('header-room-display').textContent = 'SOLO';
    goToStage();
  });

  // ==========================================
  // WEBSOCKET INCOMING DISPATCHER
  // ==========================================

  async function handleWsMessage(msg) {
    switch (msg.type) {
      case 'room_created': {
        currentRoomCode = msg.roomCode;
        hostToken = msg.hostToken;
        sessionStorage.setItem('padstudio_room_code', msg.roomCode);
        sessionStorage.setItem('padstudio_role', 'host');
        if (msg.hostToken) sessionStorage.setItem('padstudio_host_token', msg.hostToken);
        document.getElementById('header-room-display').textContent = `SALA: ${msg.roomCode}`;
        document.getElementById('modal-lbl-code').textContent = msg.roomCode;
        hideStatusBanner();
        loadQrCode(msg.roomCode);
        goToStage();
        break;
      }

      case 'room_reconnected': {
        currentRoomCode = msg.roomCode;
        if (msg.hostToken) {
          hostToken = msg.hostToken;
          sessionStorage.setItem('padstudio_host_token', msg.hostToken);
        }
        document.getElementById('header-room-display').textContent = `SALA: ${msg.roomCode}`;
        document.getElementById('modal-lbl-code').textContent = msg.roomCode;
        hideStatusBanner();
        showToast('HOST restabeleceu a sala!', 'success');
        loadQrCode(msg.roomCode);
        goToStage();
        if (msg.state) applyState(msg.state);
        break;
      }

      case 'room_joined': {
        currentRoomCode = msg.roomCode;
        sessionStorage.setItem('padstudio_room_code', msg.roomCode);
        sessionStorage.setItem('padstudio_role', msg.role);
        sessionStorage.removeItem('padstudio_host_token');
        document.getElementById('header-room-display').textContent = `SALA: ${msg.roomCode}`;
        document.getElementById('modal-lbl-code').textContent = msg.roomCode;
        hideStatusBanner();
        goToStage();
        applyState(msg.state);
        break;
      }

      case 'permission_denied': {
        showToast(`Sem permissão: ${msg.message || msg.action}`, 'error');
        break;
      }

      case 'host_offline': {
        showStatusBanner(msg.message || 'HOST offline: O aparelho de som está desconectado.', 'error');
        break;
      }

      case 'host_disconnected': {
        showStatusBanner(msg.message || 'HOST desconectado. Aguardando reconexão…', 'warning');
        break;
      }

      case 'host_reconnected': {
        hideStatusBanner();
        showToast(msg.message || 'HOST reconectado à sala!', 'success');
        break;
      }

      case 'error': {
        showToast(msg.message || 'Erro na sala', 'error');
        if (gatewayError) {
          gatewayError.textContent = msg.message;
          gatewayError.classList.remove('hidden');
        }
        break;
      }

      case 'state': {
        applyState(msg.state);
        break;
      }

      case 'pong': {
        if (typeof msg.clientTime === 'number') {
          const lat = Math.max(1, Math.round(performance.now() - msg.clientTime));
          updateLatencyDisplay(lat);
        }
        break;
      }

      case 'panic': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.panicStop();
          updateToneUI(null);
          updateMetroUI(false);
          broadcastHostState();
          showToast('PÂNICO recebido do Líder!', 'error');
        }
        break;
      }

      case 'volume': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.setVolume(msg.target, msg.value);
          updateVolumeUI(msg.target, msg.value);
          broadcastHostState();
        }
        break;
      }

      case 'members_update': {
        const countEl = document.getElementById('room-members-status');
        if (countEl) countEl.textContent = `${msg.members.length} aparelho(s) na sala`;
        renderMembersList(msg.members);
        break;
      }

      // Commands executed on HOST
      case 'pad_on': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.playTone(msg.toneIndex);
          updateToneUI(msg.toneIndex);
          broadcastHostState();
        }
        break;
      }
      case 'pad_off': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.stopPad(0.4);
          updateToneUI(null);
          broadcastHostState();
        }
        break;
      }
      case 'pad_preset': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.setPadPreset(msg.preset);
          document.getElementById('pad-preset-select').value = msg.preset;
          broadcastHostState();
        }
        break;
      }
      case 'drum_hit': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.playDrumPad(msg.padIndex, msg.velocity || 1.0);
        }
        flashDrumPad(msg.padIndex);
        break;
      }
      case 'drum_kit': {
        currentDrumKitId = msg.kitId;
        if (drumKitSelect) drumKitSelect.value = msg.kitId;
        if (myRole === 'host' && audioEngine) {
          audioEngine.setDrumKit(msg.kitId);
        }
        renderDrumsGrid();
        break;
      }
      case 'drum': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.playDrumPad(0, msg.velocity || 1.0);
        }
        break;
      }
      case 'metro': {
        if (myRole === 'host' && audioEngine) {
          if (msg.action === 'start') audioEngine.startMetronome();
          else audioEngine.stopMetronome();
          updateMetroUI();
          broadcastHostState();
        }
        break;
      }
      case 'bpm': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.setMetronomeBpm(msg.value);
          document.getElementById('tempo-number').textContent = msg.value;
          document.getElementById('metro-full-bpm').textContent = msg.value;
          broadcastHostState();
        }
        break;
      }
      case 'timesig': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.setMetronomeTimeSig(msg.value);
          document.getElementById('metro-time-sig').value = msg.value;
          updateBeatDots(parseInt(msg.value.split('/')[0]) || 4);
          broadcastHostState();
        }
        break;
      }
      case 'song_activate': {
        if (myRole === 'host' && audioEngine) {
          const song = setlist.getSong(msg.songId);
          if (song) {
            audioEngine.setPadPreset(song.preset);
            document.getElementById('pad-preset-select').value = song.preset;
            audioEngine.setMetronomeBpm(song.bpm);
            document.getElementById('tempo-number').textContent = song.bpm;
            document.getElementById('metro-full-bpm').textContent = song.bpm;
            audioEngine.setMetronomeTimeSig(song.timeSig);
            document.getElementById('metro-time-sig').value = song.timeSig;
            updateBeatDots(parseInt(song.timeSig.split('/')[0]) || 4);
            audioEngine.playTone(song.keyIndex);
            updateToneUI(song.keyIndex);
            setlist.activeSongId = song.id;
            renderSetlist();
            broadcastHostState();
          }
        }
        break;
      }
      case 'metro_pan': {
        if (myRole === 'host' && audioEngine) {
          audioEngine.setMetronomePan(msg.value);
          const panSlider = document.getElementById('metro-pan');
          if (panSlider) panSlider.value = msg.value;
          const label = document.getElementById('pan-current-label');
          if (label) {
            if (msg.value < -0.2) label.textContent = 'Só Fone (L)';
            else if (msg.value > 0.2) label.textContent = 'Direito (R)';
            else label.textContent = 'Centro';
          }
          broadcastHostState();
        }
        break;
      }
      case 'setlist_add': {
        if (myRole === 'host') {
          const s = msg.song;
          setlist.addSong(s.title, s.keyIndex, s.bpm, s.timeSig, s.preset);
          renderSetlist();
          broadcastHostState();
        }
        break;
      }
      case 'setlist_edit': {
        if (myRole === 'host') {
          setlist.updateSong(msg.songId, msg.updates);
          renderSetlist();
          broadcastHostState();
        }
        break;
      }
      case 'setlist_delete': {
        if (myRole === 'host') {
          setlist.deleteSong(msg.songId);
          renderSetlist();
          broadcastHostState();
        }
        break;
      }
    }
  }

  function applyState(state) {
    if (!state) return;
    if (state.activeToneIndex !== undefined) {
      updateToneUI(state.activeToneIndex);
    }
    if (state.padPreset) {
      document.getElementById('pad-preset-select').value = state.padPreset;
      if (audioEngine) audioEngine.padPreset = state.padPreset;
    }
    if (state.drumKit) {
      currentDrumKitId = state.drumKit;
      const kitSelect = document.getElementById('drum-kit-select');
      if (kitSelect) kitSelect.value = state.drumKit;
      if (audioEngine) audioEngine.setDrumKit(state.drumKit);
      renderDrumsGrid();
    }
    if (state.bpm) {
      document.getElementById('tempo-number').textContent = state.bpm;
      document.getElementById('metro-full-bpm').textContent = state.bpm;
      if (audioEngine) audioEngine.setMetronomeBpm(state.bpm);
    }
    if (state.timeSig) {
      const tsSelect = document.getElementById('metro-time-sig');
      if (tsSelect) tsSelect.value = state.timeSig;
      const count = parseInt(state.timeSig.split('/')[0]) || 4;
      updateBeatDots(count);
      if (audioEngine) audioEngine.setMetronomeTimeSig(state.timeSig);
    }
    if (state.metroPlaying !== undefined) {
      updateMetroUI(state.metroPlaying);
    }
    if (state.metroPan !== undefined) {
      const panSlider = document.getElementById('metro-pan');
      if (panSlider) panSlider.value = state.metroPan;
      const label = document.getElementById('pan-current-label');
      if (label) {
        if (state.metroPan < -0.2) label.textContent = 'Só Fone (L)';
        else if (state.metroPan > 0.2) label.textContent = 'Direito (R)';
        else label.textContent = 'Centro';
      }
      if (audioEngine) audioEngine.setMetronomePan(state.metroPan);
    }
    if (state.padVolume !== undefined) updateVolumeUI('pad', state.padVolume);
    if (state.drumVolume !== undefined) updateVolumeUI('drums', state.drumVolume);
    if (state.metroVolume !== undefined) updateVolumeUI('metro', state.metroVolume);
    if (state.masterVolume !== undefined) updateVolumeUI('master', state.masterVolume);
    if (state.setlist) {
      setlist.songs = state.setlist;
      renderSetlist();
    }
    if (state.activeSongId !== undefined) {
      setlist.activeSongId = state.activeSongId;
      renderSetlist();
    }
  }

  async function loadQrCode(code) {
    try {
      let baseUrl = window.location.origin;
      try {
        const infoResp = await fetch('/api/server-info');
        if (infoResp.ok) {
          const info = await infoResp.json();
          if (info.ips && info.ips.length > 0) {
            const lanIp = info.ips[0].address;
            const proto = info.protocol ? `${info.protocol}:` : window.location.protocol;
            const portStr = (info.port === 80 || info.port === 443) ? '' : `:${info.port}`;
            baseUrl = `${proto}//${lanIp}${portStr}`;
          }
        }
      } catch (err) {
        console.warn('Could not fetch /api/server-info, using window.location.origin', err);
      }

      const fullRoomUrl = `${baseUrl}/?room=${code}`;
      const qrResp = await fetch(`/api/qr?text=${encodeURIComponent(fullRoomUrl)}`);
      const qrData = await qrResp.json();
      if (qrData.qr) {
        const qrImg = document.getElementById('room-qr-img');
        if (qrImg) qrImg.src = qrData.qr;
      }
      const urlEl = document.getElementById('modal-lbl-url');
      if (urlEl) {
        urlEl.textContent = fullRoomUrl;
        urlEl.href = fullRoomUrl;
      }
    } catch (e) {
      console.error('Failed to load QR code:', e);
    }
  }

  // ==========================================
  // TELA 2: PALCO ÚNICO (PADS / DRUMS / METRO)
  // ==========================================

  // Segmented Nav Switcher
  const navSegments = document.querySelectorAll('.nav-segment');
  const tabPanes = document.querySelectorAll('.tab-pane');

  function switchTab(tabId) {
    navSegments.forEach(s => {
      if (s.dataset.tab === tabId) s.classList.add('active');
      else s.classList.remove('active');
    });
    tabPanes.forEach(p => {
      if (p.id === tabId) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  // Wake Lock API
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      if (!window.isSecureContext) {
        showStatusBanner('Aviso: Tela pode apagar (Wake Lock requer HTTPS local). Desative o bloqueio automático nas configurações do celular.', 'warning');
      }
      return;
    }

    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      console.log('[WakeLock] Tela ativa mantida.');
    } catch (err) {
      console.warn('[WakeLock] Falha:', err);
      if (!window.isSecureContext) {
        showStatusBanner('Aviso: Tela pode apagar (Wake Lock requer HTTPS). Desative o bloqueio automático no celular.', 'warning');
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLockSentinel && myRole !== 'solo') {
      requestWakeLock();
    }
  });

  function applyRoleUI(role) {
    const navPads = document.getElementById('nav-seg-pads');
    const navDrums = document.getElementById('nav-seg-drums');
    const navMetro = document.getElementById('nav-seg-metro');
    const navSetlist = document.getElementById('nav-seg-setlist');
    const navMixer = document.getElementById('nav-seg-mixer');
    const btnPanic = document.getElementById('btn-panic');
    const latencyInd = document.getElementById('latency-indicator');
    const quickMetroPill = document.querySelector('.quick-metro-pill');
    const hostNotice = document.getElementById('host-foreground-banner');

    if (role === 'host') {
      if (hostNotice) hostNotice.classList.remove('hidden');
    } else {
      if (hostNotice) hostNotice.classList.add('hidden');
    }

    if (role !== 'solo') {
      if (latencyInd) latencyInd.classList.remove('hidden');
    } else {
      if (latencyInd) latencyInd.classList.add('hidden');
    }

    // LIBERAR TUDO: todas as abas e controles sempre visíveis para todos os papéis
    if (navPads) navPads.classList.remove('hidden');
    if (navDrums) navDrums.classList.remove('hidden');
    if (navMetro) navMetro.classList.remove('hidden');
    if (navSetlist) navSetlist.classList.remove('hidden');
    if (navMixer) navMixer.classList.remove('hidden');
    if (btnPanic) btnPanic.classList.remove('hidden');
    if (quickMetroPill) quickMetroPill.classList.remove('hidden');

    // Aba inicial sugerida de acordo com o papel escolhido
    if (role === 'drummer') {
      switchTab('tab-drums');
    } else {
      switchTab('tab-pads');
    }
  }

  function updateLatencyDisplay(lat) {
    const ind = document.getElementById('latency-indicator');
    const val = document.getElementById('latency-val');
    if (!ind || !val) return;
    ind.classList.remove('lat-green', 'lat-yellow', 'lat-red');
    val.textContent = `${lat} ms`;
    if (lat < 30) ind.classList.add('lat-green');
    else if (lat < 80) ind.classList.add('lat-yellow');
    else ind.classList.add('lat-red');
  }

  function renderMembersList(members) {
    const listEl = document.getElementById('room-members-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    (members || []).forEach(m => {
      const item = document.createElement('div');
      item.className = 'member-item';

      const roleBadge = document.createElement('span');
      roleBadge.className = 'member-role-badge';
      roleBadge.textContent = formatRole(m.role);

      const nameText = document.createElement('span');
      nameText.className = 'member-name-text';
      nameText.textContent = m.name || m.id;

      const latTag = document.createElement('span');
      const lat = m.latency || 0;
      latTag.className = `member-latency-tag ${lat < 30 ? 'lat-green' : lat < 80 ? 'lat-yellow' : 'lat-red'}`;
      latTag.textContent = `${lat} ms`;

      item.appendChild(roleBadge);
      item.appendChild(nameText);
      item.appendChild(latTag);
      listEl.appendChild(item);
    });
  }

  function formatRole(role) {
    switch (role) {
      case 'keyboardist': return 'Tecladista';
      case 'drummer': return 'Baterista';
      case 'leader': return 'Líder';
      case 'host': return 'Host';
      default: return 'Membro';
    }
  }

  navSegments.forEach(seg => {
    seg.addEventListener('click', () => {
      switchTab(seg.dataset.tab);
      if (seg.dataset.tab === 'tab-setlist') {
        renderSetlist();
      }
    });
  });

  // Panic Button (Host and Leader)
  const btnPanic = document.getElementById('btn-panic');
  if (btnPanic) {
    btnPanic.addEventListener('click', () => {
      if (myRole === 'host' || myRole === 'solo') {
        if (audioEngine) audioEngine.panicStop();
        updateToneUI(null);
        updateMetroUI(false);
        broadcastHostState();
        showToast('PÂNICO: Todos os sons interrompidos!', 'error');
      } else {
        sendWs({ type: 'panic' });
        showToast('PÂNICO enviado ao Host!', 'error');
      }
    });
  }

  // 12 Pads Grid
  const tonesGrid = document.getElementById('tones-grid');
  const activeToneNameEl = document.getElementById('active-tone-name');
  const padPulseEl = document.getElementById('pad-pulse');

  function renderGrid() {
    const labels = getCurrentLabels();
    tonesGrid.innerHTML = '';

    labels.forEach((label, index) => {
      const btn = document.createElement('button');
      btn.className = 'tone-button';
      btn.dataset.index = index;

      if ((audioEngine && audioEngine.activeToneIndex === index) || currentActiveTone === index) {
        btn.classList.add('playing');
      }

      btn.innerHTML = `<span class="tone-note">${label}</span>`;

      // SUB-MILLISECOND POINTERDOWN
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();

        if (myRole !== 'host' && myRole !== 'solo') {
          // Remote: toggle if active tone is tapped again
          if (currentActiveTone === index) {
            sendWs({ type: 'pad_off' });
          } else {
            sendWs({ type: 'pad_on', toneIndex: index });
          }
          return;
        }

        // Local Host/Solo
        if (audioEngine.activeToneIndex === index) {
          audioEngine.stopPad(0.4);
          updateToneUI(null);
        } else {
          audioEngine.playTone(index);
          updateToneUI(index);
        }

        if (myRole === 'host') broadcastHostState();
      });

      tonesGrid.appendChild(btn);
    });
  }

  function updateToneUI(activeIndex) {
    currentActiveTone = (activeIndex !== null && activeIndex !== undefined) ? activeIndex : null;
    const labels = getCurrentLabels();
    const buttons = tonesGrid.querySelectorAll('.tone-button');

    buttons.forEach((btn, idx) => {
      if (idx === currentActiveTone) btn.classList.add('playing');
      else btn.classList.remove('playing');
    });

    if (currentActiveTone !== null) {
      activeToneNameEl.textContent = `${labels[currentActiveTone]}`;
      padPulseEl.classList.add('active');
    } else {
      activeToneNameEl.textContent = 'NENHUM';
      padPulseEl.classList.remove('active');
    }
  }

  document.getElementById('btn-pad-stop').addEventListener('click', () => {
    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'pad_off' });
    } else {
      audioEngine.stopPad(0.4);
      updateToneUI(null);
      if (myRole === 'host') broadcastHostState();
    }
  });

  document.getElementById('pad-preset-select').addEventListener('change', (e) => {
    const preset = e.target.value;
    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'pad_preset', preset });
    } else {
      audioEngine.setPadPreset(preset);
      if (myRole === 'host') broadcastHostState();
    }
  });

  // Notation
  document.getElementById('btn-notation-cifra').addEventListener('click', (e) => {
    notationMode = 'cifra';
    e.target.classList.add('active');
    document.getElementById('btn-notation-solfejo').classList.remove('active');
    renderGrid();
  });
  document.getElementById('btn-notation-solfejo').addEventListener('click', (e) => {
    notationMode = 'solfejo';
    e.target.classList.add('active');
    document.getElementById('btn-notation-cifra').classList.remove('active');
    renderGrid();
  });
  document.getElementById('btn-accidental-sharp').addEventListener('click', (e) => {
    accidentalMode = 'sharp';
    e.target.classList.add('active');
    document.getElementById('btn-accidental-flat').classList.remove('active');
    renderGrid();
  });
  document.getElementById('btn-accidental-flat').addEventListener('click', (e) => {
    accidentalMode = 'flat';
    e.target.classList.add('active');
    document.getElementById('btn-accidental-sharp').classList.remove('active');
    renderGrid();
  });

  // ==========================================
  // DRUMS & DYNAMIC KITS
  // ==========================================
  let currentDrumKitId = 'kit_3';

  const drumKitsInfo = {
    "kit_3": {
      name: "Rock Worship",
      pads: [
        { id: 0, name: "Bumbo (Kick)", key: "Q", color: "#ff453a" },
        { id: 1, name: "Caixa (Snare)", key: "W", color: "#ff9f0a" },
        { id: 2, name: "Chimbal Fechado", key: "E", color: "#30d158" },
        { id: 3, name: "Chimbal Aberto", key: "R", color: "#64d2ff" },
        { id: 4, name: "Tom 1 (Alto)", key: "A", color: "#5e5ce6" },
        { id: 5, name: "Tom 2 (Médio)", key: "S", color: "#bf5af2" },
        { id: 6, name: "Tom 3 (Surdo)", key: "D", color: "#af52de" },
        { id: 7, name: "Prato (Crash)", key: "F", color: "#ffd60a" }
      ]
    },
    "acoustic": {
      name: "Acústico Natural",
      pads: [
        { id: 0, name: "Bumbo Acústico", key: "Q", color: "#ff453a" },
        { id: 1, name: "Caixa Acústica", key: "W", color: "#ff9f0a" },
        { id: 2, name: "Chimbal Acústico", key: "E", color: "#30d158" },
        { id: 3, name: "Percussão FX", key: "R", color: "#64d2ff" },
        { id: 4, name: "Tumb FX", key: "A", color: "#bf5af2" },
        { id: 5, name: "Wood Block", key: "S", color: "#5e5ce6" },
        { id: 6, name: "White Noise", key: "D", color: "#98989d" },
        { id: 7, name: "Swell Crescendo", key: "F", color: "#0a84ff" }
      ]
    },
    "kit_1": {
      name: "Worship Claps & Sub-Kick",
      pads: [
        { id: 0, name: "Sub Kick Grave", key: "Q", color: "#ff375f" },
        { id: 1, name: "Kick Punch", key: "W", color: "#ff9f0a" },
        { id: 2, name: "Palmas (Clap)", key: "E", color: "#30d158" },
        { id: 3, name: "Tom 1", key: "R", color: "#64d2ff" },
        { id: 4, name: "Tom 2", key: "A", color: "#bf5af2" },
        { id: 5, name: "Tom 3", key: "S", color: "#5e5ce6" },
        { id: 6, name: "Tumb Perc", key: "D", color: "#ff9500" },
        { id: 7, name: "Wood Click", key: "F", color: "#0a84ff" }
      ]
    },
    "kit_2": {
      name: "Cinematic FX & Booms",
      pads: [
        { id: 0, name: "Boom Sub-Grave", key: "Q", color: "#ff453a" },
        { id: 1, name: "FX Tom", key: "W", color: "#ff9f0a" },
        { id: 2, name: "White Noise", key: "E", color: "#98989d" },
        { id: 3, name: "Tom 1", key: "R", color: "#64d2ff" },
        { id: 4, name: "Tom 2", key: "A", color: "#bf5af2" },
        { id: 5, name: "Tom 3", key: "S", color: "#5e5ce6" },
        { id: 6, name: "Tumb 2", key: "D", color: "#ffd60a" },
        { id: 7, name: "Swell Expansivo", key: "F", color: "#0a84ff" }
      ]
    },
    "kit_4": {
      name: "Hybrid Ambient FX",
      pads: [
        { id: 0, name: "Sub Kick FX", key: "Q", color: "#ff375f" },
        { id: 1, name: "Boom FX", key: "W", color: "#ff9f0a" },
        { id: 2, name: "Blop Perc", key: "E", color: "#30d158" },
        { id: 3, name: "Percussão FX", key: "R", color: "#64d2ff" },
        { id: 4, name: "Tumb FX", key: "A", color: "#bf5af2" },
        { id: 5, name: "Wood Block", key: "S", color: "#5e5ce6" },
        { id: 6, name: "Noise Glitch", key: "D", color: "#98989d" },
        { id: 7, name: "Swell FX", key: "F", color: "#0a84ff" }
      ]
    }
  };

  const drumsGridEl = document.getElementById('drums-grid');
  const drumKitSelect = document.getElementById('drum-kit-select');

  function renderDrumsGrid() {
    const kit = drumKitsInfo[currentDrumKitId] || drumKitsInfo['kit_3'];
    drumsGridEl.innerHTML = '';

    kit.pads.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.className = 'drum-pad';
      btn.dataset.padIndex = idx;
      btn.style.setProperty('--accent', p.color);

      btn.innerHTML = `
        <span class="drum-key">${p.key}</span>
        <span class="drum-title">${p.name}</span>
      `;

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        triggerDrum(idx);
      });

      drumsGridEl.appendChild(btn);
    });
  }

  function triggerDrum(padIndex) {
    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'drum_hit', padIndex, velocity: 1.0 });
    } else if (audioEngine) {
      audioEngine.playDrumPad(padIndex, 1.0);
    }
    flashDrumPad(padIndex);
  }

  function flashDrumPad(padIndex) {
    const pad = drumsGridEl.querySelector(`[data-pad-index="${padIndex}"]`);
    if (pad) {
      pad.classList.add('hit');
      setTimeout(() => pad.classList.remove('hit'), 120);
    }
  }

  if (drumKitSelect) {
    drumKitSelect.addEventListener('change', (e) => {
      currentDrumKitId = e.target.value;
      if (myRole !== 'host' && myRole !== 'solo') {
        sendWs({ type: 'drum_kit', kitId: currentDrumKitId });
      } else if (audioEngine) {
        audioEngine.setDrumKit(currentDrumKitId);
      }
      renderDrumsGrid();
    });
  }

  // QWERTY Drums Shortcuts
  const keyIndexMap = { 'Q': 0, 'W': 1, 'E': 2, 'R': 3, 'A': 4, 'S': 5, 'D': 6, 'F': 7 };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // Desativar atalhos QWER/ASDF fora do papel baterista/solo/host
    if (!['drummer', 'solo', 'host'].includes(myRole)) return;

    const idx = keyIndexMap[e.key.toUpperCase()];
    if (idx !== undefined) {
      triggerDrum(idx);
    }
  });

  // Metronome
  const btnMetroPlay = document.getElementById('btn-metro-play');
  const btnMetroFullPlay = document.getElementById('btn-metro-full-play');
  const tempoNumberEl = document.getElementById('tempo-number');
  const tempoFullNumberEl = document.getElementById('metro-full-bpm');
  const beatDotsContainer = document.getElementById('beat-dots');

  function updateBeatDots(count) {
    beatDotsContainer.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot';
      dot.dataset.beat = i;
      dot.textContent = i;
      beatDotsContainer.appendChild(dot);
    }
  }

  function updateMetroUI(isPlaying) {
    const active = isPlaying !== undefined ? isPlaying : (audioEngine ? audioEngine.metroPlaying : false);
    if (active) {
      btnMetroPlay.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      btnMetroPlay.classList.add('playing');
      btnMetroFullPlay.textContent = 'PAUSAR CLICK';
      btnMetroFullPlay.classList.add('playing');
    } else {
      btnMetroPlay.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      btnMetroPlay.classList.remove('playing');
      btnMetroFullPlay.textContent = 'INICIAR CLICK';
      btnMetroFullPlay.classList.remove('playing');
      document.querySelectorAll('#beat-dots .beat-dot').forEach(d => d.classList.remove('flash', 'flash-accent'));
    }
  }

  function toggleMetro() {
    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'metro', action: btnMetroPlay.classList.contains('playing') ? 'stop' : 'start' });
      return;
    }
    if (audioEngine.metroPlaying) audioEngine.stopMetronome();
    else audioEngine.startMetronome();
    updateMetroUI();
    if (myRole === 'host') broadcastHostState();
  }

  btnMetroPlay.addEventListener('click', toggleMetro);
  btnMetroFullPlay.addEventListener('click', toggleMetro);

  const setBpm = (bpm) => {
    const newBpm = Math.max(40, Math.min(260, bpm));
    tempoNumberEl.textContent = newBpm;
    tempoFullNumberEl.textContent = newBpm;

    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'bpm', value: newBpm });
    } else {
      audioEngine.setMetronomeBpm(newBpm);
      if (myRole === 'host') broadcastHostState();
    }
  };

  document.getElementById('bpm-minus-1').addEventListener('click', () => {
    const cur = parseInt(tempoNumberEl.textContent) || 120;
    setBpm(cur - 1);
  });
  document.getElementById('bpm-plus-1').addEventListener('click', () => {
    const cur = parseInt(tempoNumberEl.textContent) || 120;
    setBpm(cur + 1);
  });

  // Tap tempo
  const tapTimes = [];
  function handleTap() {
    const now = performance.now();
    tapTimes.push(now);

    if (tapTimes.length > 1 && (now - tapTimes[tapTimes.length - 2] > 2500)) {
      tapTimes.length = 0;
      tapTimes.push(now);
    }
    if (tapTimes.length >= 2) {
      const deltas = [];
      for (let i = 1; i < tapTimes.length; i++) deltas.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      setBpm(Math.round(60000 / avg));
    }
    if (tapTimes.length > 5) tapTimes.shift();
  }

  document.getElementById('btn-metro-tap').addEventListener('click', handleTap);
  document.getElementById('btn-metro-full-tap').addEventListener('click', handleTap);

  document.getElementById('metro-time-sig').addEventListener('change', (e) => {
    const count = parseInt(e.target.value.split('/')[0]) || 4;
    updateBeatDots(count);

    if (myRole !== 'host' && myRole !== 'solo') {
      sendWs({ type: 'timesig', value: e.target.value });
    } else {
      audioEngine.beatsPerBar = count;
      if (myRole === 'host') broadcastHostState();
    }
  });

  document.getElementById('metro-pan').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const label = document.getElementById('pan-current-label');
    if (label) {
      if (val < -0.2) label.textContent = 'Só Fone (L)';
      else if (val > 0.2) label.textContent = 'Direito (R)';
      else label.textContent = 'Centro';
    }
    if (myRole === 'host' || myRole === 'solo') {
      if (audioEngine) audioEngine.setMetronomePan(val);
      if (myRole === 'host') broadcastHostState();
    } else {
      sendWs({ type: 'metro_pan', value: val });
    }
  });

  // Mixer Faders (Host & Líder)
  const faderPad = document.getElementById('fader-pad');
  const faderDrums = document.getElementById('fader-drums');
  const faderMetro = document.getElementById('fader-metro');
  const faderMaster = document.getElementById('fader-master');

  const valPad = document.getElementById('val-pad');
  const valDrums = document.getElementById('val-drums');
  const valMetro = document.getElementById('val-metro');
  const valMaster = document.getElementById('val-master');

  function updateVolumeUI(target, val) {
    const num = Math.round(val);
    if (target === 'pad' && faderPad) {
      faderPad.value = num;
      if (valPad) valPad.textContent = `${num}%`;
    } else if (target === 'drums' && faderDrums) {
      faderDrums.value = num;
      if (valDrums) valDrums.textContent = `${num}%`;
    } else if (target === 'metro' && faderMetro) {
      faderMetro.value = num;
      if (valMetro) valMetro.textContent = `${num}%`;
    } else if (target === 'master' && faderMaster) {
      faderMaster.value = num;
      if (valMaster) valMaster.textContent = `${num}%`;
    }
  }

  function handleVolumeInput(target, val) {
    const num = parseInt(val);
    updateVolumeUI(target, num);
    if (myRole === 'host' || myRole === 'solo') {
      if (audioEngine) audioEngine.setVolume(target, num);
      if (myRole === 'host') broadcastHostState();
    } else {
      sendWs({ type: 'volume', target, value: num });
    }
  }

  if (faderPad) faderPad.addEventListener('input', (e) => handleVolumeInput('pad', e.target.value));
  if (faderDrums) faderDrums.addEventListener('input', (e) => handleVolumeInput('drums', e.target.value));
  if (faderMetro) faderMetro.addEventListener('input', (e) => handleVolumeInput('metro', e.target.value));
  if (faderMaster) faderMaster.addEventListener('input', (e) => handleVolumeInput('master', e.target.value));

  // Setlist
  const songsListEl = document.getElementById('songs-list');
  function renderSetlist() {
    const labels = getCurrentLabels();
    songsListEl.innerHTML = '';

    setlist.songs.forEach(song => {
      const item = document.createElement('div');
      item.className = 'setlist-item';
      if (setlist.activeSongId === song.id) {
        item.classList.add('active-song');
      }

      const infoDiv = document.createElement('div');
      infoDiv.className = 'song-meta';
      const strong = document.createElement('strong');
      strong.textContent = song.title;
      const span = document.createElement('span');
      span.textContent = `${labels[song.keyIndex]} • ${song.bpm} BPM • ${song.timeSig}`;
      infoDiv.appendChild(strong);
      infoDiv.appendChild(span);

      const btnPlay = document.createElement('button');
      btnPlay.className = 'song-play-btn';
      btnPlay.textContent = '▶ ATIVAR';
      btnPlay.addEventListener('click', () => {
        if (myRole !== 'host' && myRole !== 'solo') {
          sendWs({ type: 'song_activate', songId: song.id });
          return;
        }

        audioEngine.setPadPreset(song.preset);
        document.getElementById('pad-preset-select').value = song.preset;
        setBpm(song.bpm);
        audioEngine.setMetronomeTimeSig(song.timeSig);
        document.getElementById('metro-time-sig').value = song.timeSig;
        updateBeatDots(parseInt(song.timeSig.split('/')[0]) || 4);
        audioEngine.playTone(song.keyIndex);
        updateToneUI(song.keyIndex);
        setlist.activeSongId = song.id;
        renderSetlist();

        if (myRole === 'host') broadcastHostState();
      });

      const btnEdit = document.createElement('button');
      btnEdit.className = 'song-edit-btn';
      btnEdit.textContent = '✎';
      btnEdit.title = 'Editar Música';
      btnEdit.addEventListener('click', () => {
        const newTitle = prompt('Novo nome da música:', song.title);
        if (!newTitle) return;
        const newBpm = parseInt(prompt('BPM:', song.bpm)) || song.bpm;
        const newTimeSig = prompt('Compasso (ex: 4/4 ou 6/8):', song.timeSig) || song.timeSig;
        const updates = { title: newTitle, bpm: newBpm, timeSig: newTimeSig };
        if (myRole === 'host' || myRole === 'solo') {
          setlist.updateSong(song.id, updates);
          renderSetlist();
          if (myRole === 'host') broadcastHostState();
        } else {
          sendWs({ type: 'setlist_edit', songId: song.id, updates });
        }
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'song-delete-btn';
      btnDelete.textContent = '✕';
      btnDelete.title = 'Excluir Música';
      btnDelete.addEventListener('click', () => {
        if (confirm(`Excluir ${song.title}?`)) {
          if (myRole === 'host' || myRole === 'solo') {
            setlist.deleteSong(song.id);
            renderSetlist();
            if (myRole === 'host') broadcastHostState();
          } else {
            sendWs({ type: 'setlist_delete', songId: song.id });
          }
        }
      });

      const btnGroup = document.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '8px';
      btnGroup.appendChild(btnPlay);
      btnGroup.appendChild(btnEdit);
      btnGroup.appendChild(btnDelete);

      item.appendChild(infoDiv);
      item.appendChild(btnGroup);
      songsListEl.appendChild(item);
    });
  }

  document.getElementById('btn-add-song').addEventListener('click', () => {
    const title = prompt('Nome da música:');
    if (title) {
      const bpm = parseInt(tempoNumberEl.textContent) || 120;
      const timeSig = document.getElementById('metro-time-sig')?.value || '4/4';
      const preset = document.getElementById('pad-preset-select')?.value || 'shimmer_2';
      const newSong = { title, keyIndex: 0, bpm, timeSig, preset };
      if (myRole === 'host' || myRole === 'solo') {
        setlist.addSong(title, 0, bpm, timeSig, preset);
        renderSetlist();
        if (myRole === 'host') broadcastHostState();
      } else {
        sendWs({ type: 'setlist_add', song: newSong });
      }
    }
  });

  // Modal Room Info
  const modalRoomInfo = document.getElementById('modal-room-info');
  document.getElementById('btn-room-info').addEventListener('click', () => {
    if (myRole !== 'solo') modalRoomInfo.classList.remove('hidden');
  });
  document.getElementById('btn-close-room-info').addEventListener('click', () => modalRoomInfo.classList.add('hidden'));

  document.getElementById('btn-leave-room').addEventListener('click', () => {
    isManualDisconnect = true;
    sessionStorage.removeItem('padstudio_room_code');
    sessionStorage.removeItem('padstudio_role');
    sessionStorage.removeItem('padstudio_host_token');
    currentRoomCode = null;
    hostToken = null;
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
      sseSource = null;
    }
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
    hideStatusBanner();
    modalRoomInfo.classList.add('hidden');
    goToGateway();
  });

  // ==========================================
  // AUTENTICAÇÃO JWT & PERFIL DA BANDA
  // ==========================================
  let authToken = localStorage.getItem('padstudio_auth_token') || null;
  let currentUser = null;

  async function checkAuth() {
    if (!authToken) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        updateAuthUI();
      } else {
        localStorage.removeItem('padstudio_auth_token');
        authToken = null;
        updateAuthUI();
      }
    } catch (e) {}
  }

  function updateAuthUI() {
    const pill = document.getElementById('btn-auth-open');
    const label = document.getElementById('auth-pill-text');
    const loggedBox = document.getElementById('auth-user-logged');
    const formAuth = document.getElementById('form-auth');
    const userNameEl = document.getElementById('logged-user-name');
    const bandNameEl = document.getElementById('logged-band-name');

    if (currentUser) {
      if (pill) pill.classList.add('logged');
      if (label) label.textContent = currentUser.bandName || currentUser.name;
      if (formAuth) formAuth.classList.add('hidden');
      if (loggedBox) loggedBox.classList.remove('hidden');
      if (userNameEl) userNameEl.textContent = currentUser.name;
      if (bandNameEl) bandNameEl.textContent = `Banda: ${currentUser.bandName || 'Livre'}`;
    } else {
      if (pill) pill.classList.remove('logged');
      if (label) label.textContent = 'Entrar / Banda';
      if (formAuth) formAuth.classList.remove('hidden');
      if (loggedBox) loggedBox.classList.add('hidden');
    }
  }

  const modalAuth = document.getElementById('modal-auth');
  const btnAuthOpen = document.getElementById('btn-auth-open');
  const btnCloseAuth = document.getElementById('btn-close-auth');
  const tabAuthLogin = document.getElementById('tab-auth-login');
  const tabAuthRegister = document.getElementById('tab-auth-register');
  const fieldBandName = document.getElementById('field-band-name');
  const btnAuthSubmit = document.getElementById('btn-auth-submit');
  const formAuth = document.getElementById('form-auth');
  const authError = document.getElementById('auth-error');
  const btnAuthLogout = document.getElementById('btn-auth-logout');

  let authMode = 'login'; // 'login' | 'register'

  if (btnAuthOpen) btnAuthOpen.addEventListener('click', () => modalAuth.classList.remove('hidden'));
  if (btnCloseAuth) btnCloseAuth.addEventListener('click', () => modalAuth.classList.add('hidden'));

  if (tabAuthLogin) {
    tabAuthLogin.addEventListener('click', () => {
      authMode = 'login';
      tabAuthLogin.classList.add('active');
      tabAuthRegister.classList.remove('active');
      fieldBandName.classList.add('hidden');
      btnAuthSubmit.textContent = 'Entrar';
      authError.classList.add('hidden');
    });
  }

  if (tabAuthRegister) {
    tabAuthRegister.addEventListener('click', () => {
      authMode = 'register';
      tabAuthRegister.classList.add('active');
      tabAuthLogin.classList.remove('active');
      fieldBandName.classList.remove('hidden');
      btnAuthSubmit.textContent = 'Criar Conta da Banda';
      authError.classList.add('hidden');
    });
  }

  if (formAuth) {
    formAuth.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError.classList.add('hidden');
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const bandName = document.getElementById('auth-band-name')?.value.trim();

      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload = authMode === 'register'
        ? { email, password, name: bandName || email.split('@')[0], bandName }
        : { email, password };

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const d = await resp.json();
        if (!resp.ok) {
          authError.textContent = d.error || 'Erro na autenticação.';
          authError.classList.remove('hidden');
          return;
        }

        authToken = d.token;
        currentUser = d.user;
        localStorage.setItem('padstudio_auth_token', authToken);
        updateAuthUI();
        showToast(`Bem-vindo, ${currentUser.bandName || currentUser.name}!`, 'success');
        modalAuth.classList.add('hidden');
      } catch (err) {
        authError.textContent = 'Falha ao conectar com o servidor.';
        authError.classList.remove('hidden');
      }
    });
  }

  if (btnAuthLogout) {
    btnAuthLogout.addEventListener('click', () => {
      localStorage.removeItem('padstudio_auth_token');
      authToken = null;
      currentUser = null;
      updateAuthUI();
      showToast('Desconectado com sucesso.');
      modalAuth.classList.add('hidden');
    });
  }

  checkAuth();

  // URL Query (?room=K7QF) or sessionStorage recovery
  const urlParams = new URLSearchParams(window.location.search);
  const autoRoom = urlParams.get('room');
  if (autoRoom) {
    inputGatewayCode.value = autoRoom.toUpperCase();
  } else {
    const savedRoom = sessionStorage.getItem('padstudio_room_code');
    const savedRole = sessionStorage.getItem('padstudio_role');
    if (savedRoom) {
      inputGatewayCode.value = savedRoom;
      if (savedRole && selectGatewayRole && ['keyboardist', 'drummer', 'leader'].includes(savedRole)) {
        selectGatewayRole.value = savedRole;
      }
    }
  }

  updateBeatDots(4);

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('[SW] Registro ignorado ou indisponível:', err);
      });
    });
  }
});
