import { describe, expect, it } from "vitest";
import {
  bindDescriptionAnchorToImage,
  followDescriptionImageBinding,
  snapDescriptionAnchorToImageTop,
} from "./descriptionImageBinding";

const image = {
  imageId: "image-a",
  x: 100,
  y: 80,
  width: 400,
  height: 240,
  angle: 0,
  scale: [1, 1] as const,
};

describe("说明锚点与图片上边缘定位关系", () => {
  it("只在图片上边缘阈值内吸附，并记录横向相对位置", () => {
    expect(
      snapDescriptionAnchorToImageTop({ x: 260, y: 92 }, [image], 16),
    ).toEqual({
      anchor: { x: 260, y: 80 },
      imageBinding: { imageId: "image-a", relativeX: 0.4 },
    });
    expect(
      snapDescriptionAnchorToImageTop({ x: 260, y: 310 }, [image], 16),
    ).toEqual({ anchor: { x: 260, y: 310 }, imageBinding: null });
    expect(
      snapDescriptionAnchorToImageTop({ x: 90, y: 80 }, [image], 16),
    ).toEqual({ anchor: { x: 90, y: 80 }, imageBinding: null });
  });

  it("图片移动或缩放后，绑定锚点仍停在上边缘相对位置", () => {
    const binding = { imageId: "image-a", relativeX: 0.4 };
    expect(
      followDescriptionImageBinding(binding, {
        ...image,
        x: 260,
        y: 140,
        width: 800,
        height: 480,
      }),
    ).toEqual({ x: 580, y: 140 });
  });

  it("旋转图片按真实可见四边形命中内部点，外部点保持解绑", () => {
    expect(
      bindDescriptionAnchorToImage(
        { x: 240, y: 100 },
        [{ ...image, angle: Math.PI / 2 }],
      ).imageBinding,
    ).toEqual({ imageId: "image-a", relativeX: 0.25, relativeY: 0.75 });
    expect(
      bindDescriptionAnchorToImage(
        { x: 500, y: 200 },
        [{ ...image, angle: Math.PI / 2 }],
      ),
    ).toEqual({ anchor: { x: 500, y: 200 }, imageBinding: null });
  });

  it("按锚点中心绑定图片内部，并在重叠处选择最上层图片", () => {
    const bound = bindDescriptionAnchorToImage(
      { x: 240, y: 160 },
      [
        { ...image, zIndex: 1 },
        { ...image, imageId: "image-top", x: 180, y: 120, zIndex: 2 },
      ],
    );
    expect(bound.anchor).toEqual({ x: 240, y: 160 });
    expect(bound.imageBinding?.imageId).toBe("image-top");
    expect(bound.imageBinding?.relativeX).toBeCloseTo(0.15);
    expect(bound.imageBinding?.relativeY).toBeCloseTo(1 / 6);
    expect(
      bindDescriptionAnchorToImage({ x: 40, y: 30 }, [image]),
    ).toEqual({ anchor: { x: 40, y: 30 }, imageBinding: null });
  });

  it("内部绑定会按图片移动与缩放同时保持横纵相对位置", () => {
    expect(
      followDescriptionImageBinding(
        { imageId: "image-a", relativeX: 0.25, relativeY: 0.5 },
        { ...image, x: 40, y: 60, width: 800, height: 480 },
      ),
    ).toEqual({ x: 240, y: 300 });
  });

  it("负 scaleX 与负 scaleY 仍以局部归一化坐标绑定和跟随", () => {
    const horizontalMirror = { ...image, scale: [-1, 1] as const };
    const verticalMirror = { ...image, scale: [1, -1] as const };
    expect(
      bindDescriptionAnchorToImage({ x: 400, y: 140 }, [horizontalMirror])
        .imageBinding,
    ).toEqual({ imageId: "image-a", relativeX: 0.25, relativeY: 0.25 });
    expect(
      bindDescriptionAnchorToImage({ x: 200, y: 260 }, [verticalMirror])
        .imageBinding,
    ).toEqual({ imageId: "image-a", relativeX: 0.25, relativeY: 0.25 });
    expect(
      followDescriptionImageBinding(
        { imageId: "image-a", relativeX: 0.25, relativeY: 0.25 },
        { ...image, x: 200, y: 160, width: 800, height: 480, scale: [-1, -1] },
      ),
    ).toEqual({ x: 800, y: 520 });
  });

  it("纵向镜像只把可见上边吸附为顶部，且旋转后仍使用同一边", () => {
    const verticalMirror = { ...image, scale: [1, -1] as const };
    expect(
      snapDescriptionAnchorToImageTop({ x: 260, y: 92 }, [verticalMirror], 16),
    ).toEqual({
      anchor: { x: 260, y: 80 },
      imageBinding: { imageId: "image-a", relativeX: 0.4 },
    });
    expect(
      snapDescriptionAnchorToImageTop({ x: 260, y: 308 }, [verticalMirror], 16),
    ).toEqual({ anchor: { x: 260, y: 308 }, imageBinding: null });
    expect(
      snapDescriptionAnchorToImageTop(
        { x: 408, y: 160 },
        [{ ...verticalMirror, angle: Math.PI / 2 }],
        16,
      ),
    ).toEqual({
      anchor: { x: 420, y: 160 },
      imageBinding: { imageId: "image-a", relativeX: 0.4 },
    });
  });

  it("移动、旋转和缩放后可由同一局部坐标往返恢复", () => {
    const binding = { imageId: "image-a", relativeX: 0.3, relativeY: 0.7 };
    const transformed = {
      ...image,
      x: 260,
      y: 140,
      width: 800,
      height: 480,
      angle: Math.PI / 3,
      scale: [-1.5, 0.75] as const,
    };
    const followed = followDescriptionImageBinding(binding, transformed);
    expect(followed).not.toBeNull();
    const rebound = bindDescriptionAnchorToImage(followed!, [transformed]);
    expect(rebound.imageBinding?.imageId).toBe(binding.imageId);
    expect(rebound.imageBinding?.relativeX).toBeCloseTo(binding.relativeX);
    expect(rebound.imageBinding?.relativeY).toBeCloseTo(binding.relativeY);
  });

  it("旋转重叠图片仍选择场景 zIndex 最高的图片", () => {
    expect(
      bindDescriptionAnchorToImage(
        { x: 300, y: 200 },
        [
          { ...image, angle: Math.PI / 4, zIndex: 3 },
          { ...image, imageId: "image-top", angle: Math.PI / 4, zIndex: 4 },
        ],
      ).imageBinding,
    ).toEqual({ imageId: "image-top", relativeX: 0.5, relativeY: 0.5 });
  });

  it("缺失 relativeY 的旧绑定仍以局部 y=0 跟随旋转图片", () => {
    expect(
      followDescriptionImageBinding(
        { imageId: "image-a", relativeX: 0.5 },
        { ...image, angle: Math.PI / 2 },
      ),
    ).toEqual({ x: 420, y: 200 });
  });
});
