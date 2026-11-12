// Stand-in for Tizen's `webapis.avplay`, used by tests and when running in a desktop browser.
// Mirrors the real call surface and its state machine (NONE -> IDLE -> READY -> PLAYING/PAUSED);
// like the device, calls made in the wrong state throw. Every call is recorded in `calls`.
//
// Test controls: failWhen(url) makes prepareAsync fail, tick(ms), complete(), emitError(type),
// buffering(on), subtitle(text, durationMs), setTracks([...]).
//
// Demo mode (createAvplayShim({ demo: true }), used by tools/shots): a coloured stand-in "video
// plane" is drawn behind the page at the display rect while playing, the clock ticks in real
// time (oncurrentplaytime every 500 ms), the stream has fake audio and subtitle tracks, and the
// selected subtitle track sends a line every few seconds through onsubtitlechange.

const THROW = (name, state) => {
  const e = new Error(`InvalidStateError: ${name}() in state ${state}`);
  e.name = 'InvalidStateError';
  return e;
};

/** Tracks as getTotalTrackInfo() reports them: extra_info is a JSON string on the device. */
export const DEMO_TRACKS = [
  { index: 0, type: 'VIDEO', extra_info: JSON.stringify({ fourCC: 'H264', Width: '1920', Height: '1080', Bit_rate: '6000000' }) },
  { index: 1, type: 'AUDIO', extra_info: JSON.stringify({ language: 'eng', fourCC: 'EAC3', channels: '6', sample_rate: '48000', bit_rate: '640000' }) },
  { index: 2, type: 'AUDIO', extra_info: JSON.stringify({ language: 'fra', fourCC: 'AACL', channels: '2', sample_rate: '48000', bit_rate: '128000' }) },
  { index: 3, type: 'TEXT', extra_info: JSON.stringify({ track_num: '0', track_lang: 'eng', subtitle_type: '0', fourCC: 'TTML' }) },
  { index: 4, type: 'TEXT', extra_info: JSON.stringify({ track_num: '1', track_lang: 'spa', subtitle_type: '0', fourCC: 'TTML' }) },
];
const DEMO_LINES = {
  eng: ['Where were you last night?', "I told you — I was at the harbour.\nAsk anyone.", 'Then why is your coat still wet?'],
  spa: ['¿Dónde estabas anoche?', 'Te lo dije: en el puerto.', '¿Y por qué tu abrigo sigue mojado?'],
};

