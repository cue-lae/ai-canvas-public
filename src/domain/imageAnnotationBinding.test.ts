import { describe, expect, it } from "vitest";
import {
  createImageBindingTransform,
  transformImageBoundBounds,
  transformImageBoundFreeDrawPoints,
} from "./imageAnnotationBinding";

const originalImage = {
  x: 100,
  y: 80,
  width: 400,
  height: 240,
  angle: 0,
  scale: [1, 1] as const,
};

describe("图片所属标注的坐标同步", () => {
  it("在父图平移并缩放时保持矩形、手绘路径和标注卡的相对关系", () => {
    const transform = createImageBindingTransform(originalImage, {
      x: 260,
      y: 140,
      width: 800,
      height: 480,
      angle: 0,
      scale: [1, 1],
    });

    expect(transform).not.toBeNull();
    expect(transformImageBoundBounds(
      { x: 180, y: 140, width: 120, height: 60 },
      transform!,
    )).toEqual({ x: 420, y: 260, width: 240, height: 120 });
    expect(transformImageBoundFreeDrawPoints(
      [[0, 0], [30, 20], [60, 40]],
      transform!,
    )).toEqual([[0, 0], [60, 40], [120, 80]]);

    // Cards follow the image's relative anchor but retain readable dimensions.
    expect(transformImageBoundBounds(
      { x: 540, y: 150, width: 280, height: 96 },
      transform!,
      false,
    )).toEqual({ x: 1140, y: 280, width: 280, height: 96 });
  });

  it("忽略未发生变换的图片，也不会伪造旋转或翻转后的绑定结果", () => {
    expect(createImageBindingTransform(originalImage, originalImage)).toBeNull();
    expect(createImageBindingTransform(originalImage, {
      ...originalImage,
      angle: Math.PI / 8,
    })).toBeNull();
    expect(createImageBindingTransform(originalImage, {
      ...originalImage,
      scale: [-1, 1],
    })).toBeNull();
  });
});
