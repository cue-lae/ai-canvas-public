import { useEffect, useState, type RefObject } from "react";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { imageRotationReadout } from "./rotationFeedbackPresentation";

type Feedback = ReturnType<typeof imageRotationReadout>;

export function ImageRotationFeedback({ api, panelRef }: {
  api: ExcalidrawImperativeAPI;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let dismissed = false;
    const hide = () => { dismissed = true; setFeedback(null); };
    const update = (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const selected = elements.filter((element) =>
        !element.isDeleted && appState.selectedElementIds[element.id]);
      const image = selected.length === 1 && selected[0].type === "image" ? selected[0] : null;
      if (dismissed || !appState.isRotating || !image || !Number.isFinite(image.angle)) {
        setFeedback(null);
        return;
      }
      setFeedback(imageRotationReadout(image.angle));
    };
    panel.addEventListener("pointercancel", hide, true);
    window.addEventListener("blur", hide);
    const unsubscribeDown = api.onPointerDown((_tool, down) => {
      hide();
      if (down.resize.handleType !== "rotation") return;
      dismissed = false;
    });
    const unsubscribeChange = api.onChange(update);
    const unsubscribeUp = api.onPointerUp(hide);
    update(api.getSceneElements(), api.getAppState());
    return () => {
      unsubscribeChange();
      unsubscribeDown();
      unsubscribeUp();
      panel.removeEventListener("pointercancel", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [api, panelRef]);

  if (!feedback) return null;
  return (
    <span className="canvas-view-controls__rotation"
      aria-label={`图片旋转角度 ${feedback.label}`}>
      <span className="canvas-view-controls__rotation-caption">旋转</span>
      <span className={`canvas-view-controls__rotation-value${feedback.axis ? " is-aligned" : ""}`}>
        {feedback.label}
      </span>
    </span>
  );
}
