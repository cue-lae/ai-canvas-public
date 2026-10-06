/** A host-only first-paint hint. Carries no scene, selection, file or user content. */
export function scheduleCanvasHostReady(
  host: { postMessage(message: { type: "canvas-ready" }): void } | undefined,
  frame: typeof requestAnimationFrame = requestAnimationFrame,
  cancel: typeof cancelAnimationFrame = cancelAnimationFrame,
): () => void {
  if (!host) return () => {};
  let active = true;
  let handle = frame(() => {
    if (!active) return;
    handle = frame(() => {
      if (active) host.postMessage({ type: "canvas-ready" });
    });
  });
  return () => { active = false; cancel(handle); };
}
