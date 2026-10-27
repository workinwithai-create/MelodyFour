// MelodyFour — four-bar melodic phrase desk
// Samples pinned to PreEight commit d58301e4a494555f411a2afbc448b724136eee76
// Never @main or @gh-pages

const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const STEPS_PER_BAR = 16;
const TOTAL_BARS = 8;
const BED_BARS = 4;

const SAMPLE_MAP = {
  kick: `${CDN}/drums/kick.mp3`,
  snare: `${CDN}/drums/snare.mp3`,
  hat: `${CDN}/drums/hihat.mp3`,
  crash: `${CDN}/drums/crash.mp3`,
  pianoC3: `${CDN}/piano/C3.mp3`,
  pianoC4: `${CDN}/piano/C4.mp3`,
  pianoA3: `${CDN}/piano/A3.mp3`,
  bassE1: `${CDN}/bass/E1.mp3`,
  bassA1: `${CDN}/bass/A1.mp3`,
  bassC2: `${CDN}/bass/C2.mp3`,
  guitarE2: `${CDN}/guitar/E2.mp3`,
  guitarA2: `${CDN}/guitar/A2.mp3`,
  guitarE3: `${CDN}/guitar/E3.mp3`,
  trumpetC4: `${CDN}/trumpet/C4.mp3`,
  violinA3: `${CDN}/violin/A3.mp3`
};

const KEYS = {
  "A minor": { root: 57, scale: [0,2,3,5,7,8,10] },
  "C major": { root: 60, scale: [0,2,4,5,7,9,11] },
  "D minor": { root: 62, scale: [0,2,3,5,7,8,10] },
  "E major": { root: 64, scale: [0,2,4,5,7,9,11] },
  "G major": { root: 67, scale: [0,2,4,5,7,9,11] }
};

const recipes = [
  { id: "trumpet-call", name: "Trumpet call", blurb: "Trumpet states the phrase on 1 and 3, then answers on 5." },
  { id: "violin-hold", name: "Violin hold", blurb: "Violin sustains the 3rd then resolves down." },
  { id: "nylon-walk", name: "Nylon walk", blurb: "Nylon walks chord tones across the four bars." },
  { id: "piano-motif", name: "Piano motif", blurb: "Piano repeats a short motif that lands on the root." },
  { id: "brass-answer", name: "Brass answer", blurb: "Trumpet answers the bed with a rising figure." }
];

const grooves = [
  { id: "amber", name: "Amber Bed", bpm: 92, key: "A minor", chords: "Am F C G" },
  { id: "porch", name: "Porch Bed", bpm: 86, key: "E major", chords: "E B C#m A" },
  { id: "fold", name: "Fold Bed", bpm: 104, key: "D minor", chords: "Dm Bb F C" }
];

let state = {
  bpm: 92,
  key: "A minor",
  chords: "Am F C G",
  grooveId: "amber",
  recipeId: "trumpet-call",
  muted: {},
  playing: false,
  mode: null,
  step: 0
};

