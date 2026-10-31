/**
 * Catálogo de sons: fonte única para o motor de áudio e para a interface.
 * Mudar um nome, uma cor ou um arquivo aqui muda o app inteiro.
 */

export const NOTE_FILES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];

export const NOTE_LABELS = {
  cifra_sharp: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  cifra_flat: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  solfejo_sharp: ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'],
  solfejo_flat: ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol♭', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si']
};

export function noteLabels(notation = 'cifra', accidental = 'sharp') {
  return NOTE_LABELS[`${notation}_${accidental}`] || NOTE_LABELS.cifra_sharp;
}

/** Timbres de pad, na ordem em que aparecem no app. `file(n)` monta o nome do arquivo de cada tom. */
export const PAD_PRESETS = [
  { id: 'shimmer_2', name: 'Shimmer Modern', file: n => `shimmer2_${n}` },
  { id: 'warm_pad', name: 'Warm Pad', file: n => `analog_${n}` },
  { id: 'worship', name: 'Worship', file: n => n },
  { id: 'pad_shimmer', name: 'Shimmer Celestial', file: n => `shimmer_${n}` },
  { id: 'abba_pad', name: 'Abba Pad', file: n => `${n}_abba` },
  { id: 'dark_pad', name: 'Dark Drone', file: n => `dark_${n}` },
  { id: 'pad_reverse', name: 'Reverse Ambient', file: n => `${n}_reverse` },
  { id: 'pad_synth', name: 'Synth Pad', file: n => `${n}_synth` }
];

export const DEFAULT_PRESET = 'shimmer_2';
export const PRESET_IDS = PAD_PRESETS.map(p => p.id);

export function padUrls(presetId) {
  const preset = PAD_PRESETS.find(p => p.id === presetId);
  if (!preset) return [];
  return NOTE_FILES.map(n => `audio/pads/${preset.id}/${preset.file(n)}.m4a`);
}

export const DRUM_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];

const pad = (name, file, color) => ({ name, file, color });

export const DRUM_KITS = [
  {
    id: 'kit_3', name: 'Rock Worship', pads: [
      pad('Bumbo', 'kit_3/kick', '#FF453A'),
      pad('Caixa', 'kit_3/snare', '#FF9F0A'),
      pad('Chimbal fechado', 'kit_3/hihat', '#30D158'),
      pad('Chimbal aberto', 'kit_3/hihat_open', '#64D2FF'),
      pad('Tom 1', 'kit_3/tom_1', '#5E5CE6'),
      pad('Tom 2', 'kit_3/tom_2', '#BF5AF2'),
      pad('Surdo', 'kit_3/tom_3', '#AF52DE'),
      pad('Prato', 'kit_3/crash', '#FFD60A')
    ]
  },
  {
    id: 'kit_1', name: 'Worship Claps & Sub-Kick', pads: [
      pad('Sub kick', 'kit_1/sub_kick', '#FF375F'),
      pad('Kick punch', 'kit_1/kick_1', '#FF9F0A'),
      pad('Palmas', 'kit_1/clap_1', '#30D158'),
      pad('Tom 1', 'kit_1/tom_1', '#64D2FF'),
      pad('Tom 2', 'kit_1/tom_2', '#BF5AF2'),
      pad('Tom 3', 'kit_1/tom_3', '#5E5CE6'),
      pad('Tumb', 'kit_1/tumb_1', '#FF9500'),
      pad('Wood click', 'kit_1/wood_1', '#0A84FF')
    ]
  },
  {
    id: 'acoustic', name: 'Acústico', pads: [
      pad('Bumbo', 'acoustic/kick', '#FF453A'),
      pad('Caixa', 'acoustic/snare', '#FF9F0A'),
      pad('Chimbal', 'acoustic/hihat', '#30D158'),
      pad('Percussão', 'acoustic/perc_fx', '#64D2FF'),
      pad('Tumb', 'acoustic/tumb_fx', '#BF5AF2'),
      pad('Wood block', 'acoustic/wood_fx', '#5E5CE6'),
      pad('Ruído branco', 'acoustic/noise_fx', '#98989D'),
      pad('Swell', 'acoustic/swell_fx', '#0A84FF')
    ]
  },
  {
    id: 'kit_2', name: 'Cinematic FX', pads: [
      pad('Boom', 'kit_2/boom', '#FF453A'),
      pad('FX tom', 'kit_2/fx_tom', '#FF9F0A'),
      pad('Ruído branco', 'kit_2/2_white_noise', '#98989D'),
      pad('Tom 1', 'kit_2/tom_1', '#64D2FF'),
      pad('Tom 2', 'kit_2/tom_2', '#BF5AF2'),
      pad('Tom 3', 'kit_2/tom_3', '#5E5CE6'),
      pad('Tumb', 'kit_2/tumb_2', '#FFD60A'),
      pad('Swell', 'kit_2/swell', '#0A84FF')
    ]
  },
  {
    id: 'kit_4', name: 'Hybrid Ambient', pads: [
      pad('Sub kick FX', 'kit_4/sub_kick_fx', '#FF375F'),
      pad('Boom FX', 'kit_4/boom_fx', '#FF9F0A'),
      pad('Blop', 'kit_4/blop_fx', '#30D158'),
      pad('Percussão', 'kit_4/perc_fx', '#64D2FF'),
      pad('Tumb', 'kit_4/tumb_fx', '#BF5AF2'),
      pad('Wood block', 'kit_4/wood_fx', '#5E5CE6'),
      pad('Glitch', 'kit_4/noise_fx', '#98989D'),
      pad('Swell', 'kit_4/swell_fx', '#0A84FF')
    ]
  }
];

export const DEFAULT_KIT = 'kit_3';
export const KIT_IDS = DRUM_KITS.map(k => k.id);

export function getKit(kitId) {
  return DRUM_KITS.find(k => k.id === kitId) || DRUM_KITS[0];
}

export function drumUrl(padDef) {
  return `audio/drums/${padDef.file}.flac`;
}

export const CLICK_SOUNDS = [
  { id: 'classic', name: 'Clássico' },
  { id: 'blip', name: 'Blip' },
  { id: 'logic', name: 'Digital' },
  { id: 'cowbell', name: 'Cowbell' }
];
export const DEFAULT_CLICK = 'classic';
export const CLICK_IDS = CLICK_SOUNDS.map(c => c.id);

export function clickUrls(clickId) {
  const id = CLICK_IDS.includes(clickId) ? clickId : DEFAULT_CLICK;
  return { accent: `audio/clicks/${id}_accent.flac`, normal: `audio/clicks/${id}_normal.flac` };
}

export const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4'];

/** Todos os arquivos de áudio do app (para o download offline). */
export function allAudioUrls() {
  return [
    ...PRESET_IDS.flatMap(padUrls),
    ...DRUM_KITS.flatMap(k => k.pads.map(drumUrl)),
    ...CLICK_IDS.flatMap(id => Object.values(clickUrls(id)))
  ];
}
