/** Wires the pure simulation to the page: the clock, the screens, the input, the sound and the drawing. */
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './style.css';
import { Conductor } from './audio/conductor.ts';
import { Synth } from './audio/synth.ts';
import { PlannerBot, ReflexBot, type Pilot } from './bot/pilots.ts';
import { WAY_OUT_TICKS, findWayOut, type WayOut } from './bot/wayout.ts';
import { renderPoster } from './render/poster.ts';
import { Fx } from './render/fx.ts';
import { Renderer } from './render/renderer.ts';
import { DISPLAY_FONT, MONO_FONT } from './render/ink.ts';
import { TPS, quotaFor } from './sim/constants.ts';
import { createGame, step, type Game, type GameEvent } from './sim/game.ts';
import { Recording, decodeReplay, runSeconds, simulateReplay, type Replay } from './sim/replay.ts';
import { Controls } from './ui/controls.ts';
import { load, save } from './ui/storage.ts';

type Mode = 'attract' | 'play' | 'replay';

const TICK_SECONDS = 1 / TPS;
const PANEL_RESERVE = 138;
const BAR_RESERVE = 46;
const HINT_RUNS = 2;

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
};

const stage = element('stage');
const canvas = element<HTMLCanvasElement>('game');
const hint = element('hint');
const titleScreen = element('title');
const titleMeta = element('title-meta');
const pauseScreen = element('pause');
const overPanel = element('over');
const overHeadline = overPanel.querySelector('.headline') as HTMLElement;
const overStats = overPanel.querySelector('.stats') as HTMLElement;
const overVerdict = overPanel.querySelector('.verdict') as HTMLElement;
const copyLinkButton = element<HTMLButtonElement>('copy-link');
const playButton = element<HTMLButtonElement>('play');
const againButton = element<HTMLButtonElement>('again');
const replayBar = element('replay-bar');
const toast = element('toast');

const params = new URLSearchParams(location.search);

const renderer = new Renderer(canvas);
const fx = new Fx(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const controls = new Controls(stage, renderer);
const saved = load();

let mode: Mode = 'attract';
let g: Game = createGame(newSeed());
let prevX = g.x;
let prevY = g.y;
let pilot: Pilot | null = new PlannerBot();
let recording: Recording | null = null;
let replay: Replay | null = null;
let replayCursor = 0;
let speed = 1;
let paused = false;
let accumulator = 0;
let lastFrame = performance.now();
let time = 0;
let overAt = 0;
let wayOut: WayOut | null = null;
let replayCode: string | null = null;
let attractRestart = 0;

let audio: AudioContext | null = null;
let synth: Synth | null = null;
let conductor: Conductor | null = null;

function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) | 0;
}

// ----- Sound -------------------------------------------------------------------------------------------

/** Browsers only allow sound after a click or a key press, so this runs from those handlers. */
function unlockAudio(): void {
  if (!audio) {
    const AudioClass = window.AudioContext;
    if (!AudioClass) return;
    audio = new AudioClass();
    synth = new Synth(audio);
    synth.master.gain.value = saved.muted ? 0 : 0.75;
    conductor = new Conductor(synth);
  }
  void audio.resume();
}

function toggleMute(): void {
  saved.muted = !saved.muted;
  save(saved);
  if (synth) synth.master.gain.value = saved.muted ? 0 : 0.75;
  showToast(saved.muted ? 'Sound off' : 'Sound on');
}

// ----- Screens -----------------------------------------------------------------------------------------

function layout(): void {
  const showingOver = g.phase === 'over' && mode !== 'attract';
  let reserveBottom = 0;
  if (showingOver) reserveBottom = overPanel.offsetHeight || PANEL_RESERVE;
  else if (mode === 'replay') reserveBottom = BAR_RESERVE;
  // Hints get their own band below the arena, so one can never sit on top of the diamond it talks about.
  else if (shouldHint()) reserveBottom = BAR_RESERVE;
  renderer.fit({ hud: mode !== 'attract', reserveBottom });
}

