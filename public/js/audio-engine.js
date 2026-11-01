/**
 * Motor de áudio do Sus Pad (roda no host e no modo solo).
 *
 * - Pads em loop contínuo com crossfade calibrado (audio/pad-loops.json)
 * - Troca de timbre sem silêncio: o timbre atual segue tocando até o novo estar pronto
 * - Sons guardados no Cache Storage: depois de baixados, funcionam sem internet
 * - Metrônomo agendado por um Worker (não é desacelerado com a aba em segundo plano)
 * - Contagem de um compasso, subdivisão em colcheias e escolha do som do click
 */

import {
  DEFAULT_PRESET, DEFAULT_KIT, DEFAULT_CLICK, PRESET_IDS, KIT_IDS, CLICK_IDS,
  padUrls, getKit, drumUrl, clickUrls, allAudioUrls
} from './catalog.js';

// Ao substituir um arquivo de áudio mantendo o mesmo nome, aumente esta versão:
// os aparelhos baixam tudo de novo em vez de usar a cópia antiga.
export const AUDIO_CACHE = 'suspad-audio-v1';
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const MIN_CUTOFF_HZ = 300;
const MAX_CUTOFF_HZ = 20000;

/** Brilho 0–100 → frequência de corte (escala logarítmica, como o ouvido percebe). */
export function brightnessToHz(brightness) {
  const b = Math.max(0, Math.min(100, Number(brightness))) / 100;
  return MIN_CUTOFF_HZ * (MAX_CUTOFF_HZ / MIN_CUTOFF_HZ) ** b;
}

const hasCacheApi = () => typeof caches !== 'undefined';

/** Busca um arquivo de áudio, usando o Cache Storage quando disponível (HTTPS/localhost). */
async function fetchAudio(url) {
  if (hasCacheApi()) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(url);
      if (hit) return hit.arrayBuffer();
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      cache.put(url, resp.clone()).catch(() => {});
      return resp.arrayBuffer();
    } catch (err) {
      if (!navigator.onLine) throw err;
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  return resp.arrayBuffer();
}

function createTicker(onTick) {
  // Timers de Worker não são estrangulados como os da aba em segundo plano
  try {
    const src = `let id=null;onmessage=e=>{if(e.data==='start'&&!id){id=setInterval(()=>postMessage(0),${TICK_MS})}else if(e.data==='stop'){clearInterval(id);id=null}}`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = onTick;
    return { start: () => worker.postMessage('start'), stop: () => worker.postMessage('stop') };
  } catch (e) {
    let id = null;
    return {
      start: () => { if (!id) id = setInterval(onTick, TICK_MS); },
      stop: () => { clearInterval(id); id = null; }
    };
  }
}

export class SusPadAudioEngine {
  constructor() {
    this.ctx = null;
    this.buses = {};

    this.buffers = new Map();        // url -> AudioBuffer
    this.inflight = new Map();       // url -> Promise<AudioBuffer|null>
    this.preparedLoops = new Map();  // url -> { attack, loop } | null
    this.loopConfig = null;

    // Pads
    this.padPreset = DEFAULT_PRESET;   // timbre que está soando
    this.targetPreset = DEFAULT_PRESET; // timbre escolhido (pode estar carregando)
    this.activeToneIndex = null;
    this.activeVoice = null;
    this.padBrightness = 90; // 0–100: filtro passa-baixa do pad
    this.padFade = 1.0;      // segundos de transição entre tons e ao parar

    // Bateria
    this.drumKit = DEFAULT_KIT;

    // Click
    this.bpm = 120;
    this.timeSig = '4/4';
    this.beatsPerBar = 4;
    this.metroPlaying = false;
    this.metroPan = 0;
    this.countIn = false;
    this.subdivide = false;
    this.clickSound = DEFAULT_CLICK;
    this.onBeat = null;
    this.ticker = null;
    this.anchor = null;      // { time (ctx), beat }: referência para os celulares mostrarem o tempo
    this.reanchor = false;

    this.volumes = { pad: 90, drums: 85, metro: 80, master: 90 };

    /** Chamado sempre que algo assíncrono muda o estado (timbre carregou, contagem terminou). */
    this.onChange = null;
    /** Chamado com uma mensagem quando algo falha (ex.: sem internet para baixar um timbre). */
    this.onError = null;
  }

  emit() { this.onChange?.(); }
  fail(message) { this.onError?.(message); }

