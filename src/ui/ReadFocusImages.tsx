import { useId, useState } from "react";
import type { ReadFocusCandidate } from "./readFocusCandidates";

export interface ReadFocusImagesProps {
  candidates: readonly ReadFocusCandidate[];
  focusedImageIds: readonly string[];
  imageNumberById: ReadonlyMap<string, number>;
  scopeLabel: string;
  busy: boolean;
  maxImages: number;
  onToggle: (imageId: string) => void;
  onInspect: (imageId: string) => void;
}

const ReadFocusThumbnail = ({ dataURL }: { dataURL: string | null }) => {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  return dataURL && failedURL !== dataURL ? (
    <img
      className="read-focus-images__thumbnail"
      src={dataURL}
      alt=""
      onError={() => setFailedURL(dataURL)}
    />
  ) : (
    <span className="read-focus-images__thumbnail is-placeholder" aria-hidden="true">图</span>
  );
};

/** A controlled view of the existing focus IDs, with no Canvas selection callbacks. */
export const ReadFocusImages = ({
  candidates,
  focusedImageIds,
  imageNumberById,
  scopeLabel,
  busy,
  maxImages,
  onToggle,
  onInspect,
}: ReadFocusImagesProps) => {
  const id = useId();
  const focused = new Set(focusedImageIds);
  const selectedCount = candidates.filter((candidate) => focused.has(candidate.imageId)).length;
  const abnormalCount = candidates.filter(
    (candidate) => focused.has(candidate.imageId) && candidate.unavailableReason,
  ).length;
  const atLimit = selectedCount >= maxImages;
  const displayName = (candidate: ReadFocusCandidate) =>
    candidate.name.trim() ? candidate.name : `图片 ${imageNumberById.get(candidate.imageId) ?? "?"}`;

  return (
    <section className="read-focus-images" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`}>本次重点 {selectedCount}/{maxImages}</h4>
      <p className="read-focus-images__scope">{scopeLabel} · {candidates.length} 张图片</p>
      <div className="read-focus-images__messages" id={`${id}-messages`}>
        {candidates.length === 0 ? (
          <p>当前范围没有图片。</p>
        ) : selectedCount === 0 ? (
          <p>尚未加入重点，请从下方选择图片。</p>
        ) : null}
        {abnormalCount > 0 && (
          <p className="read-focus-images__warning">有 {abnormalCount} 张重点图片不可用，仍可取消重点。</p>
        )}
        {atLimit && <p>最多加入 {maxImages} 张重点；可先取消已选图片。</p>}
        {busy && <p>正在处理，请稍候再调整重点。</p>}
      </div>
      <ul className="read-focus-images__list">
        {candidates.map((candidate, index) => {
          const selected = focused.has(candidate.imageId);
          const disabled = busy || (!selected && (atLimit || Boolean(candidate.unavailableReason)));
          const name = displayName(candidate);
          const action = selected ? "取消重点" : "加入重点";
          const unavailableId = `${id}-unavailable-${index}`;
          return (
            <li className="read-focus-images__item" key={candidate.imageId}>
              <button
                type="button"
                className={`read-focus-images__row${selected ? " is-selected" : ""}`}
                aria-label={`${name}，${selected ? "已加入重点" : "未加入重点"}，${action}`}
                aria-pressed={selected}
                aria-describedby={`${id}-messages ${id}-helper${candidate.unavailableReason ? ` ${unavailableId}` : ""}`}
                aria-disabled={disabled}
                onMouseEnter={() => onInspect(candidate.imageId)}
                onFocus={() => onInspect(candidate.imageId)}
                onClick={() => { if (!disabled) onToggle(candidate.imageId); }}
              >
                {selected && (
                  <span className="read-focus-images__mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </span>
                )}
                <ReadFocusThumbnail dataURL={candidate.dataURL} />
                <strong className="read-focus-images__name">{name}</strong>
                <span className="read-focus-images__action">{selected ? "已加入" : "加入"}</span>
              </button>
              {candidate.unavailableReason && (
                <p className="read-focus-images__unavailable" id={unavailableId}>{candidate.unavailableReason}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="read-focus-images__helper" id={`${id}-helper`}>
        重点图片以完整原图交接，修改对象以画布说明为准。
      </p>
    </section>
  );
};
