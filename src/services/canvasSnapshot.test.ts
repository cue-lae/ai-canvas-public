import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  CANVAS_SNAPSHOT_ATTEMPT_DIMENSIONS,
  CANVAS_SNAPSHOT_MIME_TYPE,
  createCanvasSnapshot,
  type CanvasSnapshotCanvas,
  type CanvasSnapshotExporter,
} from "./canvasSnapshot";

const sceneElement = (isDeleted = false): ExcalidrawElement =>
  ({ id: "element-1", isDeleted } as ExcalidrawElement);

const canvas = ({
  width = 1200,
  height = 800,
  dataUrl = "data:image/png;base64,AAAA",
}: {
  width?: number;
  height?: number;
  dataUrl?: string;
} = {}): CanvasSnapshotCanvas => ({
  width,
  height,
  toDataURL: vi.fn(() => dataUrl),
});

const exporter = (snapshotCanvas: CanvasSnapshotCanvas): CanvasSnapshotExporter =>
  vi.fn(async () => snapshotCanvas);

describe("画布快照", () => {
  it("仅传递未删除元素，并返回受限 PNG 元数据", async () => {
    const snapshotCanvas = canvas();
    const exportCanvas = exporter(snapshotCanvas);

    const snapshot = await createCanvasSnapshot({
      elements: [sceneElement(), sceneElement(true)],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
      exportCanvas,
    });

    expect(snapshot).toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      bytes: 3,
    });
    expect(snapshotCanvas.toDataURL).toHaveBeenCalledWith(
      CANVAS_SNAPSHOT_MIME_TYPE,
    );
    expect(exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [sceneElement()],
        files: {},
        maxWidthOrHeight: 2048,
      }),
    );
    expect(exportCanvas).toHaveBeenCalledTimes(1);
  });

  it("可以用临时导出边界生成严格的当前视窗概览", async () => {
    const snapshotCanvas = canvas({ width: 800, height: 500 });
    const exportCanvas = exporter(snapshotCanvas);

    await createCanvasSnapshot({
      elements: [sceneElement()],
      files: {},
      exportCanvas,
      viewportBounds: { x: 240, y: 160, width: 800, height: 500 },
    });

    expect(exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        exportingFrame: expect.objectContaining({
          type: "frame",
          x: 240,
          y: 160,
          width: 800,
          height: 500,
        }),
      }),
    );
  });

  it("拒绝无效的视窗边界", async () => {
    await expect(
      createCanvasSnapshot({
        elements: [sceneElement()],
        files: {},
        exportCanvas: exporter(canvas()),
        viewportBounds: { x: 0, y: 0, width: 0, height: 500 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_VIEWPORT_BOUNDS" });
  });

  it("拒绝没有任何未删除元素的场景", async () => {
    await expect(
      createCanvasSnapshot({
        elements: [sceneElement(true)],
        files: {},
        exportCanvas: exporter(canvas()),
      }),
    ).rejects.toMatchObject({
      code: "EMPTY_SCENE",
    });
  });

  it("拒绝超过最长边上限的导出结果", async () => {
    await expect(
      createCanvasSnapshot({
        elements: [sceneElement()],
        files: {},
        maxDimension: 1600,
        exportCanvas: exporter(canvas({ width: 1601, height: 800 })),
      }),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_DIMENSION_LIMIT_EXCEEDED",
    });
  });

  it("拒绝超过字节上限的 PNG data URL", async () => {
    await expect(
      createCanvasSnapshot({
        elements: [sceneElement()],
        files: {},
        maxBytes: 5,
        exportCanvas: exporter(
          canvas({ width: 1, height: 1, dataUrl: "data:image/png;base64,AAAAAAAA" }),
        ),
      }),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_BYTE_LIMIT_EXCEEDED",
    });
  });

  it("按固定阶梯复用同一视窗导出输入，并返回首个合格 PNG", async () => {
    const first = canvas({
      width: 2048,
      height: 1024,
      dataUrl: "data:image/png;base64,AAAAAAAA",
    });
    const second = canvas({ width: 1792, height: 896 });
    const exportCanvas = vi
      .fn<CanvasSnapshotExporter>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const elements = [sceneElement(), sceneElement(true)];
    const appState = { viewBackgroundColor: "#ffffff" };
    const files = {};

    const snapshot = await createCanvasSnapshot({
      elements,
      appState,
      files,
      exportCanvas,
      viewportBounds: { x: 10, y: 20, width: 900, height: 600 },
      maxBytes: 5,
    });

    expect(snapshot.width).toBe(1792);
    expect(exportCanvas).toHaveBeenCalledTimes(2);
    expect(exportCanvas.mock.calls.map(([options]) => options.maxWidthOrHeight))
      .toEqual(CANVAS_SNAPSHOT_ATTEMPT_DIMENSIONS.slice(0, 2));
    const [firstOptions, secondOptions] = exportCanvas.mock.calls.map(
      ([options]) => options,
    );
    expect(firstOptions.elements).toBe(secondOptions.elements);
    expect(firstOptions.appState).toBe(appState);
    expect(secondOptions.appState).toBe(appState);
    expect(firstOptions.files).toBe(files);
    expect(secondOptions.files).toBe(files);
    expect(firstOptions.exportPadding).toBe(secondOptions.exportPadding);
    expect(firstOptions.exportingFrame).toBe(secondOptions.exportingFrame);
  });

  it("在 512px 仍超限时 fail-closed 并给出缩小视窗提示", async () => {
    const exportCanvas = vi.fn<CanvasSnapshotExporter>(async (options) =>
      canvas({
        width: options.maxWidthOrHeight ?? 1,
        height: 1,
        dataUrl: "data:image/png;base64,AAAAAAAA",
      }),
    );

    const error = await createCanvasSnapshot({
      elements: [sceneElement()],
      files: {},
      exportCanvas,
      maxBytes: 5,
    }).catch((reason) => reason);
    expect(error).toMatchObject({ code: "SNAPSHOT_BYTE_LIMIT_EXCEEDED" });
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("缩小当前视窗或减少可见内容"),
    );
    expect(exportCanvas).toHaveBeenCalledTimes(7);
    expect(exportCanvas.mock.calls.map(([options]) => options.maxWidthOrHeight))
      .toEqual(CANVAS_SNAPSHOT_ATTEMPT_DIMENSIONS);
  });

  it("自定义最长边只继续尝试严格更小的固定阶梯", async () => {
    const exportCanvas = vi.fn<CanvasSnapshotExporter>(async (options) =>
      canvas({
        width: options.maxWidthOrHeight ?? 1,
        height: 1,
        dataUrl: "data:image/png;base64,AAAAAAAA",
      }),
    );

    await expect(
      createCanvasSnapshot({
        elements: [sceneElement()],
        files: {},
        exportCanvas,
        maxDimension: 1600,
        maxBytes: 5,
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_BYTE_LIMIT_EXCEEDED" });
    expect(exportCanvas.mock.calls.map(([options]) => options.maxWidthOrHeight))
      .toEqual([1600, 1536, 1280, 1024, 768, 512]);
  });

  it("小于 512px 的自定义最长边只尝试一次", async () => {
    const exportCanvas = exporter(canvas({ width: 400, height: 200 }));

    await createCanvasSnapshot({
      elements: [sceneElement()],
      files: {},
      exportCanvas,
      maxDimension: 400,
    });

    expect(exportCanvas).toHaveBeenCalledTimes(1);
    expect(exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ maxWidthOrHeight: 400 }),
    );
  });
});