  // ------------------------------------------------------------------
  // Inicialização (precisa de um toque do usuário no iOS/Chrome)
  // ------------------------------------------------------------------

  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      const ctx = this.ctx;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 4;
      limiter.ratio.value = 16;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      limiter.connect(ctx.destination);

      const gain = (vol, dest) => {
        const g = ctx.createGain();
        g.gain.value = vol / 100;
        g.connect(dest);
        return g;
      };
      const master = gain(this.volumes.master, limiter);
      const pad = gain(this.volumes.pad, master);
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.Q.value = 0.5;
      padFilter.frequency.value = brightnessToHz(this.padBrightness);
      padFilter.connect(pad);
      const drums = gain(this.volumes.drums, master);
      const metro = ctx.createGain();
      metro.gain.value = this.volumes.metro / 100;
      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        metro.connect(panner);
        panner.connect(master);
      } else {
        metro.connect(master);
      }
      this.buses = { master, pad, padFilter, drums, metro, panner };
      this.ticker = createTicker(() => this.scheduleClicks());
    }

    await this.resume();
    this.loadLoopConfig();
    this.preload();
    return true;
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { /* aguardando gesto do usuário */ }
    }
  }

  /** Calibração dos loops: rede primeiro (pode ser recalibrada), cópia salva se offline. */
  async loadLoopConfig() {
    if (this.loopConfig) return this.loopConfig;
    if (!this.loopConfigJob) {
      this.loopConfigJob = (async () => {
        const url = 'audio/pad-loops.json';
        try {
          const resp = await fetch(url, { cache: 'no-cache' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          if (hasCacheApi()) caches.open(AUDIO_CACHE).then(c => c.put(url, resp.clone())).catch(() => {});
          return await resp.json();
        } catch (e) {
          const hit = hasCacheApi() ? await (await caches.open(AUDIO_CACHE)).match(url) : null;
          return hit ? hit.json() : {};
        }
      })();
    }
    this.loopConfig = await this.loopConfigJob;
    return this.loopConfig;
  }

  preload() {
    padUrls(this.padPreset).forEach(u => this.loadPad(u));
    getKit(this.drumKit).pads.forEach(p => this.getBuffer(drumUrl(p)));
    Object.values(clickUrls(this.clickSound)).forEach(u => this.getBuffer(u));
  }

  getBuffer(url) {
    if (this.buffers.has(url)) return Promise.resolve(this.buffers.get(url));
    if (this.inflight.has(url)) return this.inflight.get(url);
    const job = (async () => {
      try {
        const data = await fetchAudio(url);
        const buffer = await this.ctx.decodeAudioData(data);
        this.buffers.set(url, buffer);
        return buffer;
      } catch (e) {
        console.warn('[Áudio] Falha ao carregar', url, e);
        return null;
      } finally {
        this.inflight.delete(url);
      }
    })();
    this.inflight.set(url, job);
    return job;
  }

  // ------------------------------------------------------------------
  // Pads
  // ------------------------------------------------------------------

  /** Monta (uma vez por arquivo) o trecho de ataque e o loop com crossfade senoidal. */
  prepareLoop(url, buffer) {
    if (this.preparedLoops.has(url)) return this.preparedLoops.get(url);
    let prepared = null;
    const preset = url.split('/')[2];
    const name = url.split('/').pop().replace(/\.[^.]+$/, '');
    const info = this.loopConfig?.[preset]?.[name];

    if (info && buffer.duration > 8) {
      const isM4A = url.endsWith('.m4a');
      const loopStart = isM4A ? (info.m4aLoopStart ?? info.loopStart + 0.0156) : info.loopStart;
      const loopEnd = isM4A ? (info.m4aLoopEnd ?? info.loopEnd + 0.0156) : info.loopEnd;
      const sr = buffer.sampleRate;
      const ch = buffer.numberOfChannels;
      const startF = Math.max(1, Math.round(loopStart * sr));
      const endF = Math.round(Math.min(loopEnd, buffer.duration - 0.1) * sr);
      const fadeF = Math.round((info.crossfade || 3) * sr);
      const loopF = (endF - startF) - fadeF;

      if (loopF > fadeF) {
        const attack = this.ctx.createBuffer(ch, startF + fadeF, sr);
        const loop = this.ctx.createBuffer(ch, loopF, sr);
        const bodyF = loopF - fadeF;
        for (let c = 0; c < ch; c++) {
          const orig = buffer.getChannelData(c);
          attack.copyToChannel(orig.subarray(0, startF + fadeF), c);
          const out = loop.getChannelData(c);
          out.set(orig.subarray(startF + fadeF, endF - fadeF), 0);
          for (let f = 0; f < fadeF; f++) {
            const t = (f / fadeF) * (Math.PI / 2);
            out[bodyF + f] = orig[endF - fadeF + f] * Math.cos(t) + orig[startF + f] * Math.sin(t);
          }
        }
        prepared = { attack, loop };
      }
    }
    this.preparedLoops.set(url, prepared);
    return prepared;
  }

  /**
   * Carrega um pad já pronto para tocar. Quando há calibração de loop, guarda só
   * ataque + loop (~27 s) e descarta o arquivo original (40 s) da memória.
   */
  async loadPad(url) {
    if (this.preparedLoops.has(url)) return this.preparedLoops.get(url) || this.buffers.get(url) || null;
    const [buffer] = await Promise.all([this.getBuffer(url), this.loadLoopConfig()]);
    if (!buffer) return null;
    const prepared = this.prepareLoop(url, buffer);
    if (prepared) this.buffers.delete(url);
    return prepared || buffer;
  }

  async playTone(toneIndex) {
    if (!this.ctx || toneIndex < 0 || toneIndex > 11) return;
    const voice = this.activeVoice;
    if (this.activeToneIndex === toneIndex && voice && voice.tone === toneIndex && voice.preset === this.padPreset) return;
    this.activeToneIndex = toneIndex;
    const preset = this.padPreset;
    await this.resume();

    const url = padUrls(preset)[toneIndex];
    const sound = await this.loadPad(url);
    if (!sound) {
      if (this.activeToneIndex === toneIndex) {
        this.activeToneIndex = this.activeVoice ? this.activeVoice.tone : null;
        this.fail('Não foi possível carregar este som. Verifique a conexão.');
        this.emit();
      }
      return;
    }
    if (this.activeToneIndex !== toneIndex || this.padPreset !== preset) return; // mudou enquanto carregava

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const voiceGain = ctx.createGain();
    voiceGain.connect(this.buses.padFilter);

    const sources = [];
    const prepared = sound.attack ? sound : null;
    if (prepared) {
      const attack = ctx.createBufferSource();
      attack.buffer = prepared.attack;
      const loop = ctx.createBufferSource();
      loop.buffer = prepared.loop;
      loop.loop = true;
      attack.connect(voiceGain);
      loop.connect(voiceGain);
      attack.start(now);
      loop.start(now + prepared.attack.duration);
      sources.push(attack, loop);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = sound;
      src.loop = true;
      src.connect(voiceGain);
      src.start(now);
      sources.push(src);
    }

    voiceGain.gain.setValueAtTime(0.15, now);
    voiceGain.gain.linearRampToValueAtTime(1, now + 0.12);

    const previous = this.activeVoice;
    this.activeVoice = {
      tone: toneIndex,
      preset,
      gain: voiceGain,
      stop: () => {
        sources.forEach(s => { try { s.stop(); s.disconnect(); } catch (e) { /* já parado */ } });
        voiceGain.disconnect();
      }
    };
    if (previous) this.fadeOut(previous, this.padFade);
  }

  fadeOut(voice, seconds) {
    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
    setTimeout(() => voice.stop(), (seconds + 0.1) * 1000);
  }

  stopPad(fadeSeconds = Math.min(this.padFade, 2)) {
    if (this.activeVoice) this.fadeOut(this.activeVoice, fadeSeconds);
    this.activeVoice = null;
    this.activeToneIndex = null;
  }

  setPadOptions({ brightness, fade } = {}) {
    if (Number.isFinite(brightness)) {
      this.padBrightness = Math.max(0, Math.min(100, Math.round(brightness)));
      const freq = this.buses.padFilter?.frequency;
      if (freq) {
        const hz = brightnessToHz(this.padBrightness);
        freq.cancelScheduledValues(this.ctx.currentTime);
        // Tocando: desliza suave. Parado: aplica direto (o navegador não processa filtro sem áudio)
        if (this.activeVoice) freq.setTargetAtTime(hz, this.ctx.currentTime, 0.05);
        else freq.value = hz;
      }
    }
    if (Number.isFinite(fade)) this.padFade = Math.max(0.2, Math.min(6, Math.round(fade * 10) / 10));
  }

  get padLoading() {
    return this.targetPreset !== this.padPreset;
  }

  /**
   * Troca de timbre sem silêncio: o timbre atual continua até o tom necessário do novo
   * timbre estar decodificado; os outros 11 tons carregam em segundo plano.
   */
  async setPadPreset(presetId, priorityTone = null) {
    if (!PRESET_IDS.includes(presetId)) return;
    this.targetPreset = presetId;
    this.emit();
    if (presetId === this.padPreset) return;

    const urls = padUrls(presetId);
    const first = priorityTone ?? this.activeToneIndex ?? 0;
    const ready = await this.loadPad(urls[first]);
    if (this.targetPreset !== presetId) return; // outro timbre foi escolhido no meio

    if (!ready) {
      this.targetPreset = this.padPreset;
      this.fail('Sem conexão para carregar o timbre. O timbre anterior foi mantido.');
      this.emit();
      return;
    }

    const previous = this.padPreset;
    this.padPreset = presetId;
    // Tom soando no timbre antigo: crossfade para o mesmo tom no timbre novo
    if (this.activeToneIndex !== null) await this.playTone(this.activeToneIndex);
    this.emit();
    this.releasePreset(previous);
    urls.forEach(u => this.loadPad(u));
  }

  /** Libera da memória os loops decodificados de um timbre (cada timbre ocupa ~100 MB). */
  releasePreset(presetId) {
    if (presetId === this.padPreset || presetId === this.targetPreset) return;
    padUrls(presetId).forEach(u => {
      this.buffers.delete(u);
      this.preparedLoops.delete(u);
    });
  }

  /** Baixa só os arquivos (sem decodificar) para o próximo timbre estar pronto quando for preciso. */
  prefetchPreset(presetId) {
    if (!hasCacheApi() || !PRESET_IDS.includes(presetId)) return;
    padUrls(presetId).forEach(u => fetchAudio(u).catch(() => {}));
  }

  // ------------------------------------------------------------------
  // Bateria
  // ------------------------------------------------------------------

  setDrumKit(kitId) {
    if (!KIT_IDS.includes(kitId)) return;
    this.drumKit = kitId;
    getKit(kitId).pads.forEach(p => this.getBuffer(drumUrl(p)));
  }

  async playDrumPad(padIndex, velocity = 1) {
    if (!this.ctx) return;
    const def = getKit(this.drumKit).pads[padIndex];
    if (!def) return;
    const buffer = await this.getBuffer(drumUrl(def));
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(1, Math.max(0.2, velocity));
    src.connect(g);
    g.connect(this.buses.drums);
    src.start();
  }

  // ------------------------------------------------------------------
  // Click
  // ------------------------------------------------------------------

  startMetronome() {
    if (!this.ctx || this.metroPlaying) return;
    this.resume();
    this.metroPlaying = true;
    this.beat = 0;
    this.sub = 0;
    this.beatsLeft = this.countIn ? this.beatsPerBar : Infinity;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.anchor = { time: this.nextTime, beat: 0 };
    this.reanchor = false;
    this.ticker.start();
    this.scheduleClicks();
  }

  stopMetronome() {
    this.metroPlaying = false;
    this.anchor = null;
    this.ticker?.stop();
    clearTimeout(this.countInTimer);
  }

  scheduleClicks() {
    if (!this.metroPlaying) return;
    const spb = 60 / this.bpm;
    const step = this.subdivide ? spb / 2 : spb;

    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_S) {
      if (this.sub === 0) {
        if (this.beatsLeft <= 0) {
          // Fim da contagem: para quando o último tempo terminar de soar
          this.ticker.stop();
          const endsIn = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
          this.countInTimer = setTimeout(() => { this.metroPlaying = false; this.emit(); }, endsIn);
          return;
        }
        if (this.reanchor) {
          // BPM ou compasso mudou: nova referência de tempo para os celulares
          this.reanchor = false;
          this.anchor = { time: this.nextTime, beat: this.beat };
          setTimeout(() => this.emit(), 0);
        }
        this.click(this.nextTime, this.accentFor(this.beat), this.beat);
        this.beatsLeft -= 1;
      } else if (this.beatsLeft > 0) {
        this.click(this.nextTime, 'sub', this.beat);
      }

      this.nextTime += step;
      if (this.subdivide && this.sub === 0) {
        this.sub = 1;
      } else {
        this.sub = 0;
        this.beat = (this.beat + 1) % this.beatsPerBar;
      }
    }
  }

  /** Tempo 1 acentuado; no 6/8 o tempo 4 também (acento secundário, mais suave). */
  accentFor(beat) {
    if (beat === 0) return 'accent';
    if (this.timeSig === '6/8' && beat === 3) return 'accent2';
    return 'normal';
  }

  click(time, kind, beat) {
    const urls = clickUrls(this.clickSound);
    const url = kind === 'accent' || kind === 'accent2' ? urls.accent : urls.normal;
    const buffer = this.buffers.get(url);
    if (!buffer) {
      this.getBuffer(url);
      return; // nunca tocar um click atrasado
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const level = { sub: 0.4, accent2: 0.6 }[kind];
    if (level) {
      const g = this.ctx.createGain();
      g.gain.value = level;
      src.connect(g);
      g.connect(this.buses.metro);
    } else {
      src.connect(this.buses.metro);
    }
    src.start(time);

    if (kind !== 'sub' && this.onBeat) {
      const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
      setTimeout(() => this.metroPlaying && this.onBeat?.(beat, kind === 'accent'), delay);
    }
  }

  setMetronomeBpm(bpm) {
    const n = parseInt(bpm, 10);
    if (Number.isNaN(n)) return;
    const value = Math.max(30, Math.min(300, n));
    if (value !== this.bpm && this.metroPlaying) this.reanchor = true;
    this.bpm = value;
  }

  setMetronomeTimeSig(timeSig) {
    const next = typeof timeSig === 'string' ? timeSig : '4/4';
    if (next !== this.timeSig && this.metroPlaying) this.reanchor = true;
    this.timeSig = next;
    this.beatsPerBar = parseInt(this.timeSig.split('/')[0], 10) || 4;
    if (this.beat >= this.beatsPerBar) this.beat = 0;
  }

  setMetronomePan(value) {
    const v = Math.max(-1, Math.min(1, parseFloat(value) || 0));
    this.metroPan = v;
    if (this.buses.panner) this.buses.panner.pan.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMetronomeOptions({ countIn, subdivide, clickSound } = {}) {
    if (typeof countIn === 'boolean') this.countIn = countIn;
    if (typeof subdivide === 'boolean') this.subdivide = subdivide;
    if (CLICK_IDS.includes(clickSound) && clickSound !== this.clickSound) {
      this.clickSound = clickSound;
      Object.values(clickUrls(clickSound)).forEach(u => this.getBuffer(u));
    }
  }

  /**
   * Momento (relógio de parede, ms) de um tempo de referência do click, já somada a latência
   * de saída do áudio. Os celulares usam isso para piscar o tempo junto com o som do host.
   */
  metroAnchorWallClock() {
    if (!this.metroPlaying || !this.anchor || !this.ctx) return null;
    const outputLatency = (this.ctx.outputLatency || this.ctx.baseLatency || 0) * 1000;
    return {
      at: Math.round(Date.now() + (this.anchor.time - this.ctx.currentTime) * 1000 + outputLatency),
      beat: this.anchor.beat
    };
  }

  // ------------------------------------------------------------------
  // Mixer e pânico
  // ------------------------------------------------------------------

  setVolume(target, value) {
    if (!(target in this.volumes)) return;
    const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    this.volumes[target] = v;
    const bus = this.buses[target === 'drums' ? 'drums' : target];
    if (bus && this.ctx) bus.gain.setTargetAtTime(v / 100, this.ctx.currentTime, 0.03);
  }

  panicStop() {
    this.stopPad(0.05);
    this.stopMetronome();
  }

  // ------------------------------------------------------------------
  // Offline
  // ------------------------------------------------------------------

  /** Quantos arquivos de áudio já estão salvos no aparelho. */
  static async offlineStatus() {
    const total = allAudioUrls().length;
    if (!hasCacheApi()) return { supported: false, cached: 0, total };
    const cache = await caches.open(AUDIO_CACHE);
    const keys = await cache.keys();
    const wanted = new Set(allAudioUrls().map(u => new URL(u, location.href).href));
    const cached = keys.filter(k => wanted.has(k.url)).length;
    return { supported: true, cached, total };
  }

  /** Baixa todos os sons para o Cache Storage, sem decodificar (não ocupa memória). */
  static async downloadAll(onProgress) {
    const urls = allAudioUrls();
    if (!hasCacheApi()) throw new Error('Este navegador só guarda sons offline em HTTPS.');
    let done = 0;
    let failed = 0;
    const queue = [...urls];
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        try { await fetchAudio(url); } catch (e) { failed++; }
        done++;
        onProgress?.(done, urls.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { done, failed, total: urls.length };
  }
}
