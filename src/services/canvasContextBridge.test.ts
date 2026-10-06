import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexVisualContext } from "../domain/codexContext";
import type { FocusedCanvasContext } from "../domain/focusedPublish";
import {
  BRIDGE_PUBLISH_TIMEOUT_MS,
  BRIDGE_SESSION_TIMEOUT_MS,
  COMPLEX_CANVAS_PACKAGING_STATUS,
  MAX_PUBLISH_PAYLOAD_BYTES,
  NORMAL_PUBLISH_PAYLOAD_BYTES,
  classifyPublishPayloadBytes,
  largestPublishImageMaterial,
  publishPayloadByteLength,
  publishNoActiveRegion,
  publishFocusedCanvasContext,
  publishReadyCanvasContext,
  resolveBridgeBaseUrl,
} from "./canvasContextBridge";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const focusedContext = (name = "large-image.png"): FocusedCanvasContext => ({
  format: "ai-canvas-focused-context",
  version: 1,
  generatedAt: "2026-08-29T00:00:00.000Z",
  document: { id: "document-large", title: "复杂画布" },
  overviewSnapshot: {
    filename: "viewport.png",
    mimeType: "image/png",
    width: 2048,
    height: 1024,
    bytes: 1024,
  },
  focusImages: [{
    imageId: "image-large",
    fileId: "file-large",
    name,
    mimeType: "image/png",
    naturalWidth: 2048,
    naturalHeight: 1024,
    pixelsAvailable: true,
    visibleAnnotations: [],
  }],
});

const focusedFixtureForSerializedBytes = (targetBytes: number) => {
  const overviewSnapshotDataUrl = "data:image/png;base64,AAAA";
  const prefix = "data:image/png;base64,";
  for (let namePadding = 0; namePadding < 4; namePadding += 1) {
    const context = focusedContext(`hero-${"x".repeat(namePadding)}.png`);
    const serialize = (originalImageDataUrl: string) => JSON.stringify({
      version: 1,
      status: "focused",
      publishedAt: "2026-08-29T00:00:00.000Z",
      context,
      overviewSnapshot: { encoding: "data-url", dataUrl: overviewSnapshotDataUrl },
      focusImages: [{
        imageId: "image-large",
        originalImage: { encoding: "data-url", dataUrl: originalImageDataUrl },
      }],
    });
    const baseLength = publishPayloadByteLength(serialize(prefix));
    const base64Length = targetBytes - baseLength;
    if (base64Length >= 0 && base64Length % 4 === 0) {
      return {
        context,
        overviewSnapshotDataUrl,
        originalImageDataUrl: `${prefix}${"A".repeat(base64Length)}`,
      };
    }
  }
  throw new Error("无法构造四对齐的精确发布正文 fixture。");
};

