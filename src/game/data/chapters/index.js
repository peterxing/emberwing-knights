import ch1 from './ch1.js';
import ch2 from './ch2.js';
import ch3 from './ch3.js';
import ch4 from './ch4.js';
import ch5 from './ch5.js';
import ch6 from './ch6.js';

export const CHAPTERS = [ch1, ch2, ch3, ch4, ch5, ch6];

/** Party at the start of the campaign. */
export const STARTING_PARTY = ['kael', 'lyra', 'garrick'];
export const STARTING_GOLD = 300;
export const STARTING_ITEMS = { herb: 3 };

/** Lines spoken when a hero is defeated (they retreat and return next chapter; Kael's fall ends the game). */
export const RETREAT_LINES = {
  kael: { e: 'hurt', t: "Sorry... everyone... I couldn't..." },
  lyra: { e: 'hurt', t: "I can't... go on... Forgive me..." },
  garrick: { e: 'hurt', t: 'Hah... getting too old for this... Falling back...' },
  fenn: { e: 'hurt', t: "Argh! Okay, okay — I'm out! Don't lose without me!" },
  vex: { e: 'hurt', t: "Tch. I'm done. Don't die while I'm gone." },
  mira: { e: 'hurt', t: "Retreating! This isn't over!" },
  sora: { e: 'hurt', t: 'Cinder, pull out! Sorry, everyone!' },
};