function resetStage(next: Game): void {
  g = next;
  prevX = g.x;
  prevY = g.y;
  accumulator = 0;
  wayOut = null;
  overAt = 0;
  fx.clear();
  renderer.clearExposure();
  stage.classList.remove('negative');
}

function startAttract(): void {
  mode = 'attract';
  pilot = new PlannerBot();
  recording = null;
  replay = null;
  speed = 1;
  paused = false;
  conductor?.stop();
  controls.enabled = false;
  overPanel.hidden = true;
  pauseScreen.hidden = true;
  replayBar.hidden = true;
  titleScreen.hidden = false;
  hideHint();
  resetStage(createGame(newSeed()));
  layout();
  updateTitleMeta();
}

function startRun(): void {
  unlockAudio();
  mode = 'play';
  // The pilot parameter lets the screenshot script and the tests play a real run without a person.
  const requested = params.get('bot');
  pilot = requested === 'planner' ? new PlannerBot() : requested === 'reflex' ? new ReflexBot() : null;
  const seed = newSeed();
  recording = new Recording(seed);
  replay = null;
  speed = Number(params.get('speed')) || 1;
  paused = false;
  controls.reset();
  controls.enabled = pilot === null;
  overPanel.hidden = true;
  pauseScreen.hidden = true;
  replayBar.hidden = true;
  titleScreen.hidden = true;
  hideHint();
  resetStage(createGame(seed));
  layout();
  conductor?.begin();
  stage.focus();
  if (shouldHint()) {
    const touch = window.matchMedia('(hover: none)').matches;
    showHint(touch ? 'Drag anywhere to move. Take the diamond.' : 'Move with WASD, the arrow keys or the mouse. Take the diamond.', 3600);
  }
}

function startReplay(next: Replay): void {
  unlockAudio();
  mode = 'replay';
  pilot = null;
  recording = null;
  replay = next;
  replayCursor = 0;
  speed = 1;
  paused = false;
  controls.enabled = false;
  overPanel.hidden = true;
  pauseScreen.hidden = true;
  replayBar.hidden = false;
  titleScreen.hidden = true;
  hideHint();
  setSpeedChip();
  resetStage(createGame(next.seed));
  layout();
  conductor?.begin();
}

function setSpeedChip(): void {
  replayBar.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === speed);
  });
}

function setPaused(next: boolean): void {
  if (mode === 'attract' || g.phase === 'over' || paused === next) return;
  paused = next;
  pauseScreen.hidden = !next;
  controls.reset();
  if (next) void audio?.suspend();
  else void audio?.resume();
  if (next) element('resume').focus({ preventScroll: true });
}

function updateTitleMeta(): void {
  const code = location.hash.startsWith('#r=') ? location.hash.slice(3) : null;
  const shared = code ? decodeReplay(code) : null;
  if (shared) {
    const result = simulateReplay(shared);
    titleMeta.textContent = '';
    const button = document.createElement('button');
    button.className = 'chip';
    button.setAttribute('data-testid', 'watch-shared');
    button.textContent = `Watch the shared run: ${result.loop} loops, ${result.score.toLocaleString('en-US')} points`;
    button.addEventListener('click', () => startReplay(shared));
    titleMeta.append(button);
    return;
  }
  if (code) {
    titleMeta.textContent = 'That replay link is from another version of the game, or is damaged.';
    return;
  }
  titleMeta.textContent = saved.bestLoops > 0 ? `Best: ${saved.bestLoops} loops, ${saved.bestScore.toLocaleString('en-US')} points` : '';
}

