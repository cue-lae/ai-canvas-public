export const FOLDER_PREVIEW_MOTION = {
  open: 420, close: 480, stagger: 20, maxDelay: 60,
  openEasing: "cubic-bezier(.25,.1,.25,1)",
  closeEasing: "cubic-bezier(.4,0,.6,1)",
} as const;

/** Owns only disposable animations on the existing preview DOM, never scene state. */
export function createFolderPreviewAnimator() {
  const running = new Map<HTMLElement | SVGElement, Animation | null>();
  let generation = 0;
  return {
    play(root: HTMLElement, closing: boolean, onClosed: () => void, reduced = false) {
      const current = ++generation;
      const nodes = Array.from(root.querySelectorAll<HTMLElement | SVGElement>("[data-folder-motion]"));
      for (const [node, animation] of running) {
        if (!nodes.includes(node)) {
          animation?.cancel();
          node.style.removeProperty("transform");
          node.style.removeProperty("opacity");
          running.delete(node);
        }
      }
      // Capture the entire displayed group before cancelling any previous motion.
      const parts = nodes.map((node) => {
        const existing = running.has(node);
        const style = getComputedStyle(node);
        const isCover = node.dataset.folderMotion === "cover";
        const open = { transform: node.style.getPropertyValue("--folder-motion-open-transform") || "translate(0px, 0px) scale(1)", opacity: "1" };
        const closed = { transform: node.style.getPropertyValue("--folder-motion-closed-transform"), opacity: isCover ? "1" : "0" };
        const from = existing ? { transform: style.transform, opacity: style.opacity } : closing ? open : closed;
        const to = closing ? closed : open;
        return { node, existing, isCover, from, to };
      });
      const images = !closing && !reduced
        ? nodes.filter((node): node is HTMLImageElement => node instanceof HTMLImageElement && typeof node.decode === "function")
        : [];
      const prepared: Animation[] = [];
      const ready: Promise<unknown>[] = [];
      const finished: Promise<unknown>[] = [];
      for (const { node, from } of parts) {
        running.get(node)?.cancel();
        running.set(node, null);
        // Keep the displayed group in place while the actual effects prepare.
        if (images.length) Object.assign(node.style, from);
      }
      for (const { node, existing, isCover, from, to } of parts) {
        if (!images.length) Object.assign(node.style, to);
        if (reduced || typeof node.animate !== "function") continue;
        const index = Number(node.dataset.folderMotionIndex) || 0;
        const animation = node.animate([from, to], {
          duration: closing ? FOLDER_PREVIEW_MOTION.close : FOLDER_PREVIEW_MOTION.open,
          delay: closing || existing || isCover ? 0 : Math.min(index * FOLDER_PREVIEW_MOTION.stagger, FOLDER_PREVIEW_MOTION.maxDelay),
          easing: closing ? FOLDER_PREVIEW_MOTION.closeEasing : FOLDER_PREVIEW_MOTION.openEasing,
          fill: "backwards",
        });
        if (images.length) {
          // Prepare the SAME effects while decoding, rather than introducing
          // their layers only after decoding. A fresh animation is at zero;
          // do not set currentTime/startTime and short-circuit native readiness.
          animation.pause();
          prepared.push(animation);
          ready.push(animation.ready);
        }
        running.set(node, animation);
        finished.push(animation.finished.catch(() => undefined));
      }
      void Promise.all(finished).then(() => {
        if (closing && current === generation) onClosed();
      });
      if (!images.length) return;
      // Decode failures retain the browser's normal image fallback; they must
      // neither strand the preview nor revive a cancelled navigation request.
      const prepare = () => {
        const sources = images.map((image) => image.src);
        void Promise.allSettled([...ready, ...images.map(async (image) => image.decode())]).then(() => {
          if (current !== generation || !root.isConnected || nodes.some((node) => !node.isConnected || !root.contains(node))) return;
          if (images.some((image, index) => image.src !== sources[index])) {
            prepare();
            return;
          }
          for (const { node, to } of parts) Object.assign(node.style, to);
          // Readiness is a preparation opportunity, not a GPU presentation fence.
          // Native pending-play chooses the shared start; never backdate it.
          for (const animation of prepared) animation.play();
        });
      };
      prepare();
    },
    dispose() {
      generation++;
      for (const [node, animation] of running) {
        animation?.cancel();
        node.style.removeProperty("transform");
        node.style.removeProperty("opacity");
      }
      running.clear();
    },
  };
}
