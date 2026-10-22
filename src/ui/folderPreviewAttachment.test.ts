import { describe, expect, it } from "vitest";
import {
  folderPreviewAttachmentAttributes,
  folderPreviewAttachmentCounterRotation,
  folderPreviewAttachmentLocalCounterStyle,
  folderPreviewAttachmentStyle,
  folderPreviewAttachmentTarget,
  type FolderPreviewAttachmentMotion,
  type FolderPreviewAttachmentTarget,
} from "./folderPreviewAttachment";

const motionFor = (target?: FolderPreviewAttachmentTarget): FolderPreviewAttachmentMotion => ({
  sourceRect: { left: 24, top: 68 },
  imageIds: new Set(["another-image", "image-a"]),
  targets: target ? new Map([["image-a", target]]) : undefined,
});
const target = { left: 100, top: 150, width: 300, height: 188, angle: 0.07 };
const rotate = (x: number, y: number, angle: number) => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
});

describe("folder preview attachment coordinate frames", () => {
  it("retains the owning image origin, raw motion and order on the outer wrapper", () => {
    const motion = motionFor(target);
    expect(folderPreviewAttachmentStyle(motion, "image-a", { left: 0, top: 0 })).toEqual({
      transformBox: "view-box", transformOrigin: "100px 150px", rotate: "0.07rad",
      "--folder-motion-closed-transform": "translate(-76px, -82px) scale(.42)",
    });
    expect(folderPreviewAttachmentStyle(motion, "image-a", target, true)?.transformOrigin).toBe("0px 0px");
    expect(folderPreviewAttachmentAttributes(motion, "image-a")).toEqual({
      "data-folder-motion": "member", "data-folder-motion-index": 1,
      "data-folder-motion-image-id": "image-a",
    });
    expect(folderPreviewAttachmentLocalCounterStyle(motion, "image-a")).toEqual({
      position: "absolute", left: 0, top: 0, width: 300, height: 188,
      transformOrigin: "150px 94px", transform: "rotate(-0.07rad)",
    });
  });

  it("matches image paint throughout either motion direction, including changed layout and angle", () => {
    const targets = [
      target,
      { ...target, left: 41, top: 93, width: 390, height: 244.4, angle: 0.115 },
      { ...target, angle: -0.18 },
      { ...target, width: 88, height: 242, angle: 0 },
    ];
    for (const geometry of targets) {
      const motion = motionFor(geometry);
      const style = folderPreviewAttachmentStyle(motion, "image-a", geometry)!;
      const outerAngle = parseFloat(String(style.rotate));
      const inverse = folderPreviewAttachmentCounterRotation(motion, "image-a")!
        .match(/^rotate\(([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+)\)$/)!;
      const innerAngle = Number(inverse[1]) * Math.PI / 180;
      const center = { x: Number(inverse[2]), y: Number(inverse[3]) };
      const displacement = { x: motion.sourceRect.left - geometry.left, y: motion.sourceRect.top - geometry.top };
      // The same poses occur in opening, closing and a reversed current pose.
      for (const progress of [0, 0.17, 0.5, 0.91, 1, 0.63, 0.21]) {
        const scale = 0.42 + 0.58 * progress;
        for (const point of [{ x: 0, y: 0 }, { x: geometry.width, y: geometry.height }, { x: 49, y: 67 }]) {
          const projected = rotate(point.x - geometry.width / 2, point.y - geometry.height / 2, geometry.angle);
          const inner = rotate(geometry.left + geometry.width / 2 + projected.x - center.x,
            geometry.top + geometry.height / 2 + projected.y - center.y, innerAngle);
          const outer = rotate(displacement.x * (1 - progress) + scale * (inner.x + center.x - geometry.left),
            displacement.y * (1 - progress) + scale * (inner.y + center.y - geometry.top), outerAngle);
          const image = rotate(displacement.x * (1 - progress) + scale * point.x,
            displacement.y * (1 - progress) + scale * point.y, geometry.angle);
          expect(outer.x).toBeCloseTo(image.x, 10);
          expect(outer.y).toBeCloseTo(image.y, 10);
        }
      }
    }
  });

  it("uses an identity rotation when a valid target has no angle", () => {
    const motion = motionFor({ left: 100, top: 150, width: 300, height: 188 });
    expect(folderPreviewAttachmentCounterRotation(motion, "image-a")).toBe("rotate(0 250 244)");
    expect(folderPreviewAttachmentStyle(motion, "image-a", target)?.rotate).toBe("0rad");
  });

  it("leaves absent motion, other owners and incomplete targets on the existing fallback path", () => {
    for (const motion of [null, motionFor(target)]) {
      expect(folderPreviewAttachmentStyle(motion, "not-a-member", target)).toBeUndefined();
      expect(folderPreviewAttachmentCounterRotation(motion, "not-a-member")).toBeUndefined();
      expect(folderPreviewAttachmentLocalCounterStyle(motion, "not-a-member")).toBeUndefined();
      expect(folderPreviewAttachmentAttributes(motion, "not-a-member")).toEqual({});
    }
    const missing = motionFor();
    expect(folderPreviewAttachmentStyle(missing, "image-a", { left: 10, top: 20 })).toEqual({
      transformBox: "view-box", transformOrigin: "10px 20px",
      "--folder-motion-closed-transform": "translate(14px, 48px) scale(.42)",
    });
    for (const invalid of [
      undefined,
      { ...target, width: 0 }, { ...target, height: -1 },
      { ...target, left: NaN }, { ...target, top: Infinity },
      { ...target, angle: NaN }, { ...target, angle: Infinity },
      { left: 100, top: 150 } as FolderPreviewAttachmentTarget,
    ]) {
      const motion = motionFor(invalid);
      expect(folderPreviewAttachmentTarget(motion, "image-a")).toBeUndefined();
      expect(folderPreviewAttachmentCounterRotation(motion, "image-a")).toBeUndefined();
      expect(folderPreviewAttachmentLocalCounterStyle(motion, "image-a")).toBeUndefined();
      expect(folderPreviewAttachmentStyle(motion, "image-a", target)?.rotate).toBeUndefined();
    }
  });
});
