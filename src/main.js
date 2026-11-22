// Entry point: boots the engine, UI and audio, then runs title -> chapters -> camp -> ending.
import './ui/styles.css';
import './ui/styles2.css';
import { Engine } from './core/engine.js';
import { audio } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { Dialogue } from './ui/dialogue.js';
import { Cinematic } from './game/cinematic.js';
import { GameState, Settings } from './game/state.js';
import { Battle } from './game/battle.js';
import { CHAPTERS } from './game/data/chapters/index.js';
import { showTitle, showGameOver, showCredits, openSettings, showLoading } from './ui/screens.js';
import { showCamp } from './ui/camp.js';
import { preloadCharacterAssets } from './gfx/characters.js';
import { devParams, devState } from './game/devtools.js';

const settings = Settings.load();
const canvas = document.getElementById('gl');
const uiRoot = document.getElementById('ui');
const loading = showLoading();

const engine = new Engine(canvas, settings.quality);
const ui = new UI(uiRoot, audio);
const game = {
  engine, ui, audio, settings,
  state: null,
  dialogue: null,
  cinematic: null,
  openSettings: () => openSettings(game),
};
game.dialogue = new Dialogue(ui, audio, () => settings);
game.cinematic = new Cinematic(engine, ui, audio, () => settings);
audio.setMusicVolume(settings.music);
audio.setSfxVolume(settings.sfx);
window.__game = game;

async function campaign() {
  while (game.state.chapter < CHAPTERS.length) {
    const idx = game.state.chapter;
    const snap = game.state.snapshot();
    const battle = new Battle(game, CHAPTERS[idx], idx);
    game.battle = battle;
    let result;
    try {
      result = await battle.run();
    } catch (e) {
      console.error('Battle crashed:', e && e.stack ? e.stack : e);
      result = 'defeat';
    }
    await engine.fade(1, 0.6);
    battle.dispose();
    ui.showHud(false);
    if (result === 'victory') {
      game.state.chapter++;
      game.state.stats.battles++;
      game.state.save();
      if (game.state.chapter >= CHAPTERS.length) {
        await engine.fade(0, 0.3);
        await showCredits(game);
        return;
      }
      if (!game.dev?.chapter || new URLSearchParams(location.search).get('camp') === '1') await showCamp(game);
    } else {
      await engine.fade(0, 0.3);
      const choice = await showGameOver(game);
      game.state.restore(snap);
      if (choice === 'title') return;
    }
  }
}

async function main() {
  engine.fade(1, 0);
  engine.start();
  loading.progress(0.3);
  await preloadCharacterAssets?.();
  loading.progress(1);
  await loading.done();
  const dev = devParams();
  engine.timeScale = dev.speed;
  if (dev.anim) settings.anim = dev.anim;
  if (dev.quality) engine.setQuality(dev.quality);
  game.auto = dev.auto;
  game.dev = dev;
  if (dev.skip) game.dialogue.alwaysSkip = true;
  const campOnly = +new URLSearchParams(location.search).get('campOnly');
  if (campOnly) {
    await audio.init().catch(() => {});
    game.state = devState(Math.max(0, Math.min(5, campOnly - 1)));
    await showCamp(game);
    return;
  }
  if (dev.chapter) {
    await audio.init().catch(() => {});
    game.state = devState(dev.chapter - 1);
    await campaign();
    return;
  }
  for (;;) {
    const choice = await showTitle(game);
    game.state = choice === 'continue' ? (GameState.load() || GameState.fresh()) : GameState.fresh();
    await campaign();
    await engine.fade(1, 0.5);
  }
}

main().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:20px;color:#fbb;background:#200;padding:16px;white-space:pre-wrap;z-index:999;pointer-events:auto';
  pre.textContent = `Something went wrong while starting the game:\n${e && e.stack ? e.stack : e}`;
  document.body.appendChild(pre);
});