function showOver(): void {
  const duration = runSeconds(g);
  const minutes = Math.floor(duration / 60);
  const seconds = String(duration % 60).padStart(2, '0');

  let newBest = false;
  if (mode === 'play' && pilot === null) {
    saved.runs++;
    newBest = g.loop > saved.bestLoops || (g.loop === saved.bestLoops && g.score > saved.bestScore);
    if (newBest) {
      saved.bestLoops = g.loop;
      saved.bestScore = g.score;
    }
    save(saved);
  }

  overHeadline.textContent = `${g.loop} ${g.loop === 1 ? 'loop' : 'loops'}${newBest ? ', a new best' : ''}`;
  overStats.textContent =
    `${g.score.toLocaleString('en-US')} points in ${minutes}:${seconds}. ` +
    `${g.totalShards} shards taken, ${g.kills} echoes erased, ${g.echoes.filter((echo) => echo.alive).length} still running.`;

  wayOut = findWayOut(g);
  overVerdict.textContent = verdict(g, wayOut);

  replayCode = recording ? recording.encode() : location.hash.startsWith('#r=') ? location.hash.slice(3) : null;
  copyLinkButton.hidden = replayCode === null;
  againButton.firstChild!.textContent = mode === 'replay' ? 'Play ' : 'Again ';
  replayBar.hidden = true;
  overPanel.hidden = false;
  hideHint();
  layout();
}

function verdict(run: Game, way: WayOut | null): string {
  if (run.cause === 'quota') return `Out of lives: that loop wanted ${quotaFor(run.loop)} diamonds.`;
  const when = run.t >= WAY_OUT_TICKS ? '1.5 seconds earlier' : 'the start of the loop';
  if (!way) return `The solver found no way out from ${when}. You had boxed yourself in before that.`;
  if (way.standsStill) return `From ${when}, standing still would have survived.`;
  if (way.reachesShard) return `The dotted line was open from ${when}: a clean route to the next diamond.`;
  return `The dotted line was open from ${when}: it survives the rest of the loop.`;
}

// ----- Hints -------------------------------------------------------------------------------------------

let hintTimer = 0;
const hintsShown = new Set<string>();

function shouldHint(): boolean {
  return mode === 'play' && pilot === null && saved.runs < HINT_RUNS;
}

function showHint(text: string, ms: number): void {
  hint.textContent = text;
  hint.classList.add('visible');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(hideHint, ms);
}

function hideHint(): void {
  hint.classList.remove('visible');
}

function once(key: string, text: string, ms: number): void {
  if (hintsShown.has(key)) return;
  hintsShown.add(key);
  showHint(text, ms);
}

function hintFor(event: GameEvent): void {
  if (!shouldHint()) return;
  const touch = window.matchMedia('(hover: none)').matches;
  if (event.type === 'loopStart' && event.loop === 2) once('echo', "That's you, 8 seconds ago. Don't touch it.", 3800);
  if (event.type === 'loopStart' && event.loop === 3) once('quota', 'Now each loop wants two diamonds. Miss the quota and you lose a life.', 3800);
  if (event.type === 'loopStart' && event.loop === 4) once('music', 'Listen: your echoes play back every note you collected.', 3800);
  if (event.type === 'graze') once('graze', 'Brushing past an echo charges your dash.', 2800);
  if (event.type === 'charge' || (event.type === 'loopStart' && event.loop === 5)) {
    once('dash', `${touch ? 'Tap' : 'Space or click'} to dash. Go through an echo to erase it, and its notes.`, 4200);
  }
  if (event.type === 'hit' && g.phase === 'hitRewind') once('hit', 'Time goes back two seconds, at the cost of a life.', 3200);
}

// ----- The clock ---------------------------------------------------------------------------------------

function tick(): void {
  prevX = g.x;
  prevY = g.y;

  let input = 0;
  if (mode === 'replay') input = replay && replayCursor < replay.inputs.length ? replay.inputs[replayCursor++] : 0;
  else if (pilot) input = pilot.next(g);
  else input = controls.read(g);
  recording?.push(input);

  step(g, input);

  // A suspended context doesn't advance its clock, so anything scheduled on it would pile up unheard.
  const audible = mode !== 'attract' && speed === 1 && audio?.state === 'running';
  for (const event of g.events) {
    fx.on(event);
    if (audible) conductor?.on(event, g);
    hintFor(event);
  }
  renderer.expose(g);
  if (audible) conductor?.tick(g);

  stage.classList.toggle('negative', g.phase === 'loopRewind' || g.phase === 'hitRewind');

  if (g.phase === 'over' && overAt === 0) {
    overAt = time;
    if (mode === 'attract') attractRestart = time + 3;
    else showOver();
  }
}