describe("Canvas 本机桥接客户端", () => {
  it("默认保持开发桥接地址，并只接受受限的包构建 loopback 地址", () => {
    expect(resolveBridgeBaseUrl()).toBe("http://127.0.0.1:43127");
    expect(resolveBridgeBaseUrl("http://127.0.0.1:43128")).toBe(
      "http://127.0.0.1:43128",
    );
    expect(() => resolveBridgeBaseUrl("https://example.test:43128")).toThrow(
      "127.0.0.1",
    );
  });

  it("在任何 fetch 前拒绝图片归属错误的快速标注", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const context = focusedContext();
    context.focusImages[0].quickAnnotations = [
      {
        quickAnnotationId: "quick-a",
        ordinal: 1,
        label: "Q1",
        imageId: "image-other",
        mode: "point",
        text: "错误归属",
        normalizedAnchor: { x: 0.2, y: 0.3 },
        originalPixelAnchor: { x: 400, y: 300 },
      },
    ];

    await expect(
      publishFocusedCanvasContext({
        context,
        overviewSnapshotDataUrl: "data:image/png;base64,AAAA",
        focusedImages: [
          {
            imageId: "image-large",
            originalImageDataUrl: "data:image/png;base64,AAAA",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PUBLISH_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("以实际 UTF-8 字节分类 20MiB 与 50MiB 容量门", () => {
    expect(classifyPublishPayloadBytes(NORMAL_PUBLISH_PAYLOAD_BYTES)).toBe("normal");
    expect(classifyPublishPayloadBytes(NORMAL_PUBLISH_PAYLOAD_BYTES + 1)).toBe("complex");
    expect(classifyPublishPayloadBytes(MAX_PUBLISH_PAYLOAD_BYTES)).toBe("complex");
    expect(classifyPublishPayloadBytes(MAX_PUBLISH_PAYLOAD_BYTES + 1)).toBe("too-large");
  });

  it("精确 50MiB 的 focused 正文在任何 fetch 前通知单一复杂画布状态", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        version: 1,
        sessionId: "session-complex",
        token: "token-complex",
        expiresAt: "2026-08-29T00:00:30.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        version: 1,
        sessionId: "session-complex",
        revision: "revision-complex",
        status: "FOCUSED",
        receivedAt: "2026-08-29T00:00:01.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onComplexCanvasPackaging = vi.fn(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
    const fixture = focusedFixtureForSerializedBytes(MAX_PUBLISH_PAYLOAD_BYTES);

    await publishFocusedCanvasContext({
      context: fixture.context,
      overviewSnapshotDataUrl: fixture.overviewSnapshotDataUrl,
      focusedImages: [{ imageId: "image-large", originalImageDataUrl: fixture.originalImageDataUrl }],
      onComplexCanvasPackaging,
    });

    expect(onComplexCanvasPackaging).toHaveBeenCalledTimes(1);
    expect(COMPLEX_CANVAS_PACKAGING_STATUS).toBe("正在打包复杂画布…");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const serializedBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(publishPayloadByteLength(serializedBody)).toBe(MAX_PUBLISH_PAYLOAD_BYTES);
    expect(publishPayloadByteLength(serializedBody)).toBeGreaterThan(
      NORMAL_PUBLISH_PAYLOAD_BYTES,
    );
    expect(fixture.originalImageDataUrl.slice("data:image/png;base64,".length).length % 4)
      .toBe(0);
  });

  it(">50MiB 的共享发布在 session 前 fail-closed 且包含最大重点图片材料", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const fixture = focusedFixtureForSerializedBytes(MAX_PUBLISH_PAYLOAD_BYTES + 1);

    const error = await publishFocusedCanvasContext({
      context: fixture.context,
      overviewSnapshotDataUrl: fixture.overviewSnapshotDataUrl,
      focusedImages: [{ imageId: "image-large", originalImageDataUrl: fixture.originalImageDataUrl }],
    }).catch((reason) => reason);
    expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    const decodedMiB = (
      ((fixture.originalImageDataUrl.length - "data:image/png;base64,".length) / 4 * 3) / (1024 * 1024)
    ).toFixed(2);
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining(`重点图片 ${fixture.context.focusImages[0]?.name}`),
    );
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("发布请求总量 50.00 MiB"),
    );
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining(`解码 ${decodedMiB} MiB`),
    );
    expect(fixture.originalImageDataUrl.slice("data:image/png;base64,".length).length % 4)
      .toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("以旧发布材料标签说明最大原图或画布快照", () => {
    expect(largestPublishImageMaterial({
      status: "ready",
      originalImage: { dataUrl: "data:image/jpeg;base64,AAAAAAAA" },
      canvasSnapshot: { dataUrl: "data:image/png;base64,AAAA" },
    })).toMatchObject({ label: "原图", decodedBytes: 6 });
  });

  it("session 和 publish 使用独立的 5 秒与 30 秒超时", async () => {
    vi.useFakeTimers();
    const abortableFetch = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    vi.stubGlobal("fetch", abortableFetch);
    const sessionResult = publishNoActiveRegion({ documentId: "session-timeout" }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(BRIDGE_SESSION_TIMEOUT_MS);
    await expect(sessionResult).resolves.toMatchObject({
      ok: false,
      error: { code: "BRIDGE_TIMEOUT" },
    });

    let publishStartedAt: number | undefined;
    const publishAbortable = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        version: 1,
        sessionId: "session-timeout",
        token: "token-timeout",
        expiresAt: "2026-08-29T00:00:30.000Z",
      }))
      .mockImplementationOnce((_input, init) => {
        publishStartedAt = Date.now();
        return new Promise((_, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
          );
        });
      });
    vi.stubGlobal("fetch", publishAbortable);
    let publishSettled = false;
    const publishResult = publishNoActiveRegion({ documentId: "publish-timeout" }).then(
      () => {
        publishSettled = true;
        return { ok: true as const };
      },
      (error) => {
        publishSettled = true;
        return { ok: false as const, error };
      },
    );
    await vi.waitFor(() => {
      expect(publishAbortable).toHaveBeenCalledTimes(2);
    }, { timeout: 1_000, interval: 1 });
    if (typeof publishStartedAt !== "number") {
      throw new Error("/publish 未建立，无法验证独立超时。");
    }
    const elapsed = Date.now() - publishStartedAt;
    const remaining = BRIDGE_PUBLISH_TIMEOUT_MS - elapsed;
    expect(remaining).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(publishSettled).toBe(false);
    expect(publishAbortable).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(publishResult).resolves.toMatchObject({
      ok: false,
      error: { code: "BRIDGE_TIMEOUT" },
    });
  });

  it("原子发布当前视窗概览和有序重点图片", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-focus",
          token: "token-focus",
          expiresAt: "2026-07-31T12:00:30.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-focus",
          revision: "revision-focus",
          status: "FOCUSED",
          receivedAt: "2026-07-31T12:00:01.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const context: FocusedCanvasContext = {
      format: "ai-canvas-focused-context",
      version: 1,
      generatedAt: "2026-07-31T12:00:00.000Z",
      document: { id: "document-a", title: "多图方案" },
      overviewSnapshot: {
        filename: "viewport.png",
        mimeType: "image/png",
        width: 1200,
        height: 800,
        bytes: 2345,
      },
      focusImages: [
        {
          imageId: "image-a",
          fileId: "file-a",
          name: "living-room.jpg",
          mimeType: "image/jpeg",
          naturalWidth: 3000,
          naturalHeight: 2000,
          pixelsAvailable: true,
          visibleAnnotations: [],
        },
        {
          imageId: "image-b",
          fileId: "file-b",
          name: "bedroom.png",
          mimeType: "image/png",
          naturalWidth: 2000,
          naturalHeight: 1500,
          pixelsAvailable: true,
          visibleAnnotations: [],
        },
      ],
    };

    const receipt = await publishFocusedCanvasContext({
      context,
      overviewSnapshotDataUrl: "data:image/png;base64,BAUG",
      focusedImages: [
        { imageId: "image-a", originalImageDataUrl: "data:image/jpeg;base64,AQID" },
        { imageId: "image-b", originalImageDataUrl: "data:image/png;base64,BAUG" },
      ],
    });

    expect(receipt.status).toBe("FOCUSED");
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({
      version: 1,
      status: "focused",
      context: { focusImages: [{ imageId: "image-a" }, { imageId: "image-b" }] },
      overviewSnapshot: { dataUrl: "data:image/png;base64,BAUG" },
      focusImages: [
        { imageId: "image-a", originalImage: { dataUrl: "data:image/jpeg;base64,AQID" } },
        { imageId: "image-b", originalImage: { dataUrl: "data:image/png;base64,BAUG" } },
      ],
    });
  });

  it("通过一次性令牌原子发布当前上下文", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          token: "token-a",
          expiresAt: "2026-07-27T12:00:30.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          revision: "revision-a",
          status: "READY",
          receivedAt: "2026-07-27T12:00:01.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context: CodexVisualContext = {
      format: "ai-canvas-codex-visual-context",
      version: 1,
      generatedAt: "2026-07-27T12:00:00.000Z",
      document: { id: "document-a", title: "客厅方案" },
      originalImage: {
        imageId: "image-a",
        fileId: "file-a",
        name: "living-room.jpg",
        mimeType: "image/jpeg",
        naturalWidth: 3000,
        naturalHeight: 2000,
        pixelsAvailable: true,
      },
      canvasSnapshot: {
        filename: "document-a-canvas.png",
        mimeType: "image/png",
        width: 1600,
        height: 1000,
        bytes: 2345,
      },
      selection: {
        regionId: "region-a",
        imageId: "image-a",
        originalPixelBounds: { x: 10, y: 20, width: 300, height: 200 },
        clippedPixelBounds: { x: 10, y: 20, width: 300, height: 200 },
        normalizedCorners: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.2 },
          { x: 0.1, y: 0.2 },
        ],
        isClipped: false,
        crop: {
          filename: "region-a-crop.png",
          mimeType: "image/png",
          width: 300,
          height: 200,
          bytes: 1234,
        },
      },
      prompt: {
        text: "沙发是否适合改成浅灰色？",
        annotationId: "annotation-a",
        saved: true,
      },
    };

    const receipt = await publishReadyCanvasContext({
      context,
      originalImageDataUrl: "data:image/jpeg;base64,AQID",
      canvasSnapshotDataUrl: "data:image/png;base64,BAUG",
    });

    expect(receipt.status).toBe("READY");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:43127/session",
    );
    const publishOptions = fetchMock.mock.calls[1]?.[1];
    expect(publishOptions?.headers).toMatchObject({
      Authorization: "Bearer token-a",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(publishOptions?.body))).toMatchObject({
      version: 1,
      status: "ready",
      context: {
        originalImage: { imageId: "image-a" },
        selection: { regionId: "region-a", imageId: "image-a" },
        prompt: { text: "沙发是否适合改成浅灰色？" },
      },
      originalImage: {
        encoding: "data-url",
        dataUrl: "data:image/jpeg;base64,AQID",
      },
      canvasSnapshot: {
        encoding: "data-url",
        dataUrl: "data:image/png;base64,BAUG",
      },
    });
  });

  it("由同一个显式入口发布无选区状态", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          token: "token-b",
          expiresAt: "2026-07-27T12:00:30.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          revision: "revision-b",
          status: "NO_ACTIVE_REGION",
          receivedAt: "2026-07-27T12:00:02.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await publishNoActiveRegion({ documentId: "document-a" });

    expect(receipt.status).toBe("NO_ACTIVE_REGION");
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({
      version: 1,
      status: "no_active_region",
      document: { id: "document-a" },
    });
  });

  it("无 ROI 时仍原子发布原图和带标注画布快照", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          token: "token-c",
          expiresAt: "2026-07-27T12:00:30.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 1,
          sessionId: "session-a",
          revision: "revision-c",
          status: "NO_ACTIVE_REGION",
          receivedAt: "2026-07-27T12:00:03.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context: CodexVisualContext = {
      format: "ai-canvas-codex-visual-context",
      version: 1,
      generatedAt: "2026-07-27T12:00:00.000Z",
      document: { id: "document-a", title: "客厅方案" },
      originalImage: {
        imageId: "image-a",
        fileId: "file-a",
        name: "living-room.jpg",
        mimeType: "image/jpeg",
        naturalWidth: 3000,
        naturalHeight: 2000,
        pixelsAvailable: true,
      },
      canvasSnapshot: {
        filename: "document-a-canvas.png",
        mimeType: "image/png",
        width: 1600,
        height: 1000,
        bytes: 2345,
      },
      selection: null,
      prompt: null,
    };

    const receipt = await publishNoActiveRegion({
      context,
      originalImageDataUrl: "data:image/jpeg;base64,AQID",
      canvasSnapshotDataUrl: "data:image/png;base64,BAUG",
    });

    expect(receipt.status).toBe("NO_ACTIVE_REGION");
    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({
      version: 1,
      status: "no_active_region",
      context: { selection: null, prompt: null },
      originalImage: { dataUrl: "data:image/jpeg;base64,AQID" },
      canvasSnapshot: { dataUrl: "data:image/png;base64,BAUG" },
    });
  });

  it("拒绝不完整或语义矛盾的画布快照发布", async () => {
    const noRegionContext: CodexVisualContext = {
      format: "ai-canvas-codex-visual-context",
      version: 1,
      generatedAt: "2026-07-27T12:00:00.000Z",
      document: { id: "document-a", title: "客厅方案" },
      originalImage: {
        imageId: "image-a",
        fileId: "file-a",
        name: "living-room.jpg",
        mimeType: "image/jpeg",
        naturalWidth: 3000,
        naturalHeight: 2000,
        pixelsAvailable: true,
      },
      canvasSnapshot: {
        filename: "document-a-canvas.png",
        mimeType: "image/png",
        width: 1600,
        height: 1000,
        bytes: 2345,
      },
      selection: null,
      prompt: null,
    };

    await expect(
      publishNoActiveRegion({
        context: noRegionContext,
        originalImageDataUrl: "data:image/jpeg;base64,AQID",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_PUBLISH_INPUT" });

    await expect(
      publishReadyCanvasContext({
        context: noRegionContext,
        originalImageDataUrl: "data:image/jpeg;base64,AQID",
        canvasSnapshotDataUrl: "data:image/png;base64,BAUG",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PUBLISH_INPUT" });
  });
});