export function createAvplayShim(opts = {}) {
  let state = 'NONE';
  let url = null;
  let listener = {};
  let time = 0;
  let tracks = [];
  let selected = { AUDIO: null, TEXT: null };
  let silent = false;
  let rect = [0, 0, 1920, 1080];
  let clock = null; let lastWall = 0; let subTimer = null; let lineNo = 0;
  const demo = !!opts.demo;

  // ---- demo: the stand-in video plane and the real-time clock
  function plane() {
    if (!demo || typeof document === 'undefined') return null;
    let p = document.getElementById('shim-plane');
    if (!p) {
      p = document.createElement('div');
      p.id = 'shim-plane';
      p.style.cssText = 'position:fixed;z-index:-1;display:none;'
        + 'font:600 30px sans-serif;color:rgba(255,255,255,.35);align-items:flex-start;justify-content:flex-start;padding:40px;';
      p.appendChild(document.createTextNode('VIDEO (shim)'));
      document.documentElement.appendChild(p);
      const st = document.createElement('style');
      st.textContent = 'object#av { opacity: 0 !important; }'; // a desktop browser draws a plugin box
      document.head.appendChild(st);
    }
    return p;
  }
  function paintPlane() {
    const p = plane();
    if (!p) return;
    const [x, y, w, h] = rect;
    Object.assign(p.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    // Like the TV: the plane is black until a picture plays, and gone once the player is closed.
    const picture = state === 'PLAYING' || state === 'PAUSED';
    p.style.display = state === 'NONE' ? 'none' : 'flex';
    p.style.backgroundColor = '#000';
    p.style.backgroundImage = picture ? 'radial-gradient(ellipse at 30% 35%,#5b7fa6 0%,#2d4a6b 35%,#16263a 70%,#0b121c 100%)' : 'none';
    p.firstChild && (p.firstChild.textContent = picture ? 'VIDEO (shim)' : '');
  }
  function startClock() {
    if (!demo || clock || shim.frozen) return;
    lastWall = Date.now();
    clock = setInterval(() => {
      if (state !== 'PLAYING' || shim.frozen) return;
      const now = Date.now();
      time += now - lastWall;
      lastWall = now;
      if (shim.duration > 0 && time >= shim.duration) { time = shim.duration; stopClock(); shim.complete(); return; }
      if (listener.oncurrentplaytime) listener.oncurrentplaytime(time);
    }, 500);
    subTimer = setInterval(() => {
      if (state !== 'PLAYING' || silent || selected.TEXT == null) return;
      const t = tracks.find((x) => x.index === selected.TEXT);
      const lang = t ? JSON.parse(t.extra_info).track_lang : 'eng';
      const lines = DEMO_LINES[lang] || DEMO_LINES.eng;
      shim.subtitle(lines[lineNo++ % lines.length], 3000);
    }, 4000);
  }
  function stopClock() { clearInterval(clock); clearInterval(subTimer); clock = null; subTimer = null; }

  const shim = {
    calls: [],
    props: {},
    duration: 0,
    failWhen: null,
    frozen: false,
    displayMethod: null,
    log(name, ...args) { shim.calls.push({ name, args }); },
    names() { return shim.calls.map((c) => c.name); },
    reset() {
      stopClock();
      state = 'NONE'; url = null; listener = {}; time = 0; tracks = []; selected = { AUDIO: null, TEXT: null }; silent = false;
      shim.calls = []; shim.props = {}; shim.duration = 0; shim.failWhen = null; shim.frozen = false; shim.displayMethod = null;
    },

    // ---- real API surface
    open(u) {
      shim.log('open', u);
      if (state !== 'NONE') throw THROW('open', state);
      url = u; state = 'IDLE';
      if (demo) { shim.duration = /\/live\//.test(u) ? 0 : /\/series\//.test(u) ? 45 * 60000 : 112 * 60000; tracks = DEMO_TRACKS.slice(); }
    },
    close() { shim.log('close'); stopClock(); state = 'NONE'; url = null; paintPlane(); },
    setDisplayRect(x, y, w, h) { shim.log('setDisplayRect', x, y, w, h); rect = [x, y, w, h]; paintPlane(); },
    setDisplayMethod(m) { shim.log('setDisplayMethod', m); shim.displayMethod = m; },
    setListener(l) { shim.log('setListener'); listener = l || {}; },
    setStreamingProperty(name, value) {
      shim.log('setStreamingProperty', name, value);
      if (state !== 'IDLE') throw THROW('setStreamingProperty', state);
      shim.props[name] = value;
    },
    prepareAsync(onSuccess, onError) {
      shim.log('prepareAsync');
      if (state !== 'IDLE') throw THROW('prepareAsync', state);
      const fail = shim.failWhen && shim.failWhen(url);
      const done = () => {
        if (state !== 'IDLE') return; // closed meanwhile
        if (fail) { onError && onError({ name: 'PLAYER_ERROR_CONNECTION_FAILED', message: 'PLAYER_ERROR_CONNECTION_FAILED' }); return; }
        state = 'READY';
        const a = tracks.find((t) => t.type === 'AUDIO');
        const s = tracks.find((t) => t.type === 'TEXT');
        selected = { AUDIO: a ? a.index : null, TEXT: s ? s.index : null };
        onSuccess && onSuccess();
      };
      if (demo) setTimeout(done, 300); else done();
    },
    getDuration() { return shim.duration; },
    getCurrentTime() { return time; },
    getState() { return state; },
    play() {
      shim.log('play');
      if (state !== 'READY' && state !== 'PAUSED') throw THROW('play', state);
      state = 'PLAYING'; paintPlane(); startClock();
      if (demo) lastWall = Date.now();
    },
    pause() {
      shim.log('pause');
      if (state !== 'PLAYING') throw THROW('pause', state);
      state = 'PAUSED';
    },
    stop() {
      shim.log('stop');
      if (state === 'NONE') throw THROW('stop', state);
      stopClock();
      state = 'IDLE'; time = 0; paintPlane();
    },
    seekTo(ms, onSuccess) {
      shim.log('seekTo', ms);
      if (state === 'NONE' || state === 'IDLE') throw THROW('seekTo', state);
      time = ms;
      onSuccess && onSuccess();
    },
    setSpeed(r) { shim.log('setSpeed', r); },
    getTotalTrackInfo() {
      if (state === 'NONE' || state === 'IDLE') throw THROW('getTotalTrackInfo', state);
      return tracks.map((t) => ({ ...t }));
    },
    getCurrentStreamInfo() {
      if (state === 'NONE' || state === 'IDLE') throw THROW('getCurrentStreamInfo', state);
      return tracks.filter((t) => t.type === 'VIDEO' || selected[t.type] === t.index).map((t) => ({ ...t }));
    },
    setSelectTrack(type, index) {
      shim.log('setSelectTrack', type, index);
      if (state !== 'READY' && state !== 'PLAYING' && state !== 'PAUSED') throw THROW('setSelectTrack', state);
      if (!tracks.some((t) => t.type === type && t.index === index)) throw new Error(`No ${type} track ${index}`);
      selected[type] = index;
    },
    setSilentSubtitle(on) { shim.log('setSilentSubtitle', !!on); silent = !!on; },

    // ---- test/dev controls (simulate the device firing listener callbacks)
    tick(ms) { time = ms; listener.oncurrentplaytime && listener.oncurrentplaytime(ms); },
    complete() { listener.onstreamcompleted && listener.onstreamcompleted(); },
    emitError(type = 'PLAYER_ERROR_UNKNOWN') { listener.onerror && listener.onerror(type); },
    buffering(on) {
      if (on) { listener.onbufferingstart && listener.onbufferingstart(); } else if (listener.onbufferingcomplete) listener.onbufferingcomplete();
    },
    /** A subtitle line from the selected track, as the device sends it (not while silenced). */
    subtitle(text, duration = 2000) {
      if (silent) return;
      listener.onsubtitlechange && listener.onsubtitlechange(duration, text, 0, '');
    },
    setTracks(list) { tracks = list.map((t) => ({ ...t })); },
    isSilent: () => silent,
    selectedTrack: (type) => selected[type],
    /** Demo: hold the picture still (for the freeze watchdog). */
    freeze(on = true) { shim.frozen = !!on; if (on) stopClock(); else if (state === 'PLAYING') startClock(); },
  };
  return shim;
}

export const shim = createAvplayShim();
