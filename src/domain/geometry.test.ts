import { describe, expect, it } from "vitest";
import {
  calculateRegionGeometry,
  imagePixelToScenePoint,
  pointDistance,
  scenePointToImagePixel,
  type ImageTransform,
} from "./geometry";

const originalPoints = [
  { x: 0, y: 0 },
  { x: 1920, y: 1080 },
  { x: 3839, y: 2159 },
  { x: 731.25, y: 1544.75 },
];

const cases: Array<{ name: string; image: ImageTransform }> = [
  {
    name: "图片移动",
    image: {
      x: 420,
      y: -180,
      width: 3840,
      height: 2160,
      angle: 0,
      naturalWidth: 3840,
      naturalHeight: 2160,
    },
  },
  {
    name: "图片非等比显示缩放",
    image: {
      x: -310,
      y: 220,
      width: 960,
      height: 432,
      angle: 0,
      naturalWidth: 3840,
      naturalHeight: 2160,
    },
  },
  {
    name: "图片旋转",
    image: {
      x: 175,
      y: 90,
      width: 1280,
      height: 720,
      angle: Math.PI / 5,
      naturalWidth: 3840,
      naturalHeight: 2160,
    },
  },
  {
    name: "图片裁剪",
    image: {
      x: 40,
      y: 75,
      width: 960,
      height: 540,
      angle: 0,
      naturalWidth: 3840,
      naturalHeight: 2160,
      crop: {
        x: 384,
        y: 216,
        width: 3072,
        height: 1728,
        naturalWidth: 3840,
        naturalHeight: 2160,
      },
    },
  },
  {
    name: "移动、缩放、旋转、裁剪、翻转组合",
    image: {
      x: -640,
      y: 330,
      width: 1152,
      height: 648,
      angle: -Math.PI / 7,
      scaleX: -1,
      scaleY: 1,
      naturalWidth: 3840,
      naturalHeight: 2160,
      crop: {
        x: 480,
        y: 270,
        width: 2880,
        height: 1620,
        naturalWidth: 3840,
        naturalHeight: 2160,
      },
    },
  },
];

describe("图片坐标往返", () => {
  it.each(cases)("$name 的原图像素往返误差不超过 1 px", ({ image }) => {
    for (const pixel of originalPoints) {
      const scene = imagePixelToScenePoint(pixel, image);
      const restored = scenePointToImagePixel(scene, image);
      expect(pointDistance(pixel, restored)).toBeLessThanOrEqual(1);
    }
  });

  it("裁剪坐标按裁剪源区域映射", () => {
    const image = cases.find((entry) => entry.name === "图片裁剪")!.image;
    const topLeft = scenePointToImagePixel(
      { x: image.x, y: image.y },
      image,
    );
    expect(topLeft.x).toBeCloseTo(384, 8);
    expect(topLeft.y).toBeCloseTo(216, 8);
  });
});

describe("ROI 几何", () => {
  it("记录 Scene、图片局部、原图像素和归一化四套坐标", () => {
    const image: ImageTransform = {
      x: 100,
      y: 200,
      width: 960,
      height: 540,
      angle: Math.PI / 6,
      naturalWidth: 3840,
      naturalHeight: 2160,
    };
    const geometry = calculateRegionGeometry(
      {
        x: 300,
        y: 340,
        width: 240,
        height: 140,
        angle: 0,
      },
      image,
    );
    expect(geometry.sceneCorners).toHaveLength(4);
    expect(geometry.imageLocalCorners).toHaveLength(4);
    expect(geometry.originalPixelCorners).toHaveLength(4);
    expect(geometry.normalizedCorners).toHaveLength(4);
    expect(geometry.roundTripMaxErrorPx).toBeLessThanOrEqual(1);
  });

  it("ROI 越界时裁切到原图范围", () => {
    const geometry = calculateRegionGeometry(
      {
        x: -50,
        y: -40,
        width: 200,
        height: 160,
        angle: 0,
      },
      {
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        angle: 0,
        naturalWidth: 4000,
        naturalHeight: 2000,
      },
    );
    expect(geometry.isClipped).toBe(true);
    expect(geometry.clippedPixelBounds.x).toBe(0);
    expect(geometry.clippedPixelBounds.y).toBe(0);
    expect(geometry.clippedPixelBounds.width).toBe(1500);
    expect(geometry.clippedPixelBounds.height).toBe(1200);
  });
});
