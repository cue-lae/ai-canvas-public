import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReadFocusCandidate } from "./readFocusCandidates";

/** Browsing is temporary UI state, independent of Canvas selection and focus. */
export const useReadImagePreview = (
  candidates: readonly ReadFocusCandidate[],
  identityKey: string,
) => {
  const [browsed, setBrowsed] = useState<{ identityKey: string; imageId: string | null }>(
    { identityKey, imageId: null },
  );
  const candidate = browsed.identityKey === identityKey
    ? candidates.find((item) => item.imageId === browsed.imageId) ?? null
    : null;
  // Reset during this render so a removed ID cannot silently reappear later.
  if (browsed.identityKey !== identityKey || (browsed.imageId !== null && !candidate)) {
    setBrowsed({ identityKey, imageId: null });
  }
  const inspect = useCallback((imageId: string) => {
    if (candidates.some((item) => item.imageId === imageId)) {
      setBrowsed({ identityKey, imageId });
    }
  }, [candidates, identityKey]);
  return { candidate, inspect };
};

interface ReadImagePreviewProps {
  candidate: ReadFocusCandidate | null;
  imageNumberById: ReadonlyMap<string, number>;
}

const PreviewPixels = ({ candidate }: { candidate: ReadFocusCandidate }) => {
  const [failed, setFailed] = useState<{ imageId: string; dataURL: string } | null>(null);
  const { imageId, dataURL } = candidate;
  return dataURL && !(failed?.imageId === imageId && failed.dataURL === dataURL) ? (
    <img
      key={`${imageId}:${dataURL}`}
      className="read-image-preview__image"
      src={dataURL}
      alt=""
      onError={() => setFailed({ imageId, dataURL })}
    />
  ) : (
    <span className="read-image-preview__placeholder">图片暂不可预览</span>
  );
};

export const ReadImagePreview = ({ candidate, imageNumberById }: ReadImagePreviewProps) => {
  const id = useId();
  const previewRef = useRef<HTMLElement>(null);
  const [sticky, setSticky] = useState(false);
  const name = candidate
    ? candidate.name.trim() ? candidate.name : `图片 ${imageNumberById.get(candidate.imageId) ?? "?"}`
    : null;

  useLayoutEffect(() => {
    const preview = previewRef.current;
    const panel = preview?.closest<HTMLElement>(".context-panel-content");
    if (!preview || !panel) return;
    const measure = () => {
      const tracks = getComputedStyle(panel).gridTemplateColumns
        .split(/\s+(?![^[]*\])/).filter((track) => track && track !== "none" && !track.startsWith("["));
      const fits = preview.getBoundingClientRect().height + 8 <= panel.clientHeight;
      setSticky(tracks.length > 1 && fits);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    observer?.observe(preview);
    if (preview.parentElement) observer?.observe(preview.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [candidate?.imageId, candidate?.dataURL, candidate?.unavailableReason, name]);

  return (
    <section className="read-image-preview" ref={previewRef} data-sticky={sticky ? "true" : "false"} aria-labelledby={`${id}-label`}>
      <h4 className="read-image-preview__label" id={`${id}-label`}>图片预览</h4>
      <div className="read-image-preview__group">
        <div className="read-image-preview__frame">
          {candidate ? <PreviewPixels key={`${candidate.imageId}:${candidate.dataURL}`} candidate={candidate} /> : (
            <span className="read-image-preview__placeholder">浏览图片后在此预览</span>
          )}
        </div>
        {name && <p className="read-image-preview__name">{name}</p>}
        {candidate?.unavailableReason && <p className="read-image-preview__reason">{candidate.unavailableReason}</p>}
      </div>
    </section>
  );
};