let ctx = null;
let masterGain = null;
let compressor = null;
let chairGains = {};
let buffers = {};
let rawBuffers = {};
let activeSources = [];
let nextStepTime = 0;
let timerId = null;
let playheadRaf = null;
let currentStep = 0;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("melodyfour") || "{}");
    Object.assign(state, s);
  } catch (e) {}
}
function saveState() {
  localStorage.setItem("melodyfour", JSON.stringify({
    bpm: state.bpm, key: state.key, chords: state.chords,
    grooveId: state.grooveId, recipeId: state.recipeId, muted: state.muted
  }));
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function rateFromMidi(midi, base) { return Math.pow(2, (midi - base) / 12); }

function parseChords(str) {
  return str.split(/\s+/).filter(Boolean).slice(0, 4);
}

function getChordNotes(symbol, keyRoot) {
  const map = {
    Am: [57, 60, 64], Fm: [53, 57, 60], F: [53, 57, 60],
    C: [48, 52, 55], G: [43, 47, 50],
    Dm: [50, 53, 57], Bb: [46, 50, 53],
    E: [40, 44, 47], B: [35, 39, 42], "C#m": [49, 52, 56], A: [45, 49, 52],
    Em: [40, 43, 47]
  };
  let notes = map[symbol] || [keyRoot, keyRoot + 3, keyRoot + 7];
  return notes.map(n => {
    while (n < 36) n += 12;
    while (n > 72) n -= 12;
    return n;
  });
}

async function loadSamples() {
  const status = document.getElementById("status");
  const keys = Object.keys(SAMPLE_MAP);
  let loaded = 0;
  const missing = [];
  for (const k of keys) {
    try {
      const r = await fetch(SAMPLE_MAP[k]);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab.slice(0);
      buffers[k] = await ctx.decodeAudioData(ab);
      loaded++;
      status.textContent = `Seating chairs ${loaded}/${keys.length}`;
    } catch (e) {
      missing.push(k);
      status.textContent = `Missing: ${missing.join(", ")}`;
    }
  }
  if (missing.length) {
    status.textContent = `Missing instruments: ${missing.join(", ")}. Cannot play.`;
    return false;
  }
  status.textContent = "Chairs seated · live FluidR3 + kit";
  return true;
}

function createContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);
  ["kick","snare","hat","crash","piano","bass","guitar","trumpet","violin"].forEach(ch => {
    chairGains[ch] = ctx.createGain();
    chairGains[ch].gain.value = 1;
    chairGains[ch].connect(masterGain);
  });
}

function playNote(name, when, midi, duration, chair, gain = 0.4) {
  const buf = buffers[name];
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bases = { pianoC3: 48, pianoC4: 60, pianoA3: 57, bassE1: 28, bassA1: 33, bassC2: 36, guitarE2: 40, guitarA2: 45, guitarE3: 52, trumpetC4: 60, violinA3: 57 };
  const base = bases[name] || 60;
  const shift = midi - base;
  if (Math.abs(shift) > 4) return;
  src.playbackRate.value = rateFromMidi(midi, base);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + Math.max(0.01, duration - 0.02));
  g.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(g);
  g.connect(chairGains[chair] || masterGain);
  src.start(when);
  src.stop(when + duration + 0.05);
  activeSources.push(src);
  src.onended = () => {
    const i = activeSources.indexOf(src);
    if (i >= 0) activeSources.splice(i, 1);
  };
}

function stopAll() {
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources = [];
}

function scheduleStep(step, time) {
  const bar = Math.floor(step / STEPS_PER_BAR) % TOTAL_BARS;
  const s = step % STEPS_PER_BAR;
  const isMelody = bar >= BED_BARS;
  const rec = recipes.find(r => r.id === state.recipeId) || recipes[0];
  const chords = parseChords(state.chords);
  const chordSym = chords[bar % chords.length] || "Am";
  const keyRoot = KEYS[state.key]?.root || 57;
  const notes = getChordNotes(chordSym, keyRoot);
  const root = notes[0];
  const third = notes[1] || root + 3;
  const fifth = notes[2] || root + 7;

  if (s % 2 === 0) playNote("hat", time, 60, 0.1, "hat", 0.08);
  if (s === 0) playNote("kick", time, 36, 0.2, "kick", 0.6);
  if (s === 8) playNote("snare", time, 38, 0.15, "snare", 0.4);

  if (s === 0) {
    playNote("pianoC4", time, notes[2] || 60, 0.8, "piano", 0.25);
    playNote("pianoA3", time, notes[1] || 57, 0.8, "piano", 0.2);
    playNote("bassA1", time, root - 24, 0.9, "bass", 0.45);
    playNote("guitarA2", time, notes[0], 0.7, "guitar", 0.2);
  }

  if (isMelody) {
    if (rec.id === "trumpet-call" && (s === 0 || s === 8)) {
      playNote("trumpetC4", time, third + 12, 0.4, "trumpet", 0.35);
    }
    if (rec.id === "violin-hold" && s === 0) {
      playNote("violinA3", time, third, 3.5, "violin", 0.3);
    }
    if (rec.id === "nylon-walk" && s % 4 === 0) {
      const walk = [root, third, fifth, root + 12];
      playNote("guitarE3", time, walk[(s / 4) % 4], 0.3, "guitar", 0.28);
    }
    if (rec.id === "piano-motif" && (s === 0 || s === 4 || s === 8 || s === 12)) {
      playNote("pianoC4", time, [root + 12, third + 12, fifth + 12, root + 12][s / 4], 0.25, "piano", 0.22);
    }
    if (rec.id === "brass-answer" && s === 12) {
      playNote("trumpetC4", time, fifth + 12, 0.35, "trumpet", 0.32);
    }
  }
}

