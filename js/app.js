// YM Player entry point. Screens are mounted into the root element.
export function boot(rootEl) {
  const title = document.createElement('h1');
  title.textContent = 'YM Player';
  rootEl.appendChild(title);
}