const isOver = (): boolean => g.phase === 'over';

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  time += dt;

  if (!paused && !isOver()) {
    accumulator += dt * speed;
    while (accumulator >= TICK_SECONDS && !isOver()) {
      tick();
      accumulator -= TICK_SECONDS;
    }
  }
  if (mode === 'attract' && isOver() && time >= attractRestart) startAttract();

  fx.update(dt);

  const develop = g.phase === 'over' && overAt > 0 ? Math.min(1, (time - overAt) / 1.4) : 0;
  renderer.draw({
    g,
    prevX,
    prevY,
    alpha: Math.min(1, accumulator / TICK_SECONDS),
    fx,
    hud: mode !== 'attract',
    time,
    develop,
    wayOut: develop > 0 ? wayOut : null,
    labelFirstEcho: g.loop === 2 && shouldHint(),
    replaySpeed: mode === 'replay' ? speed : null,
  });
}

function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 1500);
}

// ----- Buttons and keys --------------------------------------------------------------------------------

playButton.addEventListener('click', startRun);
againButton.addEventListener('click', () => {
  if (mode === 'replay') history.replaceState(null, '', location.pathname + location.search);
  startRun();
});
element('resume').addEventListener('click', () => setPaused(false));
element('quit').addEventListener('click', startAttract);
element('exit-replay').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname + location.search);
  startAttract();
});

replayBar.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
  button.addEventListener('click', () => {
    speed = Number(button.dataset.speed);
    setSpeedChip();
    if (speed !== 1) conductor?.stop();
    else if (g.phase !== 'over') conductor?.rejoin(g);
  });
});

element('save-print').addEventListener('click', () => {
  renderPoster(g, runSeconds(g)).toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `loopback-${g.loop}-loops.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }, 'image/png');
});

copyLinkButton.addEventListener('click', () => {
  if (!replayCode) return;
  const url = `${location.origin}${location.pathname}#r=${replayCode}`;
  navigator.clipboard
    .writeText(url)
    .then(() => showToast(`Replay copied, ${url.length.toLocaleString('en-US')} characters`))
    .catch(() => showToast('The browser would not allow copying'));
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyM') {
    toggleMute();
    return;
  }
  if (!titleScreen.hidden && (event.code === 'Enter' || event.code === 'Space')) {
    event.preventDefault();
    startRun();
    return;
  }
  if (!overPanel.hidden && (event.code === 'Enter' || event.code === 'KeyR')) {
    event.preventDefault();
    againButton.click();
    return;
  }
  if (mode === 'play' && event.code === 'KeyR') {
    startRun();
    return;
  }
  if (event.code === 'Escape' || event.code === 'KeyP') {
    setPaused(!paused);
    return;
  }
  if (paused && event.code === 'KeyQ') startAttract();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => setPaused(true));
window.addEventListener('resize', layout);
window.addEventListener('hashchange', updateTitleMeta);

// Stops the page from scrolling or zooming under a thumb, without blocking taps on the buttons.
stage.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });

// The canvas needs its fonts before the first number is drawn, but the game shouldn't wait long for them.
void Promise.allSettled([
  document.fonts.load(`800 30px ${DISPLAY_FONT}`),
  document.fonts.load(`500 13px ${MONO_FONT}`),
]);

// A handle for the browser tests and the screenshot script. It doesn't exist in the published build.
if (import.meta.env.DEV) {
  Object.assign(window, {
    loopback: {
      game: () => g,
      setSpeed: (next: number) => {
        speed = next;
      },
    },
  });
}

startAttract();
if (params.has('bot')) startRun();
requestAnimationFrame(frame);