function scheduler() {
  if (!state.playing) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(state.step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    state.step = (state.step + 1) % (TOTAL_BARS * STEPS_PER_BAR);
  }
}

function start(mode) {
  if (!ctx) createContext();
  if (ctx.state === "suspended") ctx.resume();
  stop();
  state.playing = true;
  state.mode = mode;
  state.step = mode === "eight" ? BED_BARS * STEPS_PER_BAR : 0;
  nextStepTime = ctx.currentTime + 0.1;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  updatePlayhead();
}

function stop() {
  state.playing = false;
  state.mode = null;
  if (timerId) clearInterval(timerId);
  timerId = null;
  stopAll();
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  paintBars();
}

function updatePlayhead() {
  if (!state.playing) return;
  paintBars();
  playheadRaf = requestAnimationFrame(updatePlayhead);
}

function paint() {
  const gEl = document.getElementById("grooves");
  gEl.innerHTML = "";
  grooves.forEach(g => {
    const b = document.createElement("button");
    b.className = "card" + (state.grooveId === g.id ? " on" : "");
    b.innerHTML = `<b>${g.name}</b><span>${g.bpm} BPM · ${g.key}</span>`;
    b.onclick = () => { state.grooveId = g.id; state.bpm = g.bpm; state.key = g.key; state.chords = g.chords; document.getElementById("bpm").value = g.bpm; document.getElementById("key").value = g.key; document.getElementById("chords").value = g.chords; saveState(); render(); };
    gEl.appendChild(b);
  });
  const rEl = document.getElementById("recipes");
  rEl.innerHTML = "";
  recipes.forEach(r => {
    const b = document.createElement("button");
    b.className = "card" + (state.recipeId === r.id ? " on" : "");
    b.innerHTML = `<b>${r.name}</b><span>${r.blurb}</span>`;
    b.onclick = () => { state.recipeId = r.id; saveState(); render(); };
    rEl.appendChild(b);
  });
  paintBars();
  document.getElementById("punch").textContent = punch();
}

function paintBars() {
  const el = document.getElementById("bars");
  el.innerHTML = "";
  const chords = parseChords(state.chords);
  for (let i = 0; i < TOTAL_BARS; i++) {
    const d = document.createElement("div");
    const isMel = i >= BED_BARS;
    d.className = "bar " + (isMel ? "melody" : "") + (state.playing && Math.floor(state.step / STEPS_PER_BAR) === i ? " active" : "");
    d.innerHTML = `<div class="n">${i + 1} · ${isMel ? "M" : "B"}</div><div class="c">${chords[i % chords.length] || "Am"}</div>`;
    el.appendChild(d);
  }
}

function punch() {
  const rec = recipes.find(r => r.id === state.recipeId) || recipes[0];
  return `MelodyFour punch list\n${state.key} · ${state.bpm} BPM · ${state.chords} · ${rec.name}\n\nThe problem: the bed loops without a line that finishes the section.\nThe move: ${rec.blurb}\n\nBed (bars 1-4)\n${parseChords(state.chords).map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n\nMelody (bars 5-8) — ${rec.name}\nLive chairs only. Drop the WAV on bars 5-8. Do not loop forever.\n\nDistinct from TagFour (end tag), LiftTwo (pre-hook), PreEight (pre-chorus), AfterHook, EndEight, LastHook, TensionFour.`;
}

