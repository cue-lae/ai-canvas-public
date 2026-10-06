const CARD_SELECTOR = ".folder-workspace-hit-target, .folder-description-item";
const OFFSCREEN_ATTRIBUTE = "data-shadow-offscreen";

// Only the card body determines whether its decorative shadow can be painted.
// Browser intersection tracking also follows CSS transforms during drag/preview.
// No scene coordinates or document state are read or changed here.
export const observeCanvasCardShadows = (root: HTMLElement) => {
  const targets = new Set<HTMLElement>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (!targets.has(target)) continue;
        target.toggleAttribute(
          OFFSCREEN_ATTRIBUTE,
          !entry.isIntersecting ||
            entry.intersectionRect.width <= 0 ||
            entry.intersectionRect.height <= 0,
        );
      }
    },
    // A second, effectively zero threshold detects edge contact becoming area.
    { root, threshold: [0, Number.EPSILON] },
  );
  return {
    sync() {
      const next = new Set(root.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      for (const target of targets) {
        if (next.has(target)) continue;
        observer.unobserve(target);
        target.removeAttribute(OFFSCREEN_ATTRIBUTE);
        targets.delete(target);
      }
      let viewport: DOMRect | undefined;
      for (const target of next) {
        if (targets.has(target)) continue;
        targets.add(target);
        // Avoid a first-paint shadow from a newly mounted offscreen card.
        // These local rectangles are discarded immediately, never retained.
        const bounds = target.getBoundingClientRect();
        viewport ??= root.getBoundingClientRect();
        target.toggleAttribute(
          OFFSCREEN_ATTRIBUTE,
          bounds.width <= 0 || bounds.height <= 0 ||
            bounds.right <= viewport.left || bounds.left >= viewport.right ||
            bounds.bottom <= viewport.top || bounds.top >= viewport.bottom,
        );
        observer.observe(target);
      }
    },
    dispose() {
      observer.disconnect();
      for (const target of targets) target.removeAttribute(OFFSCREEN_ATTRIBUTE);
      targets.clear();
    },
  };
};
