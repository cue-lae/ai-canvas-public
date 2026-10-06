export const FOLDER_PREVIEW_MOTION = {
  open: 420, close: 480, stagger: 20, maxDelay: 60,
  openEasing: "cubic-bezier(.25,.1,.25,1)",
  closeEasing: "cubic-bezier(.4,0,.6,1)",
} as const;

/** Owns only disposable animations on the existing preview DOM, never scene state. */
export function createFolderPreviewAnimator() {
  const running = new Map<HTMLElement, Animation | null>();
  let generation = 0;
  return {
    play(root: HTMLElement, closing: boolean, onClosed: () => void, reduced = false) {
      const current = ++generation;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-folder-motion]"));
      for (const [node, animation] of running) {
        if (!nodes.includes(node)) {
          animation?.cancel();
          node.style.removeProperty("transform");
          node.style.removeProperty("opacity");
          running.delete(node);
        }
      }
      const finished: Promise<unknown>[] = [];
      for (const node of nodes) {
        const existing = running.has(node);
        const style = getComputedStyle(node);
        const isCover = node.dataset.folderMotion === "cover";
        const open = { transform: node.style.getPropertyValue("--folder-motion-open-transform") || "translate(0px, 0px) scale(1)", opacity: "1" };
        const closed = { transform: node.style.getPropertyValue("--folder-motion-closed-transform"), opacity: isCover ? "1" : "0" };
        const from = existing ? { transform: style.transform, opacity: style.opacity } : closing ? open : closed;
        const to = closing ? closed : open;
        running.get(node)?.cancel();
        Object.assign(node.style, to);
        if (reduced || typeof node.animate !== "function") {
          running.set(node, null);
          continue;
        }
        const index = Number(node.dataset.folderMotionIndex) || 0;
        const animation = node.animate([from, to], {
          duration: closing ? FOLDER_PREVIEW_MOTION.close : FOLDER_PREVIEW_MOTION.open,
          delay: closing || existing || isCover ? 0 : Math.min(index * FOLDER_PREVIEW_MOTION.stagger, FOLDER_PREVIEW_MOTION.maxDelay),
          easing: closing ? FOLDER_PREVIEW_MOTION.closeEasing : FOLDER_PREVIEW_MOTION.openEasing,
          fill: "backwards",
        });
        running.set(node, animation);
        finished.push(animation.finished.catch(() => undefined));
      }
      void Promise.all(finished).then(() => {
        if (closing && current === generation) onClosed();
      });
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
