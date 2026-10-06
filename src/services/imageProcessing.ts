import type {
  BinaryFileData,
  DataURL,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { Bounds } from "../domain/types";

export class PixelAccessError extends Error {
  readonly code:
    | "CORS_PIXEL_READ_BLOCKED"
    | "IMAGE_LOAD_FAILED"
    | "EMPTY_REGION";

  constructor(
    code: PixelAccessError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PixelAccessError";
    this.code = code;
  }
}

export interface LoadedLocalImage {
  dataURL: DataURL;
  width: number;
  height: number;
  mimeType: string;
}

const loadImage = (
  source: string,
  crossOrigin: "" | "anonymous" = "",
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) {
      image.crossOrigin = crossOrigin;
    }
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new PixelAccessError(
          crossOrigin ? "CORS_PIXEL_READ_BLOCKED" : "IMAGE_LOAD_FAILED",
          crossOrigin
            ? "远程图片未提供允许像素读取的 CORS 响应头，无法生成局部图片或蒙版。"
            : "图片加载失败，无法读取像素。",
        ),
      );
    image.src = source;
  });

const readAsDataURL = (file: File): Promise<DataURL> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });

export const readLocalImage = async (
  file: File,
): Promise<LoadedLocalImage> => {
  const dataURL = await readAsDataURL(file);
  const image = await loadImage(dataURL);
  return {
    dataURL,
    width: image.naturalWidth,
    height: image.naturalHeight,
    mimeType: file.type || "image/png",
  };
};

export const createBinaryFileData = (
  fileId: string,
  image: LoadedLocalImage,
): BinaryFileData => ({
  id: fileId as FileId,
  dataURL: image.dataURL,
  mimeType: image.mimeType as BinaryFileData["mimeType"],
  created: Date.now(),
  lastRetrieved: Date.now(),
});

const integerClippedBounds = (
  bounds: Bounds,
  naturalWidth: number,
  naturalHeight: number,
): Bounds => {
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(
    naturalWidth,
    Math.ceil(bounds.x + bounds.width),
  );
  const bottom = Math.min(
    naturalHeight,
    Math.ceil(bounds.y + bounds.height),
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 || height === 0) {
    throw new PixelAccessError(
      "EMPTY_REGION",
      "ROI 与原图没有有效交集，无法生成局部图片。",
    );
  }
  return { x: left, y: top, width, height };
};

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas 无法生成 PNG"));
        }
      }, "image/png");
    } catch (error) {
      reject(
        new PixelAccessError(
          "CORS_PIXEL_READ_BLOCKED",
          `浏览器阻止读取图片像素：${
            error instanceof Error ? error.message : "CORS 安全限制"
          }`,
        ),
      );
    }
  });

export const createRegionPng = async (
  dataURL: string,
  bounds: Bounds,
): Promise<{ blob: Blob; clippedBounds: Bounds }> => {
  const image = await loadImage(dataURL);
  const clippedBounds = integerClippedBounds(
    bounds,
    image.naturalWidth,
    image.naturalHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = clippedBounds.width;
  canvas.height = clippedBounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("浏览器未提供 Canvas 2D 上下文");
  }
  context.drawImage(
    image,
    clippedBounds.x,
    clippedBounds.y,
    clippedBounds.width,
    clippedBounds.height,
    0,
    0,
    clippedBounds.width,
    clippedBounds.height,
  );
  context.getImageData(0, 0, 1, 1);
  return { blob: await canvasToBlob(canvas), clippedBounds };
};

export const createRegionMask = async (
  naturalWidth: number,
  naturalHeight: number,
  bounds: Bounds,
  mode: "original-size" | "selection-size",
): Promise<{ blob: Blob; clippedBounds: Bounds }> => {
  const clippedBounds = integerClippedBounds(
    bounds,
    naturalWidth,
    naturalHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width =
    mode === "original-size" ? naturalWidth : clippedBounds.width;
  canvas.height =
    mode === "original-size" ? naturalHeight : clippedBounds.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器未提供 Canvas 2D 上下文");
  }
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  if (mode === "original-size") {
    context.fillRect(
      clippedBounds.x,
      clippedBounds.y,
      clippedBounds.width,
      clippedBounds.height,
    );
  } else {
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { blob: await canvasToBlob(canvas), clippedBounds };
};

export const probeRemotePixelRead = async (url: string): Promise<void> => {
  if (!/^https?:\/\//i.test(url)) {
    throw new PixelAccessError(
      "IMAGE_LOAD_FAILED",
      "请输入以 http:// 或 https:// 开头的远程图片地址。",
    );
  }
  const image = await loadImage(url, "anonymous");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("浏览器未提供 Canvas 2D 上下文");
  }
  try {
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
  } catch (error) {
    throw new PixelAccessError(
      "CORS_PIXEL_READ_BLOCKED",
      `远程图片已污染 Canvas，浏览器禁止像素读取：${
        error instanceof Error ? error.message : "CORS 安全限制"
      }`,
    );
  }
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const createBenchmarkImage = async (
  label: string,
  hue: number,
): Promise<LoadedLocalImage> => {
  const canvas = document.createElement("canvas");
  canvas.width = 3840;
  canvas.height = 2160;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器未提供 Canvas 2D 上下文");
  }
  const gradient = context.createLinearGradient(0, 0, 3840, 2160);
  gradient.addColorStop(0, `hsl(${hue} 42% 22%)`);
  gradient.addColorStop(1, `hsl(${(hue + 55) % 360} 55% 68%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 3840, 2160);
  context.strokeStyle = "rgba(255,255,255,.18)";
  context.lineWidth = 4;
  for (let x = 0; x <= 3840; x += 240) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 2160);
    context.stroke();
  }
  for (let y = 0; y <= 2160; y += 180) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(3840, y);
    context.stroke();
  }
  context.fillStyle = "rgba(255,255,255,.92)";
  context.font = "700 180px system-ui";
  context.fillText(label, 180, 340);
  const dataURL = canvas.toDataURL("image/png") as DataURL;
  return {
    dataURL,
    width: 3840,
    height: 2160,
    mimeType: "image/png",
  };
};
