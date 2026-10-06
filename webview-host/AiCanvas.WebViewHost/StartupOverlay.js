(() => {
  'use strict';
  if (location.origin !== 'https://appassets.local' || location.pathname !== '/index.html' || window.top !== window) return;
  const host = window.chrome?.webview;
  if (!host) return;
  // Replaced only with the trusted embedded AC bitmap and elapsed animation time.
  const logo = __LOGO_JSON__;
  const phaseMs = __PHASE_MS__;
  let overlay;
  let disposed = false;
  let revealed = false;
  let animation;
  let restorePage = () => {};
  const onMessage = event => {
    if (event.data?.type !== 'canvas-startup-reveal' || !overlay || revealed || disposed) return;
    revealed = true;
    animation = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    animation.finished.then(() => {
      if (disposed) return;
      dispose();
      host.postMessage({ type: 'canvas-startup-finished' });
    }).catch(() => {});
  };
  const dispose = () => {
    disposed = true;
    restorePage();
    observer.disconnect();
    host.removeEventListener('message', onMessage);
    overlay?.remove();
    window.removeEventListener('pagehide', dispose);
  };
  const attach = () => {
    if (overlay || disposed || !document.documentElement) return;
    const root = document.documentElement;
    const body = document.body;
    if (!body) return;
    const oldVisibility = body.style.getPropertyValue('visibility');
    const oldPriority = body.style.getPropertyPriority('visibility');
    const oldBackground = root.style.getPropertyValue('background');
    const backgroundPriority = root.style.getPropertyPriority('background');
    body.style.setProperty('visibility', 'hidden', 'important');
    root.style.setProperty('background', 'transparent', 'important');
    restorePage = () => {
      body.style.setProperty('visibility', oldVisibility, oldPriority);
      root.style.setProperty('background', oldBackground, backgroundPriority);
    };
    overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:2147483647;display:grid;place-items:center;pointer-events:auto';
    const img = document.createElement('img');
    img.alt = '';
    img.src = logo;
    img.style.cssText = 'width:64px;height:64px;object-fit:contain;pointer-events:none;visibility:hidden';
    img.animate([
      { transform: 'scale(.94)', opacity: .72 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 1200, direction: 'alternate', iterations: Infinity, delay: -phaseMs });
    overlay.append(img);
    document.documentElement.append(overlay);
    observer.disconnect();
    host.postMessage({ type: 'canvas-startup-surface' });
    const ready = () => {
      if (disposed) return;
      overlay.style.background = '#fff';
      img.style.visibility = 'visible';
      restorePage();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!disposed) host.postMessage({ type: 'canvas-startup-presented' });
      }));
    };
    // Navigation has already completed. Decode this document's bitmap before
    // handing off the native splash; a decoded native bitmap alone is not enough.
    img.decode().then(ready, () => {
      if (disposed) return;
      dispose();
      host.postMessage({ type: 'canvas-startup-failed' });
    });
  };
  const observer = new MutationObserver(attach);
  observer.observe(document, { childList: true, subtree: true });
  host.addEventListener('message', onMessage);
  window.addEventListener('pagehide', dispose, { once: true });
  attach();
})();
