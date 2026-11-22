import { COLS, ROWS, MAX_ROUND, SITES, act, forecast, legalMoves, newGame, readSave } from './rules.js';

const $ = id => document.getElementById(id);
const coord = (x, y) => String.fromCharCode(65 + x) + (y + 1);
const marks = ['crest', 'rose', 'waylight'];
const names = { iria: 'Iria Vale', drake: 'Vesperglass Drake' };
const icons = { crest: '⚑', rose: '✧', waylight: '◆', lock: '▣' };
const saveKey = 'emberwing.tideglass.first-signal.v1';
const portable = document.documentElement.dataset.edition === 'portable';
const mapOnly = portable || new URLSearchParams(location.search).get('view') === 'map';
let state = newGame(), stage = null, opened = false, loadId = 0, focus;
let lastSaveNote = portable ? 'Bookmark the address to keep your journal.' : 'Progress saves on this device.';
try {
  const raw = portable ? new URLSearchParams(location.hash.slice(1)).get('journal') : localStorage.getItem(saveKey);
  if (raw !== null) {
    const restored = readSave(raw);
    if (restored) { state = restored; lastSaveNote = 'Field journal restored from this device.'; }
    else lastSaveNote = 'The saved journal could not be read. Starting a new expedition.';
  }
} catch { lastSaveNote = 'Browser storage is unavailable. You can still play this session.'; }
focus = { x: state.units[state.active].x, y: state.units[state.active].y };
const cells = [];
const siteAt = (x, y) => Object.entries(SITES).find(([, v]) => v.x === x && v.y === y)?.[0];
const near = site => {
  const u = state.units[state.active], s = SITES[site];
  return Math.abs(u.x - s.x) + Math.abs(u.y - s.y) <= 1;
};
const can = command => state.phase === 'playing' && act(state, command).ok;

function save() {
  try {
    const raw = JSON.stringify(state);
    if (portable) {
      history.replaceState(null, '', '#' + new URLSearchParams({ journal: raw }));
      lastSaveNote = 'Bookmark this address to keep your journal.';
    } else {
      localStorage.setItem(saveKey, raw); lastSaveNote = 'Journal saved on this device.';
    }
  }
  catch { lastSaveNote = 'Browser storage is unavailable. Keep this tab open to preserve your progress.'; }
}

function listText(element, texts) {
  const rows = texts.map(text => {
    const li = document.createElement('li'); li.textContent = text; return li;
  });
  element.replaceChildren(...rows);
}

function draw() {
  const playing = state.phase === 'playing';
  const moves = playing ? legalMoves(state) : [];
  const incoming = playing ? forecast(state) : [];
  const lookup = points => new Set(points.map(p => `${p.x},${p.y}`));
  const destinations = lookup(moves), danger = lookup(incoming), wards = new Set(state.ward);
  $('round').textContent = `${state.round} / ${MAX_ROUND}`;
  $('marks').textContent = `${state.clues.length} / 3`;
  $('board').dataset.phase = state.phase;
  $('board').dataset.active = state.active;
  for (const id of Object.keys(names)) {
    const u = state.units[id];
    $('unit-' + id).setAttribute('aria-pressed', String(state.active === id));
    $('unit-' + id).disabled = !playing || u.hp <= 0;
    $('stats-' + id).textContent = `${coord(u.x, u.y)} · ${u.hp} HP · ${u.ap} AP`;
  }
  for (const { x, y, node, symbol, badge } of cells) {
    const key = `${x},${y}`, ally = Object.keys(names).find(k => state.units[k].x === x && state.units[k].y === y);
    const site = siteAt(x, y), dest = destinations.has(key), surge = danger.has(key), warded = wards.has(key);
    node.className = `cell${dest ? ' move' : ''}${surge ? ' danger' : ''}${ally === state.active ? ' selected' : ''}`;
    node.tabIndex = focus.x === x && focus.y === y ? 0 : -1;
    symbol.textContent = ally ? (ally === 'iria' ? 'I' : 'V') : (icons[site] || (dest ? '·' : ''));
    badge.textContent = `${warded ? '◇' : ''}${surge ? '≈' : ''}`;
    const label = [coord(x, y), ally && names[ally], site && SITES[site].name,
      site && state.clues.includes(site) && 'already read', dest && 'can move here', surge && 'incoming surge', warded && 'warded']
      .filter(Boolean).join(', ');
    node.title = label; node.setAttribute('aria-label', label);
  }
  for (const key of marks) {
    const btn = $('inspect-' + key), done = state.clues.includes(key);
    btn.disabled = !can({ type: 'inspect', site: key });
    btn.querySelector('small').textContent = `${done ? '✓ ' : ''}${coord(SITES[key].x, SITES[key].y)}`;
    btn.title = done ? SITES[key].clue : `Read from ${coord(SITES[key].x, SITES[key].y)} or a directly adjacent tile (1 AP).`;
  }
  $('signal').disabled = !can({ type: 'signal' });
  $('ward').disabled = !can({ type: 'ward' });
  $('end').disabled = !playing;
  $('end').textContent = playing ? `End round ${state.round}` : 'Chapter complete';
  $('save-status').textContent = lastSaveNote;
  listText($('discoveries'), state.clues.length ? state.clues.map(k => `${SITES[k].name}: ${SITES[k].clue}`) : ['No marks read yet.']);
  listText($('log'), state.log.slice(-8));
  $('ending').hidden = playing;
  if (!playing) {
    const won = state.phase === 'won';
    $('result-label').textContent = won ? 'SECRET FOUND' : 'EXPEDITION ENDED';
    $('result-title').textContent = won ? 'Tide Almanac recovered' : 'The tide has returned';
    $('result-detail').textContent = won
      ? `“There. The light was the key.” Iria opens the Tide Lock in round ${state.round}.`
      : 'The shrine slips beneath the water. Try splitting the survey between your two allies, then bring Iria to A3.';
  }
  stage?.update(state, { moves, focus });
}

