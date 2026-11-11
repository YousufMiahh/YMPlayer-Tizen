// View contract: a view is { mount(rootEl, params), unmount(), onKey?(e) }.
// onKey is optional; return true to consume the key (nav will not see it).
// unmount() must remove any listeners the view added outside rootEl; the
// router empties rootEl itself after unmount.
export function isView(v) {
  return !!v && typeof v.mount === 'function' && typeof v.unmount === 'function';
}
