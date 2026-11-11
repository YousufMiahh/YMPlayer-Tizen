// Stand-in for Tizen's `webapis.avplay`, used by tests and when running in a desktop browser.
// Mirrors the real call surface and its state machine (NONE -> IDLE -> READY -> PLAYING/PAUSED);
// like the device, calls made in the wrong state throw. Every call is recorded in `calls`.
// Test controls: failWhen(url) makes prepareAsync fail, tick(ms), complete(), emitError(type).

const THROW = (name, state) => {
  const e = new Error(`InvalidStateError: ${name}() in state ${state}`);
  e.name = 'InvalidStateError';
  return e;
};

export function createAvplayShim() {
  let state = 'NONE';
  let url = null;
  let listener = {};
  let time = 0;

  const shim = {
    calls: [],
    props: {},
    duration: 0,
    failWhen: null,
    log(name, ...args) { shim.calls.push({ name, args }); },
    names() { return shim.calls.map((c) => c.name); },
    reset() {
      state = 'NONE'; url = null; listener = {}; time = 0;
      shim.calls = []; shim.props = {}; shim.duration = 0; shim.failWhen = null;
    },

    // ---- real API surface
    open(u) {
      shim.log('open', u);
      if (state !== 'NONE') throw THROW('open', state);
      url = u; state = 'IDLE';
    },
    close() { shim.log('close'); state = 'NONE'; url = null; },
    setDisplayRect(x, y, w, h) { shim.log('setDisplayRect', x, y, w, h); },
    setListener(l) { shim.log('setListener'); listener = l || {}; },
    setStreamingProperty(name, value) {
      shim.log('setStreamingProperty', name, value);
      if (state !== 'IDLE') throw THROW('setStreamingProperty', state);
      shim.props[name] = value;
    },
    prepareAsync(onSuccess, onError) {
      shim.log('prepareAsync');
      if (state !== 'IDLE') throw THROW('prepareAsync', state);
      if (shim.failWhen && shim.failWhen(url)) { onError && onError({ name: 'PlayerError', message: 'PLAYER_ERROR_CONNECTION_FAILED' }); return; }
      state = 'READY';
      onSuccess && onSuccess();
    },
    getDuration() { return shim.duration; },
    getCurrentTime() { return time; },
    getState() { return state; },
    play() {
      shim.log('play');
      if (state !== 'READY' && state !== 'PAUSED') throw THROW('play', state);
      state = 'PLAYING';
    },
    pause() {
      shim.log('pause');
      if (state !== 'PLAYING') throw THROW('pause', state);
      state = 'PAUSED';
    },
    stop() {
      shim.log('stop');
      if (state === 'NONE') throw THROW('stop', state);
      state = 'IDLE'; time = 0;
    },
    seekTo(ms, onSuccess) {
      shim.log('seekTo', ms);
      if (state === 'NONE' || state === 'IDLE') throw THROW('seekTo', state);
      time = ms;
      onSuccess && onSuccess();
    },
    setSpeed(r) { shim.log('setSpeed', r); },

    // ---- test/dev controls (simulate the device firing listener callbacks)
    tick(ms) { time = ms; listener.oncurrentplaytime && listener.oncurrentplaytime(ms); },
    complete() { listener.onstreamcompleted && listener.onstreamcompleted(); },
    emitError(type = 'PLAYER_ERROR_UNKNOWN') { listener.onerror && listener.onerror(type); },
  };
  return shim;
}

export const shim = createAvplayShim();
