/**
 * PadStudio Audio Engine - Host & Solo Dedicated Audio Engine
 * Supports:
 * - 8 High-Def Pad Presets with smooth morphing & zero-delay preloading
 * - 5 Professional Drum Kits (Acoustic, Worship Claps & Sub, Cinematic, Rock Live, Hybrid FX)
 * - Master DynamicsCompressor limiter to prevent distortion
 * - Lookahead metronome with pan separation
 */

class PadStudioAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterLimiter = null;
    this.padMasterGain = null;
    this.metroMasterGain = null;
    this.metroPanner = null;
    this.drumMasterGain = null;

    // Pad Engine
    this.activeToneIndex = null;
    this.activePadVoice = null;
    this.crossfadeTime = 1.0;
    this.padLpfFreq = 14000;
    this.padHpfFreq = 30;
    this.padPreset = 'shimmer_2';

    // Drum Engine
    this.activeDrumKit = 'kit_3'; // Default to Rock Worship (Crash, Hihats, Kick, Snare, Toms)

    // In-memory audio buffers { "url": AudioBuffer }
    this.audioBufferCache = {};

    // Metronome
    this.metroPlaying = false;
    this.bpm = 120;
    this.timeSig = '4/4';
    this.beatsPerBar = 4;
    this.accentEnabled = true;
    this.currentBeat = 0;
    this.nextNoteTime = 0.0;
    this.metroTimerId = null;
    this.onBeatCallback = null;

    // Manifests
    this.padManifest = {
      "warm_pad": [
        "audio/pads/warm_pad/analog_c.m4a",
        "audio/pads/warm_pad/analog_cs.m4a",
        "audio/pads/warm_pad/analog_d.m4a",
        "audio/pads/warm_pad/analog_ds.m4a",
        "audio/pads/warm_pad/analog_e.m4a",
        "audio/pads/warm_pad/analog_f.m4a",
        "audio/pads/warm_pad/analog_fs.m4a",
        "audio/pads/warm_pad/analog_g.m4a",
        "audio/pads/warm_pad/analog_gs.m4a",
        "audio/pads/warm_pad/analog_a.m4a",
        "audio/pads/warm_pad/analog_as.m4a",
        "audio/pads/warm_pad/analog_b.m4a"
      ],
      "worship": [
        "audio/pads/worship/c.m4a",
        "audio/pads/worship/cs.m4a",
        "audio/pads/worship/d.m4a",
        "audio/pads/worship/ds.m4a",
        "audio/pads/worship/e.m4a",
        "audio/pads/worship/f.m4a",
        "audio/pads/worship/fs.m4a",
        "audio/pads/worship/g.m4a",
        "audio/pads/worship/gs.m4a",
        "audio/pads/worship/a.m4a",
        "audio/pads/worship/as.m4a",
        "audio/pads/worship/b.m4a"
      ],
      "pad_shimmer": [
        "audio/pads/pad_shimmer/shimmer_c.m4a",
        "audio/pads/pad_shimmer/shimmer_cs.m4a",
        "audio/pads/pad_shimmer/shimmer_d.m4a",
        "audio/pads/pad_shimmer/shimmer_ds.m4a",
        "audio/pads/pad_shimmer/shimmer_e.m4a",
        "audio/pads/pad_shimmer/shimmer_f.m4a",
        "audio/pads/pad_shimmer/shimmer_fs.m4a",
        "audio/pads/pad_shimmer/shimmer_g.m4a",
        "audio/pads/pad_shimmer/shimmer_gs.m4a",
        "audio/pads/pad_shimmer/shimmer_a.m4a",
        "audio/pads/pad_shimmer/shimmer_as.m4a",
        "audio/pads/pad_shimmer/shimmer_b.m4a"
      ],
      "shimmer_2": [
        "audio/pads/shimmer_2/shimmer2_c.m4a",
        "audio/pads/shimmer_2/shimmer2_cs.m4a",
        "audio/pads/shimmer_2/shimmer2_d.m4a",
        "audio/pads/shimmer_2/shimmer2_ds.m4a",
        "audio/pads/shimmer_2/shimmer2_e.m4a",
        "audio/pads/shimmer_2/shimmer2_f.m4a",
        "audio/pads/shimmer_2/shimmer2_fs.m4a",
        "audio/pads/shimmer_2/shimmer2_g.m4a",
        "audio/pads/shimmer_2/shimmer2_gs.m4a",
        "audio/pads/shimmer_2/shimmer2_a.m4a",
        "audio/pads/shimmer_2/shimmer2_as.m4a",
        "audio/pads/shimmer_2/shimmer2_b.m4a"
      ],
      "abba_pad": [
        "audio/pads/abba_pad/c_abba.m4a",
        "audio/pads/abba_pad/cs_abba.m4a",
        "audio/pads/abba_pad/d_abba.m4a",
        "audio/pads/abba_pad/ds_abba.m4a",
        "audio/pads/abba_pad/e_abba.m4a",
        "audio/pads/abba_pad/f_abba.m4a",
        "audio/pads/abba_pad/fs_abba.m4a",
        "audio/pads/abba_pad/g_abba.m4a",
        "audio/pads/abba_pad/gs_abba.m4a",
        "audio/pads/abba_pad/a_abba.m4a",
        "audio/pads/abba_pad/as_abba.m4a",
        "audio/pads/abba_pad/b_abba.m4a"
      ],
      "dark_pad": [
        "audio/pads/dark_pad/dark_c.m4a",
        "audio/pads/dark_pad/dark_cs.m4a",
        "audio/pads/dark_pad/dark_d.m4a",
        "audio/pads/dark_pad/dark_ds.m4a",
        "audio/pads/dark_pad/dark_e.m4a",
        "audio/pads/dark_pad/dark_f.m4a",
        "audio/pads/dark_pad/dark_fs.m4a",
        "audio/pads/dark_pad/dark_g.m4a",
        "audio/pads/dark_pad/dark_gs.m4a",
        "audio/pads/dark_pad/dark_a.m4a",
        "audio/pads/dark_pad/dark_as.m4a",
        "audio/pads/dark_pad/dark_b.m4a"
      ],
      "pad_reverse": [
        "audio/pads/pad_reverse/c_reverse.m4a",
        "audio/pads/pad_reverse/cs_reverse.m4a",
        "audio/pads/pad_reverse/d_reverse.m4a",
        "audio/pads/pad_reverse/ds_reverse.m4a",
        "audio/pads/pad_reverse/e_reverse.m4a",
        "audio/pads/pad_reverse/f_reverse.m4a",
        "audio/pads/pad_reverse/fs_reverse.m4a",
        "audio/pads/pad_reverse/g_reverse.m4a",
        "audio/pads/pad_reverse/gs_reverse.m4a",
        "audio/pads/pad_reverse/a_reverse.m4a",
        "audio/pads/pad_reverse/as_reverse.m4a",
        "audio/pads/pad_reverse/b_reverse.m4a"
      ],
      "pad_synth": [
        "audio/pads/pad_synth/c_synth.m4a",
        "audio/pads/pad_synth/cs_synth.m4a",
        "audio/pads/pad_synth/d_synth.m4a",
        "audio/pads/pad_synth/ds_synth.m4a",
        "audio/pads/pad_synth/e_synth.m4a",
        "audio/pads/pad_synth/f_synth.m4a",
        "audio/pads/pad_synth/fs_synth.m4a",
        "audio/pads/pad_synth/g_synth.m4a",
        "audio/pads/pad_synth/gs_synth.m4a",
        "audio/pads/pad_synth/a_synth.m4a",
        "audio/pads/pad_synth/as_synth.m4a",
        "audio/pads/pad_synth/b_synth.m4a"
      ]
    };

    // 5 Drum Kits Manifest
    this.drumKits = {
      "kit_3": {
        name: "Rock Worship (Crash & Chimbais)",
        pads: [
          { id: "p1", name: "Bumbo (Kick)", key: "Q", file: "audio/drums/kit_3/kick.wav", color: "#ff453a" },
          { id: "p2", name: "Caixa (Snare)", key: "W", file: "audio/drums/kit_3/snare.wav", color: "#ff9f0a" },
          { id: "p3", name: "Chimbal Fechado", key: "E", file: "audio/drums/kit_3/hihat.wav", color: "#30d158" },
          { id: "p4", name: "Chimbal Aberto", key: "R", file: "audio/drums/kit_3/hihat_open.wav", color: "#64d2ff" },
          { id: "p5", name: "Tom 1 (Alto)", key: "A", file: "audio/drums/kit_3/tom_1.wav", color: "#5e5ce6" },
          { id: "p6", name: "Tom 2 (Médio)", key: "S", file: "audio/drums/kit_3/tom_2.wav", color: "#bf5af2" },
          { id: "p7", name: "Tom 3 (Surdo)", key: "D", file: "audio/drums/kit_3/tom_3.wav", color: "#af52de" },
          { id: "p8", name: "Prato (Crash)", key: "F", file: "audio/drums/kit_3/crash.wav", color: "#ffd60a" }
        ]
      },
      "acoustic": {
        name: "Acústico Natural",
        pads: [
          { id: "p1", name: "Bumbo Acústico", key: "Q", file: "audio/drums/acoustic/kick.wav", color: "#ff453a" },
          { id: "p2", name: "Caixa Acústica", key: "W", file: "audio/drums/acoustic/snare.wav", color: "#ff9f0a" },
          { id: "p3", name: "Chimbal Acústico", key: "E", file: "audio/drums/acoustic/hihat.wav", color: "#30d158" },
          { id: "p4", name: "Percussão FX", key: "R", file: "audio/drums/acoustic/perc_fx.wav", color: "#64d2ff" },
          { id: "p5", name: "Tumb FX", key: "A", file: "audio/drums/acoustic/tumb_fx.wav", color: "#bf5af2" },
          { id: "p6", name: "Wood Block", key: "S", file: "audio/drums/acoustic/wood_fx.wav", color: "#5e5ce6" },
          { id: "p7", name: "White Noise", key: "D", file: "audio/drums/acoustic/noise_fx.wav", color: "#98989d" },
          { id: "p8", name: "Swell Crescendo", key: "F", file: "audio/drums/acoustic/swell_fx.wav", color: "#0a84ff" }
        ]
      },
      "kit_1": {
        name: "Worship Claps & Sub-Kick",
        pads: [
          { id: "p1", name: "Sub Kick Grave", key: "Q", file: "audio/drums/kit_1/sub_kick.wav", color: "#ff375f" },
          { id: "p2", name: "Kick Punch", key: "W", file: "audio/drums/kit_1/kick_1.wav", color: "#ff9f0a" },
          { id: "p3", name: "Palmas (Clap)", key: "E", file: "audio/drums/kit_1/clap_1.wav", color: "#30d158" },
          { id: "p4", name: "Tom 1", key: "R", file: "audio/drums/kit_1/tom_1.wav", color: "#64d2ff" },
          { id: "p5", name: "Tom 2", key: "A", file: "audio/drums/kit_1/tom_2.wav", color: "#bf5af2" },
          { id: "p6", name: "Tom 3", key: "S", file: "audio/drums/kit_1/tom_3.wav", color: "#5e5ce6" },
          { id: "p7", name: "Tumb Perc", key: "D", file: "audio/drums/kit_1/tumb_1.wav", color: "#ff9500" },
          { id: "p8", name: "Wood Click", key: "F", file: "audio/drums/kit_1/wood_1.wav", color: "#0a84ff" }
        ]
      },
      "kit_2": {
        name: "Cinematic FX & Booms",
        pads: [
          { id: "p1", name: "Boom Sub-Grave", key: "Q", file: "audio/drums/kit_2/boom.wav", color: "#ff453a" },
          { id: "p2", name: "FX Tom", key: "W", file: "audio/drums/kit_2/fx_tom.wav", color: "#ff9f0a" },
          { id: "p3", name: "White Noise", key: "E", file: "audio/drums/kit_2/2_white_noise.wav", color: "#98989d" },
          { id: "p4", name: "Tom 1", key: "R", file: "audio/drums/kit_2/tom_1.wav", color: "#64d2ff" },
          { id: "p5", name: "Tom 2", key: "A", file: "audio/drums/kit_2/tom_2.wav", color: "#bf5af2" },
          { id: "p6", name: "Tom 3", key: "S", file: "audio/drums/kit_2/tom_3.wav", color: "#5e5ce6" },
          { id: "p7", name: "Tumb 2", key: "D", file: "audio/drums/kit_2/tumb_2.wav", color: "#ffd60a" },
          { id: "p8", name: "Swell Expansivo", key: "F", file: "audio/drums/kit_2/swell.wav", color: "#0a84ff" }
        ]
      },
      "kit_4": {
        name: "Hybrid Ambient FX",
        pads: [
          { id: "p1", name: "Sub Kick FX", key: "Q", file: "audio/drums/kit_4/sub_kick_fx.wav", color: "#ff375f" },
          { id: "p2", name: "Boom FX", key: "W", file: "audio/drums/kit_4/boom_fx.wav", color: "#ff9f0a" },
          { id: "p3", name: "Blop Perc", key: "E", file: "audio/drums/kit_4/blop_fx.wav", color: "#30d158" },
          { id: "p4", name: "Percussão FX", key: "R", file: "audio/drums/kit_4/perc_fx.wav", color: "#64d2ff" },
          { id: "p5", name: "Tumb FX", key: "A", file: "audio/drums/kit_4/tumb_fx.wav", color: "#bf5af2" },
          { id: "p6", name: "Wood Block", key: "S", file: "audio/drums/kit_4/wood_fx.wav", color: "#5e5ce6" },
          { id: "p7", name: "Noise Glitch", key: "D", file: "audio/drums/kit_4/noise_fx.wav", color: "#98989d" },
          { id: "p8", name: "Swell FX", key: "F", file: "audio/drums/kit_4/swell_fx.wav", color: "#0a84ff" }
        ]
      }
    };
  }

  // Explicit unlock required by iOS/macOS/Chrome audio policies
  async unlock() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext({ latencyHint: 'interactive' });

      // Master Limiter (DynamicsCompressor)
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.setValueAtTime(-1.0, this.ctx.currentTime);
      this.masterLimiter.knee.setValueAtTime(4.0, this.ctx.currentTime);
      this.masterLimiter.ratio.setValueAtTime(16.0, this.ctx.currentTime);
      this.masterLimiter.attack.setValueAtTime(0.002, this.ctx.currentTime);
      this.masterLimiter.release.setValueAtTime(0.08, this.ctx.currentTime);
      this.masterLimiter.connect(this.ctx.destination);

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
      this.masterGain.connect(this.masterLimiter);

      // Pad Bus
      this.padMasterGain = this.ctx.createGain();
      this.padMasterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
      this.padMasterGain.connect(this.masterGain);

      // Metronome Bus with Stereo Panner
      this.metroMasterGain = this.ctx.createGain();
      this.metroMasterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

      if (this.ctx.createStereoPanner) {
        this.metroPanner = this.ctx.createStereoPanner();
        this.metroPanner.pan.setValueAtTime(0, this.ctx.currentTime);
        this.metroMasterGain.connect(this.metroPanner);
        this.metroPanner.connect(this.masterGain);
      } else {
        this.metroMasterGain.connect(this.masterGain);
      }

      // Drum Bus
      this.drumMasterGain = this.ctx.createGain();
      this.drumMasterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
      this.drumMasterGain.connect(this.masterGain);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // Preload active preset and current drum kit
    await this.preloadPack();
    return true;
  }

  async preloadPack() {
    const padUrls = this.padManifest[this.padPreset] || [];
    const currentKit = this.drumKits[this.activeDrumKit] || this.drumKits["kit_3"];
    const drumUrls = currentKit.pads.map(p => p.file);
    const clickUrls = ['audio/clicks/classic_accent.wav', 'audio/clicks/classic_normal.wav'];
    const all = [...padUrls, ...drumUrls, ...clickUrls];

    for (const url of all) {
      this.getBuffer(url);
    }
  }

  async getBuffer(url) {
    if (this.audioBufferCache[url]) {
      return this.audioBufferCache[url];
    }
    try {
      const resp = await fetch(url);
      const ab = await resp.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(ab);
      this.audioBufferCache[url] = decoded;
      return decoded;
    } catch (e) {
      console.warn('Erro ao decodificar buffer:', url, e);
      return null;
    }
  }

  // ==========================================
  // PADS
  // ==========================================

  async playTone(toneIndex) {
    if (!this.ctx) return;
    if (this.activeToneIndex === toneIndex && this.activePadVoice) {
      return;
    }

    const previousVoice = this.activePadVoice;
    this.activeToneIndex = toneIndex;

    const urls = this.padManifest[this.padPreset] || this.padManifest['shimmer_2'] || this.padManifest['warm_pad'];
    const sampleUrl = urls[toneIndex];

    const buffer = await this.getBuffer(sampleUrl);
    if (!buffer) return;
    if (this.activeToneIndex !== toneIndex) return;

    const now = this.ctx.currentTime;
    const fadeDuration = parseFloat(this.crossfadeTime);

    const voiceGain = this.ctx.createGain();
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(this.padLpfFreq, now);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    source.connect(voiceGain);
    voiceGain.connect(lpf);
    lpf.connect(this.padMasterGain);

    // Instant attack
    voiceGain.gain.setValueAtTime(0.15, now);
    voiceGain.gain.linearRampToValueAtTime(1.0, now + 0.12);

    source.start(now);

    const newVoice = {
      source,
      gainNode: voiceGain,
      stop: () => {
        try {
          source.stop();
          source.disconnect();
          voiceGain.disconnect();
        } catch (e) {}
      }
    };

    this.activePadVoice = newVoice;

    if (previousVoice) {
      previousVoice.gainNode.gain.cancelScheduledValues(now);
      previousVoice.gainNode.gain.setValueAtTime(previousVoice.gainNode.gain.value, now);
      previousVoice.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);
      setTimeout(() => {
        previousVoice.stop();
      }, (fadeDuration + 0.1) * 1000);
    }
  }

  stopPad(fadeTime = 0.5) {
    if (!this.activePadVoice) return;
    const now = this.ctx.currentTime;
    const voice = this.activePadVoice;

    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
    voice.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeTime);

    setTimeout(() => {
      voice.stop();
    }, (fadeTime + 0.1) * 1000);

    this.activePadVoice = null;
    this.activeToneIndex = null;
  }

  async setPadPreset(presetKey) {
    if (this.padPreset === presetKey) return;
    const oldPreset = this.padPreset;
    this.padPreset = presetKey;

    // Liberar buffers de áudio do timbre anterior para economizar RAM
    if (oldPreset && this.padManifest[oldPreset]) {
      this.padManifest[oldPreset].forEach(url => {
        delete this.audioBufferCache[url];
      });
    }

    const urls = this.padManifest[presetKey] || [];
    for (const u of urls) this.getBuffer(u);

    if (this.activeToneIndex !== null) {
      const currentTone = this.activeToneIndex;
      this.activeToneIndex = null;
      await this.playTone(currentTone);
    }
  }

  // ==========================================
  // DRUMS & KITS
  // ==========================================

  setDrumKit(kitId) {
    if (this.drumKits[kitId]) {
      this.activeDrumKit = kitId;
      // Preload new kit samples
      const kit = this.drumKits[kitId];
      kit.pads.forEach(p => this.getBuffer(p.file));
    }
  }

  async playDrumPad(padIndex, velocity = 1.0) {
    if (!this.ctx) return;
    const currentKit = this.drumKits[this.activeDrumKit] || this.drumKits["kit_3"];
    const padConfig = currentKit.pads[padIndex];
    if (!padConfig) return;

    const buffer = await this.getBuffer(padConfig.file);
    if (!buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const hitGain = this.ctx.createGain();
    hitGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.2, velocity)), this.ctx.currentTime);

    src.connect(hitGain);
    hitGain.connect(this.drumMasterGain);
    src.start();
  }

  // ==========================================
  // METRONOME
  // ==========================================

  startMetronome() {
    if (!this.ctx) return;
    if (this.metroPlaying) return;
    this.metroPlaying = true;
    this.currentBeat = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.03;
    this.scheduleMetronome();
  }

  stopMetronome() {
    this.metroPlaying = false;
    if (this.metroTimerId) {
      clearTimeout(this.metroTimerId);
      this.metroTimerId = null;
    }
  }

  scheduleMetronome() {
    if (!this.metroPlaying) return;

    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.playClickAtTime(this.nextNoteTime, this.currentBeat);
      this.advanceMetronome();
    }

    this.metroTimerId = setTimeout(() => this.scheduleMetronome(), 20);
  }

  advanceMetronome() {
    const secondsPerBeat = 60.0 / this.bpm;
    this.nextNoteTime += secondsPerBeat;
    this.currentBeat++;
    if (this.currentBeat >= this.beatsPerBar) {
      this.currentBeat = 0;
    }
  }

  async playClickAtTime(time, beatNumber) {
    const isAccent = (beatNumber === 0) && this.accentEnabled;
    const ctx = this.ctx;

    if (this.onBeatCallback) {
      const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (this.metroPlaying && this.onBeatCallback) {
          this.onBeatCallback(beatNumber, isAccent);
        }
      }, delayMs);
    }

    const clickUrl = isAccent ? 'audio/clicks/classic_accent.wav' : 'audio/clicks/classic_normal.wav';
    const buffer = await this.getBuffer(clickUrl);

    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.metroMasterGain);
      src.start(time);
    }
  }

  setMetronomeBpm(bpm) {
    this.bpm = Math.max(40, Math.min(260, parseInt(bpm)));
  }

  setMetronomeTimeSig(timeSig) {
    this.timeSig = timeSig || '4/4';
    const count = parseInt(timeSig.split('/')[0]) || 4;
    this.beatsPerBar = count;
  }

  setMetronomePan(panValue) {
    if (this.metroPanner && this.ctx) {
      this.metroPanner.pan.setTargetAtTime(parseFloat(panValue), this.ctx.currentTime, 0.02);
    }
  }

  setVolume(target, value) {
    if (!this.ctx) return;
    const gainVal = Math.max(0, Math.min(1.0, value / 100));
    const now = this.ctx.currentTime;
    if (target === 'pad' && this.padMasterGain) {
      this.padMasterGain.gain.setTargetAtTime(gainVal, now, 0.03);
    } else if (target === 'drums' && this.drumMasterGain) {
      this.drumMasterGain.gain.setTargetAtTime(gainVal, now, 0.03);
    } else if (target === 'metro' && this.metroMasterGain) {
      this.metroMasterGain.gain.setTargetAtTime(gainVal, now, 0.03);
    } else if (target === 'master' && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(gainVal, now, 0.03);
    }
  }

  panicStop() {
    this.stopPad(0.05);
    this.stopMetronome();
    this.activeToneIndex = null;
  }
}

window.PadStudioAudioEngine = PadStudioAudioEngine;
