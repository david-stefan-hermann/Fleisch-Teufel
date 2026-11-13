/**
 * Figures that come with the app. "Teufelchen": own pixel art of the app's devil (64 px grid drawn at
 * 4×, 256 px stills, MIT like the app), standing free with a glow. Uploaded packs use the same manifest
 * format (`SkinManifest`).
 */
import type { SkinManifest } from '@ft/shared';
import augenZu from './teufelchen/02-augen-zu.png';
import denkt from './teufelchen/04-denkt.png';
import fehler from './teufelchen/07-fehler.png';
import fragt from './teufelchen/05-fragt.png';
import freutSich from './teufelchen/08-freut-sich.png';
import hoertZu from './teufelchen/03-hoert-zu.png';
import nichtVerstanden from './teufelchen/06-nicht-verstanden.png';
import ruhe from './teufelchen/01-ruhe.png';

export interface BuiltinSkin {
  id: string;
  manifest: SkinManifest;
  urls: Record<string, string>;
  /** Pixel art: the size of one drawn pixel in the picture's own pixels. */
  grid?: number;
}

export const TEUFELCHEN: BuiltinSkin = {
  id: 'teufelchen',
  grid: 4,
  manifest: {
    format: 'fleisch-teufel-skin',
    version: 1,
    name: 'Teufelchen',
    style: 'free',
    pixelArt: true,
    thinkingDots: false,
    images: {
      ruhe: '01-ruhe.png',
      'augen-zu': '02-augen-zu.png',
      'hoert-zu': '03-hoert-zu.png',
      denkt: '04-denkt.png',
      fragt: '05-fragt.png',
      'nicht-verstanden': '06-nicht-verstanden.png',
      fehler: '07-fehler.png',
      'freut-sich': '08-freut-sich.png',
    },
    states: {
      idle: 'ruhe',
      typing: 'ruhe',
      listening: 'hoert-zu',
      warn: 'nicht-verstanden',
      thinking: 'denkt',
      asking: 'fragt',
      confused: 'nicht-verstanden',
      error: 'fehler',
      done: 'freut-sich',
      undone: 'augen-zu',
      discarded: 'fehler',
      carried: 'freut-sich',
    },
    idle: ['augen-zu', 'freut-sich', 'fragt'],
  },
  urls: {
    ruhe,
    'augen-zu': augenZu,
    'hoert-zu': hoertZu,
    denkt,
    fragt,
    'nicht-verstanden': nichtVerstanden,
    fehler,
    'freut-sich': freutSich,
  },
};

export const BUILTIN_SKINS: readonly BuiltinSkin[] = [TEUFELCHEN];