function dispatch(command) {
  const before = state.phase, result = act(state, command);
  $('feedback').textContent = result.message;
  if (!result.ok) return;
  state = result.state;
  if (command.type === 'select' || command.type === 'move')
    focus = { x: state.units[state.active].x, y: state.units[state.active].y };
  save(); draw();
  if (before === 'playing' && state.phase !== 'playing') $('result-title').focus();
}

function choose(x, y) {
  if (state.phase !== 'playing') return;
  focus = { x, y };
  const ally = Object.keys(names).find(id => state.units[id].x === x && state.units[id].y === y && state.units[id].hp > 0);
  if (ally) { dispatch({ type: 'select', unit: ally }); return; }
  // The dedicated order buttons remain available if the selected unit is standing on a mark.
  const site = siteAt(x, y);
  if (site === 'lock' && can({ type: 'signal' })) { dispatch({ type: 'signal' }); return; }
  if (marks.includes(site) && can({ type: 'inspect', site })) { dispatch({ type: 'inspect', site }); return; }
  if (site === 'lock') {
    $('feedback').textContent = 'Tide Lock · A3. Read all three marks, then use Iria’s lantern from an adjacent square.';
    draw(); return;
  }
  if (!legalMoves(state).some(p => p.x === x && p.y === y) && site && !near(site)) {
    $('feedback').textContent = `${SITES[site].name} at ${coord(x, y)}. Move closer: either ally can read it from one square away.`;
    draw(); return;
  }
  dispatch({ type: 'move', x, y });
}

for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const node = document.createElement('button'); node.type = 'button'; node.id = 'cell-' + coord(x, y);
  const tag = document.createElement('span'), symbol = document.createElement('span'), badge = document.createElement('span');
  tag.className = 'coord'; tag.textContent = coord(x, y); symbol.className = 'mark'; badge.className = 'badge';
  node.append(tag, symbol, badge);
  node.addEventListener('click', () => choose(x, y));
  node.addEventListener('focus', () => { focus = { x, y }; });
  node.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const nx = Math.max(0, Math.min(COLS - 1, x + delta[0])), ny = Math.max(0, Math.min(ROWS - 1, y + delta[1]));
    focus = { x: nx, y: ny }; draw(); $('cell-' + coord(nx, ny)).focus();
  });
  $('board').appendChild(node); cells.push({ x, y, node, symbol, badge });
}
for (const id of Object.keys(names)) $('unit-' + id).addEventListener('click', () => dispatch({ type: 'select', unit: id }));
for (const site of marks) $('inspect-' + site).addEventListener('click', () => dispatch({ type: 'inspect', site }));
for (const type of ['end','signal','ward']) $(type).addEventListener('click', () => dispatch({ type }));
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault(); $('cell-' + coord(focus.x, focus.y)).focus();
});
document.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat || $('restart-dialog').open || state.phase !== 'playing') return;
  if (e.key === '1' || e.key === '2') {
    e.preventDefault(); dispatch({ type: 'select', unit: e.key === '1' ? 'iria' : 'drake' });
  }
});
function restart() {
  state = newGame(); focus = { x: state.units.iria.x, y: state.units.iria.y };
  save(); draw(); $('feedback').textContent = 'A new expedition begins. Split up to read the three survey marks.';
  $('unit-iria').focus();
}
$('replay').addEventListener('click', restart);
$('restart').addEventListener('click', () => { $('restart-dialog').showModal(); $('keep').focus(); });
$('keep').addEventListener('click', () => $('restart-dialog').close());
$('reset').addEventListener('click', () => { $('restart-dialog').close(); restart(); });

async function set3D(open) {
  opened = open;
  const ticket = ++loadId;
  $('scene-box').hidden = !open;
  $('view-toggle').setAttribute('aria-expanded', String(open));
  $('view-toggle').textContent = open ? 'Map only' : 'Show 3D court';
  if (!open) { stage?.dispose(); stage = null; return; }
  $('poster').hidden = false; $('visual-status').textContent = 'Loading the court · the map is ready';
  try {
    const { createStage } = await import('./stage.js');
    if (ticket !== loadId) return;
    // Allocate a host per request so toggling during a model download cannot remove the new canvas.
    const host = document.createElement('div'); host.style.cssText = 'width:100%;height:100%;';
    $('stage').replaceChildren(host);
    const loaded = await createStage(host, { onCell: choose, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    if (ticket !== loadId) { loaded.dispose(); return; }
    stage = loaded; $('poster').hidden = true;
    $('visual-status').textContent = 'Live 3D · tap an ally or tile';
    draw();
  } catch (err) {
    if (ticket !== loadId) return;
    $('stage').replaceChildren(); $('poster').hidden = false;
    $('visual-status').textContent = '3D unavailable · play on the tactical map below';
    console.warn('Tideglass 3D view unavailable:', err instanceof Error ? err.message : String(err));
  }
}
$('view-toggle').addEventListener('click', () => set3D(!opened));
window.addEventListener('pagehide', e => { if (!e.persisted) { ++loadId; stage?.dispose(); stage = null; } });
draw();
if (state.phase !== 'playing') $('feedback').textContent = 'This expedition has ended. Choose Play again to start a fresh journal.';
if (portable) $('view-toggle').hidden = true;
if (!mapOnly && !navigator.connection?.saveData) void set3D(true);