async function exportAudio() {
  if (!ctx) return;
  const sr = 48000;
  const bars = TOTAL_BARS;
  const bpm = state.bpm;
  const length = Math.round(bars * 4 * 60 / bpm * sr);
  const offline = new OfflineAudioContext(2, length + sr * 2, sr);
  const offMaster = offline.createGain();
  offMaster.gain.value = 0.7;
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -6;
  offMaster.connect(offComp);
  offComp.connect(offline.destination);
  const rendered = await offline.startRendering();
  let peak = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1;
  const out = offline.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < length; i++) dst[i] = (src[i] || 0) * scale;
  }
  downloadWav(out, `melodyfour-recipe-${bpm}bpm-${state.key.replace(/\s/g, "")}.wav`);
  downloadMidi();
}

function downloadWav(buffer, filename) {
  const sr = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const bytes = 44 + len * numCh * 3;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 3, true);
  view.setUint16(32, numCh * 3, true);
  view.setUint16(34, 24, true);
  writeStr(36, "data");
  view.setUint32(40, len * numCh * 3, true);
  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      const v = Math.round(s * 8388607);
      view.setUint8(offset, v & 0xff);
      view.setUint8(offset + 1, (v >> 8) & 0xff);
      view.setUint8(offset + 2, (v >> 16) & 0xff);
      offset += 3;
    }
  }
  const blob = new Blob([ab], { type: "audio/wav" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadMidi() {
  const bpm = state.bpm;
  const tpq = 480;
  const usPerQ = Math.round(60000000 / bpm);
  const header = new Uint8Array([0x4d,0x54,0x68,0x64, 0,0,0,6, 0,1, 0,1, (tpq>>8)&0xff, tpq&0xff]);
  const track = [0x00, 0xff, 0x51, 0x03, (usPerQ>>16)&0xff, (usPerQ>>8)&0xff, usPerQ&0xff];
  track.push(0x00, 0xff, 0x2f, 0x00);
  const trackLen = track.length;
  const trackHeader = [0x4d,0x54,0x72,0x6b, (trackLen>>24)&0xff, (trackLen>>16)&0xff, (trackLen>>8)&0xff, trackLen&0xff];
  const midi = new Uint8Array([...header, ...trackHeader, ...track]);
  const blob = new Blob([midi], { type: "audio/midi" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `melodyfour-recipe-${bpm}bpm-${state.key.replace(/\s/g, "")}.mid`;
  a.click();
}

function render() {
  paint();
  document.getElementById("bpm").value = state.bpm;
  document.getElementById("key").value = state.key;
  document.getElementById("chords").value = state.chords;
}

function init() {
  loadState();
  document.getElementById("bpm").onchange = e => { state.bpm = Math.max(60, Math.min(180, +e.target.value || 92)); saveState(); };
  document.getElementById("key").onchange = e => { state.key = e.target.value; saveState(); render(); };
  document.getElementById("chords").onchange = e => { state.chords = e.target.value; saveState(); render(); };
  document.getElementById("playA").onclick = () => start("loop");
  document.getElementById("playB").onclick = () => start("full");
  document.getElementById("play8").onclick = () => start("eight");
  document.getElementById("stop").onclick = stop;
  document.getElementById("export").onclick = exportAudio;
  document.getElementById("copy").onclick = () => navigator.clipboard.writeText(punch());
  document.getElementById("tap").onclick = async () => {
    createContext();
    await ctx.resume();
    document.getElementById("tap").classList.remove("show");
    const ok = await loadSamples();
    if (!ok) return;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  if (!ctx) document.getElementById("tap").classList.add("show");
  render();
}

init();
