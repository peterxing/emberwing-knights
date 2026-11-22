// Entry point: boots the engine, UI and audio, then runs title -> chapters -> camp -> ending.
import './ui/styles.css';
import './ui/styles2.css';
import './ui/mobile.css';
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

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r = 0) {
    const rr = Math.max(0, Math.min(typeof r === 'number' ? r : r[0] || 0, w / 2, h / 2));
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const touch = window.matchMedia?.('(pointer: coarse)').matches || false;
document.documentElement.classList.toggle('touch', touch);
let firstRun = true;
try { firstRun = !localStorage.getItem('emberwing.settings.v1'); } catch { /* private mode */ }
const settings = Settings.load();
if (firstRun && touch) settings.quality = 'medium';
const canvas = document.getElementById('gl');
const uiRoot = document.getElementById('ui');
const loading = showLoading();

const engine = new Engine(canvas, settings.quality);
const ui = new UI(uiRoot, audio);
const game = {
  engine, ui, audio, settings, touch,
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

/** Start audio but never block the game on it (some browsers keep the context suspended). */
function safeAudioInit() { try { return audio.init().catch(() => {}); } catch (e) { console.warn('[audio] init failed', e); return Promise.resolve(); } }
function audioReady() { return Promise.race([safeAudioInit(), new Promise((r) => setTimeout(r, 1500))]); }

// iOS/Android only start audio inside a user gesture; re-arm it on every tap (init() is idempotent).
const unlockAudio = () => { safeAudioInit(); };
window.addEventListener('touchend', unlockAudio, { passive: true });
window.addEventListener('click', unlockAudio);

// If the GPU drops our context (common on phones under memory pressure), offer a clean reload.
engine.onContextLost = () => {
  const el = document.createElement('div');
  el.className = 'modal-back';
  el.innerHTML = '<div class="modal panel ornate"><h2>Graphics reset</h2><p>Your device paused the 3D graphics to save memory. Progress is kept from your last camp save.</p><div class="actions"><button class="btn primary">Reload</button></div></div>';
  el.querySelector('button').onclick = () => location.reload();
  uiRoot.appendChild(el);
};

// Adaptive quality: step down once frame rate stays low (unless the player picked a quality themselves).
{
  let slow = 0, grace = 0;
  engine.onUpdate((dt) => {
    grace += dt;
    if (grace < 10 || settings.qualityManual || settings.quality === 'low' || document.hidden) return;
    slow = engine.fps < 28 ? slow + dt : Math.max(0, slow - dt * 2);
    if (slow > 6) {
      const next = settings.quality === 'high' ? 'medium' : 'low';
      settings.quality = next;
      Settings.save(settings);
      engine.setQuality(next);
      ui.toast(`Graphics set to ${next} for smoother play`, '⚙');
      slow = 0; grace = 0;
    }
  });
}

let portraitTipShown = false;
function maybePortraitTip() {
  if (!touch || portraitTipShown || window.innerWidth > window.innerHeight) return;
  portraitTipShown = true;
  setTimeout(() => ui.toast('Tip: turn your phone sideways for a wider battlefield', '📱'), 2500);
}

async function campaign() {
  while (game.state.chapter < CHAPTERS.length) {
    const idx = game.state.chapter;
    const snap = game.state.snapshot();
    const battle = new Battle(game, CHAPTERS[idx], idx);
    game.battle = battle;
    maybePortraitTip();
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
    await audioReady();
    game.state = devState(Math.max(0, Math.min(5, campOnly - 1)));
    await showCamp(game);
    return;
  }
  if (dev.chapter) {
    await audioReady();
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
