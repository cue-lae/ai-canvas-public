import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as requestHttp } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BridgeProtocolError,
  DEFAULT_LIMITS,
  buildMcpToolResult,
  createBridgeHttpServer,
  createBridgeState,
  createCanonicalContextReader,
  createMcpMessageHandler,
} from "./canvas-context-mcp-core.mjs";
import {
  createBridgeSnapshotReader,
  readBridgeCapability,
  readBridgeControlCapability,
} from "./canvas-context-bridge-runtime.mjs";

const origin = "http://127.0.0.1:4173";
const tinyJpeg = "data:image/jpeg;base64,AQIDBA==";
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3XQAAAABJRU5ErkJggg==";
const tinyPngBytes = Buffer.from(tinyPng.split(",")[1], "base64").byteLength;

const requestPublishedChunks = ({ baseUrl, token, chunks, contentLength }) =>
  new Promise((resolve, reject) => {
    const target = new URL("/publish", baseUrl);
    const request = requestHttp({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: origin,
        ...(contentLength === undefined
          ? { "Transfer-Encoding": "chunked" }
          : { "Content-Length": String(contentLength) }),
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve({ response, body, payload: body ? JSON.parse(body) : undefined });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    void (async () => {
      try {
        for (const chunk of chunks) {
          if (!request.write(chunk)) await once(request, "drain");
        }
        request.end();
      } catch (error) {
        request.destroy();
        reject(error);
      }
    })();
  });

const requestDeclaredOverHeader = ({ baseUrl, token, contentLength }) =>
  new Promise((resolve, reject) => {
    const target = new URL(baseUrl);
    let settled = false;
    let raw = "";
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(raw);
    };
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port),
    }, () => {
      socket.write([
        "POST /publish HTTP/1.1",
        `Host: ${target.host}`,
        `Authorization: Bearer ${token}`,
        "Content-Type: application/json",
        `Origin: ${origin}`,
        `Content-Length: ${contentLength}`,
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
    });
    const timeout = setTimeout(
      () => fail(new Error("声明超限请求未在短超时内返回 413。")),
      1_000,
    );
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
      if (/^HTTP\/1\.1 413\b/m.test(raw) && raw.includes("REQUEST_TOO_LARGE")) {
        succeed();
      }
    });
    socket.once("error", fail);
    socket.once("close", () => {
      if (!settled) fail(new Error(`声明超限请求收到无效响应：${raw}`));
    });
  });

const sizedJsonChunks = (totalBytes) => {
  const prefix = Buffer.from('{"version":1,"publishedAt":"2026-08-29T00:00:00.000Z","status":"no_active_region","document":{"id":"');
  const suffix = Buffer.from('"}}');
  const fillerBytes = totalBytes - prefix.byteLength - suffix.byteLength;
  if (fillerBytes < 0) throw new Error("请求体目标长度过小。");
  const filler = Buffer.alloc(Math.min(fillerBytes, 1024 * 1024), 0x78);
  const chunks = [prefix];
  let remaining = fillerBytes;
  while (remaining > 0) {
    chunks.push(filler.subarray(0, Math.min(filler.byteLength, remaining)));
    remaining -= Math.min(filler.byteLength, remaining);
  }
  chunks.push(suffix);
  return chunks;
};

test("默认承载量升级为 50MiB 请求与 4MiB 画布快照，且原图与重点规则不变", async () => {
  assert.equal(DEFAULT_LIMITS.maxRequestBytes, 50 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxCanvasSnapshotBytes, 4 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxImageBytes, 10 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxFocusedImages, 4);
  assert.equal(DEFAULT_LIMITS.maxFocusedImageBytes, 6 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxFocusedImagesTotalBytes, 6 * 1024 * 1024);
  const bridgeEntrypoint = await readFile(
    fileURLToPath(new URL("./canvas-context-bridge.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(
    bridgeEntrypoint,
    /AI_CANVAS_MAX_REQUEST_BYTES \?\? "52428800"/,
  );
});

test("/publish 真实读体接受精确 50MiB，拒绝声明或分块累计超过上限", async (t) => {
  const state = createBridgeState();
  const { server, baseUrl } = await startBridge(state);
  t.after(() => close(server));
  const issueToken = async () => {
    const session = await requestJson(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ version: 1 }),
    });
    assert.equal(session.response.status, 200);
    return session.payload.token;
  };
  const exactBytes = 50 * 1024 * 1024;
  const exactChunks = sizedJsonChunks(exactBytes);
  assert.equal(
    exactChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    exactBytes,
  );
  const exact = await requestPublishedChunks({
    baseUrl,
    token: await issueToken(),
    chunks: exactChunks,
    contentLength: exactBytes,
  });
  assert.notEqual(exact.response.statusCode, 413);
  assert.equal(exact.response.statusCode, 400);
  assert.notEqual(exact.body, "");
  assert.equal(exact.payload.error.code, "INVALID_PAYLOAD");

  const declaredOver = await requestDeclaredOverHeader({
    baseUrl,
    token: await issueToken(),
    contentLength: exactBytes + 1,
  });
  assert.match(declaredOver, /^HTTP\/1\.1 413\b/m);
  assert.match(declaredOver, /REQUEST_TOO_LARGE/);

  const chunkedOverChunks = sizedJsonChunks(exactBytes + 1);
  assert.equal(
    chunkedOverChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    exactBytes + 1,
  );
  const chunkedOver = await requestPublishedChunks({
    baseUrl,
    token: await issueToken(),
    chunks: chunkedOverChunks,
  });
  assert.equal(chunkedOver.response.statusCode, 413);
  assert.notEqual(chunkedOver.body, "");
  assert.equal(chunkedOver.payload.error.code, "REQUEST_TOO_LARGE");
});

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("测试桥接未取得 TCP 端口。");
  }
  return address.port;
};

const close = async (server) => {
  server.close();
  await once(server, "close");
};

const startBridge = async (state) => {
  const server = createBridgeHttpServer(state);
  const port = await listen(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
};

const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  return {
    response,
    payload: await response.json(),
  };
};

const runNode = (args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("子进程未在 5 秒内结束。"));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });

const runNodeWithInput = (args, input, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("子进程未在 5 秒内结束。"));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });

const startBridgeService = ({
  port,
  capabilityPath,
  controlCapabilityPath,
}) => {
  const entrypoint = fileURLToPath(
    new URL("./canvas-context-bridge.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_CANVAS_BRIDGE_PORT: String(port),
      AI_CANVAS_ALLOWED_ORIGINS: origin,
      AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath,
      AI_CANVAS_BRIDGE_CONTROL_FILE: controlCapabilityPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, getStderr: () => stderr };
};

const stopBridgeService = ({ capabilityPath, controlCapabilityPath }) => {
  const entrypoint = fileURLToPath(
    new URL("./canvas-context-bridge-stop.mjs", import.meta.url),
  );
  return runNode([entrypoint], {
    AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath,
    AI_CANVAS_BRIDGE_CONTROL_FILE: controlCapabilityPath,
  });
};

const closeChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
};

const readyPayload = (regionId, prompt) => ({
  version: 1,
  status: "ready",
  publishedAt: "2026-07-27T12:00:00.000Z",
  context: {
    format: "ai-canvas-codex-visual-context",
    version: 1,
    generatedAt: "2026-07-27T12:00:00.000Z",
    document: { id: "document-test", title: "客厅方案" },
    originalImage: {
      imageId: "image-test",
      fileId: "file-test",
      name: "living-room.jpg",
      mimeType: "image/jpeg",
      naturalWidth: 3000,
      naturalHeight: 2000,
      pixelsAvailable: true,
      quickAnnotations: [
        {
          quickAnnotationId: "quick-single",
          ordinal: 1,
          label: "Q1",
          imageId: "image-test",
          mode: "point",
          text: "单图快速标注",
          normalizedAnchor: { x: 0.2, y: 0.3 },
          originalPixelAnchor: { x: 600, y: 600 },
        },
      ],
    },
    canvasSnapshot: {
      filename: "annotated-canvas.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
      bytes: tinyPngBytes,
    },
    selection: {
      regionId,
      imageId: "image-test",
      originalPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
      clippedPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
      normalizedCorners: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.1, y: 0.2 },
      ],
      isClipped: false,
      crop: {
        filename: `${regionId}-crop.png`,
        mimeType: "image/png",
        width: 500,
        height: 300,
        bytes: 2345,
      },
    },
    prompt: {
      text: prompt,
      annotationId: `annotation-${regionId}`,
      saved: true,
    },
  },
  originalImage: {
    encoding: "data-url",
    dataUrl: tinyJpeg,
  },
  canvasSnapshot: {
    encoding: "data-url",
    dataUrl: tinyPng,
  },
});

const noActiveRegionSnapshotPayload = () => {
  const payload = readyPayload("region-a", "问题 A");
  return {
    ...payload,
    status: "no_active_region",
    context: {
      ...payload.context,
      selection: null,
      prompt: null,
    },
  };
};

const focusedPayload = () => ({
  version: 1,
  status: "focused",
  publishedAt: "2026-07-31T12:00:00.000Z",
  context: {
    format: "ai-canvas-focused-context",
    version: 1,
    generatedAt: "2026-07-31T12:00:00.000Z",
    document: { id: "document-focus", title: "多图方案" },
    overviewSnapshot: {
      filename: "viewport.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
      bytes: tinyPngBytes,
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
        quickAnnotations: [
          {
            quickAnnotationId: "quick-a",
            ordinal: 1,
            label: "Q1",
            imageId: "image-a",
            mode: "point",
            text: "保留窗框比例",
            normalizedAnchor: { x: 0.25, y: 0.4 },
            originalPixelAnchor: { x: 750, y: 800 },
          },
        ],
        visibleAnnotations: [
          {
            regionId: "region-a",
            originalPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
            clippedPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
            normalizedCorners: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.1 },
              { x: 0.2, y: 0.2 },
              { x: 0.1, y: 0.2 },
            ],
            selectionVisible: true,
            isClipped: false,
            card: { annotationId: "annotation-a", text: "重点 A 的修改指令" },
          },
        ],
      },
      {
        imageId: "image-b",
        fileId: "file-b",
        name: "bedroom.png",
        mimeType: "image/png",
        naturalWidth: 2000,
        naturalHeight: 1500,
        pixelsAvailable: true,
        quickAnnotations: [
          {
            quickAnnotationId: "quick-b",
            ordinal: 2,
            label: "Q2",
            imageId: "image-b",
            mode: "rectangle",
            text: "参考这个范围",
            normalizedAnchor: { x: 0.1, y: 0.2 },
            originalPixelAnchor: { x: 200, y: 300 },
            rectangle: {
              normalizedBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
              originalPixelBounds: { x: 200, y: 300, width: 600, height: 600 },
            },
          },
        ],
        visibleAnnotations: [],
      },
    ],
  },
  overviewSnapshot: {
    encoding: "data-url",
    dataUrl: tinyPng,
  },
  focusImages: [
    {
      imageId: "image-a",
      originalImage: { encoding: "data-url", dataUrl: tinyJpeg },
    },
    {
      imageId: "image-b",
      originalImage: { encoding: "data-url", dataUrl: tinyPng },
    },
  ],
});

const focusedDescriptionPayload = () => {
  const payload = focusedPayload();
  payload.context.focusImages[0].visibleAnnotations[0].card = null;
  payload.context.descriptions = [
    {
      descriptionId: "description-canvas",
      text: "整张画布保持暖白色温",
      reference: { x: 40, y: 60 },
      referenceUrl: "https://example.com/material-reference",
    },
    {
      descriptionId: "description-scoped",
      text: "两个范围使用同一种浅灰材质",
      reference: { x: 240, y: 180 },
    },
  ];
  payload.context.descriptionScopes = [
    {
      regionId: "region-a",
      imageId: "image-a",
      originalPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
      clippedPixelBounds: { x: 100, y: 120, width: 500, height: 300 },
      normalizedCorners: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.1, y: 0.2 },
      ],
      isClipped: false,
    },
    {
      regionId: "region-b",
      imageId: "image-b",
      originalPixelBounds: { x: 20, y: 30, width: 200, height: 160 },
      clippedPixelBounds: { x: 20, y: 30, width: 200, height: 160 },
      normalizedCorners: [
        { x: 0.01, y: 0.02 },
        { x: 0.11, y: 0.02 },
        { x: 0.11, y: 0.12 },
        { x: 0.01, y: 0.12 },
      ],
      isClipped: false,
    },
  ];
  payload.context.descriptionScopeLinks = [
    { descriptionId: "description-scoped", regionId: "region-a" },
    { descriptionId: "description-scoped", regionId: "region-b" },
  ];
  return payload;
};

test("一次性短期令牌、来源校验和原子选区切换", () => {
  const state = createBridgeState();
  const firstToken = state.issueToken(origin, 1_000).token;
  const firstReceipt = state.publish({
    origin,
    token: firstToken,
    payload: readyPayload("region-a", "问题 A"),
    now: 2_000,
  });
  assert.equal(firstReceipt.status, "READY");
  assert.equal(state.read(2_001).context.selection.regionId, "region-a");

  assert.throws(
    () =>
      state.publish({
        origin,
        token: firstToken,
        payload: readyPayload("region-b", "问题 B"),
        now: 2_002,
      }),
    (error) =>
      error instanceof BridgeProtocolError && error.code === "TOKEN_INVALID",
  );

  const secondToken = state.issueToken(origin, 3_000).token;
  const secondReceipt = state.publish({
    origin,
    token: secondToken,
    payload: readyPayload("region-b", "问题 B"),
    now: 3_100,
  });
  const switched = state.read(3_101);
  assert.notEqual(secondReceipt.revision, firstReceipt.revision);
  assert.equal(switched.context.selection.regionId, "region-b");
  assert.equal(switched.context.prompt.text, "问题 B");
});

test("旧式 document-only 无选区发布会替换已有快照", () => {
  const state = createBridgeState();
  const readyToken = state.issueToken(origin, 1_000).token;
  state.publish({
    origin,
    token: readyToken,
    payload: readyPayload("region-a", "问题 A"),
    now: 1_100,
  });

  const emptyToken = state.issueToken(origin, 1_200).token;
  state.publish({
    origin,
    token: emptyToken,
    payload: {
      version: 1,
      status: "no_active_region",
      publishedAt: "2026-07-27T12:01:00.000Z",
      document: { id: "document-test" },
    },
    now: 1_300,
  });

  const snapshot = state.read(1_301);
  assert.equal(snapshot.status, "NO_ACTIVE_REGION");
  assert.equal(snapshot.document.id, "document-test");
  assert.equal(buildMcpToolResult(snapshot, true).content.length, 1);
});

test("拒绝非允许来源和超限图片", () => {
  const state = createBridgeState({
    limits: {
      tokenTtlMs: 30_000,
      snapshotTtlMs: 60_000,
      maxRequestBytes: 1_024,
      maxImageBytes: 3,
      maxPromptCharacters: 100,
    },
  });
  assert.throws(
    () => state.issueToken("http://localhost:4173"),
    (error) =>
      error instanceof BridgeProtocolError && error.code === "ORIGIN_DENIED",
  );
  const token = state.issueToken(origin).token;
  assert.throws(
    () =>
      state.publish({
        origin,
        token,
        payload: readyPayload("region-a", "问题 A"),
      }),
    (error) =>
      error instanceof BridgeProtocolError && error.code === "IMAGE_TOO_LARGE",
  );
});

test("拒绝非 PNG、元数据不匹配和超限的画布快照", () => {
  const invalidFormatState = createBridgeState();
  const invalidFormatToken = invalidFormatState.issueToken(origin).token;
  const invalidFormatPayload = readyPayload("region-a", "问题 A");
  invalidFormatPayload.canvasSnapshot.dataUrl = tinyJpeg;
  assert.throws(
    () =>
      invalidFormatState.publish({
        origin,
        token: invalidFormatToken,
        payload: invalidFormatPayload,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "INVALID_CANVAS_SNAPSHOT",
  );

  const mismatchState = createBridgeState();
  const mismatchToken = mismatchState.issueToken(origin).token;
  const mismatchPayload = readyPayload("region-a", "问题 A");
  mismatchPayload.context.canvasSnapshot.width = 2;
  assert.throws(
    () =>
      mismatchState.publish({
        origin,
        token: mismatchToken,
        payload: mismatchPayload,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "CANVAS_SNAPSHOT_MISMATCH",
  );

  const sizeState = createBridgeState({
    limits: { maxCanvasSnapshotBytes: tinyPngBytes - 1 },
  });
  const sizeToken = sizeState.issueToken(origin).token;
  const sizePayload = readyPayload("region-a", "问题 A");
  sizePayload.context.canvasSnapshot.bytes = tinyPngBytes - 1;
  assert.throws(
    () =>
      sizeState.publish({
        origin,
        token: sizeToken,
        payload: sizePayload,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "CANVAS_SNAPSHOT_TOO_LARGE",
  );
});

test("MCP 只暴露 get_canvas_context，并返回原图和画布快照 image 内容", async () => {
  const state = createBridgeState();
  const token = state.issueToken(origin).token;
  state.publish({
    origin,
    token,
    payload: readyPayload("region-a", "问题 A"),
  });
  const handle = createMcpMessageHandler({
    readSnapshot: () => state.read(),
  });

  const listResponse = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.deepEqual(
    listResponse.result.tools.map((tool) => tool.name),
    ["get_canvas_context"],
  );
  assert.equal(
    listResponse.result.tools[0].annotations.readOnlyHint,
    true,
  );

  const toolResult = buildMcpToolResult(state.read(), true);
  assert.equal(toolResult.content.length, 3);
  assert.equal(toolResult.content[1].type, "image");
  assert.equal(toolResult.content[1].mimeType, "image/jpeg");
  assert.equal(toolResult.content[2].type, "image");
  assert.equal(toolResult.content[2].mimeType, "image/png");
  const publicContext = JSON.parse(toolResult.content[0].text);
  assert.equal(publicContext.originalImage.contentIndex, 1);
  assert.equal(publicContext.originalImage.contentBlock, 2);
  assert.equal(publicContext.canvasSnapshot.contentIndex, 2);
  assert.equal(publicContext.canvasSnapshot.contentBlock, 3);
  assert.equal(publicContext.canvasSnapshot.width, 1);
  assert.equal(
    publicContext.context.selection.regionId,
    "region-a",
  );
  assert.equal(
    publicContext.context.originalImage.quickAnnotations[0].text,
    "单图快速标注",
  );

  const callResponse = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_canvas_context",
      arguments: { includeImage: true },
    },
  });
  assert.equal(callResponse.result.content.length, 3);
  assert.equal(
    JSON.parse(callResponse.result.content[0].text).context.selection.regionId,
    "region-a",
  );
});

test("重点多图发布覆盖旧上下文，并按概览、重点 1、重点 2 顺序返回 image 内容", () => {
  const state = createBridgeState();
  const oldToken = state.issueToken(origin).token;
  state.publish({
    origin,
    token: oldToken,
    payload: readyPayload("region-old", "旧问题"),
  });

  const focusToken = state.issueToken(origin).token;
  const receipt = state.publish({
    origin,
    token: focusToken,
    payload: focusedPayload(),
  });
  assert.equal(receipt.status, "FOCUSED");

  const snapshot = state.read();
  assert.equal(snapshot.status, "FOCUSED");
  assert.equal(snapshot.context.focusImages.length, 2);
  assert.equal(snapshot.context.focusImages[0].visibleAnnotations[0].card.text, "重点 A 的修改指令");
  assert.equal(snapshot.context.focusImages[0].quickAnnotations[0].label, "Q1");
  assert.equal(snapshot.context.focusImages[1].quickAnnotations[0].mode, "rectangle");

  const toolResult = buildMcpToolResult(snapshot, true);
  assert.equal(toolResult.content.length, 4);
  assert.equal(toolResult.content[1].mimeType, "image/png");
  assert.equal(toolResult.content[2].mimeType, "image/jpeg");
  assert.equal(toolResult.content[3].mimeType, "image/png");
  const publicContext = JSON.parse(toolResult.content[0].text);
  assert.equal(publicContext.status, "FOCUSED");
  assert.equal(publicContext.overviewSnapshot.contentIndex, 1);
  assert.equal(publicContext.focusImages[0].contentIndex, 2);
  assert.equal(publicContext.focusImages[1].contentIndex, 3);
  assert.equal(
    publicContext.context.focusImages[0].visibleAnnotations[0].card.text,
    "重点 A 的修改指令",
  );
  assert.equal(
    publicContext.context.focusImages[0].quickAnnotations[0].text,
    "保留窗框比例",
  );
});

test("V8 说明扩展原样交接零范围与多个平级范围，且拒绝旧卡片重复正文", () => {
  const state = createBridgeState();
  const payload = focusedDescriptionPayload();
  const receipt = state.publish({
    origin,
    token: state.issueToken(origin).token,
    payload,
  });
  assert.equal(receipt.status, "FOCUSED");

  const snapshot = state.read();
  assert.equal(snapshot.context.descriptions.length, 2);
  assert.equal(snapshot.context.descriptionScopeLinks.length, 2);
  assert.equal(
    snapshot.context.descriptions[0].text,
    "整张画布保持暖白色温",
  );
  assert.equal(
    snapshot.context.descriptions[0].referenceUrl,
    "https://example.com/material-reference",
  );
  assert.equal(
    snapshot.context.descriptionScopeLinks[0].descriptionId,
    "description-scoped",
  );
  assert.equal(snapshot.context.focusImages[0].visibleAnnotations[0].card, null);

  const duplicateText = focusedDescriptionPayload();
  duplicateText.context.focusImages[0].visibleAnnotations[0].card = {
    annotationId: "legacy-annotation",
    text: "不应重复",
  };
  assert.throws(
    () =>
      state.publish({
        origin,
        token: state.issueToken(origin).token,
        payload: duplicateText,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "DUPLICATE_DESCRIPTION_TEXT",
  );

  const invalidReferenceUrl = focusedDescriptionPayload();
  invalidReferenceUrl.context.descriptions[0].referenceUrl =
    "javascript:alert(1)";
  assert.throws(
    () =>
      state.publish({
        origin,
        token: state.issueToken(origin).token,
        payload: invalidReferenceUrl,
      }),
    (error) => error.code === "INVALID_DESCRIPTION_CONTEXT",
  );
});

test("重点发布拒绝数量或图片关联不一致", () => {
  const state = createBridgeState();
  const mismatch = focusedPayload();
  mismatch.focusImages[1].imageId = "wrong-image";
  assert.throws(
    () =>
      state.publish({
        origin,
        token: state.issueToken(origin).token,
        payload: mismatch,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "CONTEXT_RELATION_MISMATCH",
  );

  const overLimitState = createBridgeState({ limits: { maxFocusedImages: 1 } });
  assert.throws(
    () =>
      overLimitState.publish({
        origin,
        token: overLimitState.issueToken(origin).token,
        payload: focusedPayload(),
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "INVALID_FOCUSED_IMAGES",
  );

  const duplicateQuickOrdinal = focusedPayload();
  duplicateQuickOrdinal.context.focusImages[1].quickAnnotations[0].ordinal = 1;
  duplicateQuickOrdinal.context.focusImages[1].quickAnnotations[0].label = "Q1";
  assert.throws(
    () =>
      state.publish({
        origin,
        token: state.issueToken(origin).token,
        payload: duplicateQuickOrdinal,
      }),
    (error) =>
      error instanceof BridgeProtocolError &&
      error.code === "INVALID_QUICK_ANNOTATIONS",
  );
});

test("无活动 ROI 的已发布画布快照仍返回两张 image，且不伪造语义", () => {
  const state = createBridgeState();
  const token = state.issueToken(origin).token;
  state.publish({
    origin,
    token,
    payload: noActiveRegionSnapshotPayload(),
  });

  const snapshot = state.read();
  assert.equal(snapshot.status, "NO_ACTIVE_REGION");
  assert.equal(snapshot.context.selection, null);
  assert.equal(snapshot.context.prompt, null);

  const toolResult = buildMcpToolResult(snapshot, true);
  assert.equal(toolResult.content.length, 3);
  assert.equal(toolResult.content[1].mimeType, "image/jpeg");
  assert.equal(toolResult.content[2].mimeType, "image/png");
  const publicContext = JSON.parse(toolResult.content[0].text);
  assert.equal(publicContext.status, "NO_ACTIVE_REGION");
  assert.equal(publicContext.context.selection, null);
  assert.equal(publicContext.context.prompt, null);
  assert.equal(publicContext.canvasSnapshot.contentIndex, 2);
});

test("canonical MCP 读取只接受无 Origin 的本机能力令牌", async (t) => {
  const owner = createBridgeState();
  const { server, baseUrl } = await startBridge(owner);
  t.after(() => close(server));

  const browserToken = owner.issueToken(origin).token;
  const browserAttempt = await requestJson(`${baseUrl}/mcp/context`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.getMcpReadToken()}`,
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(browserAttempt.response.status, 403);
  assert.equal(browserAttempt.payload.error.code, "MCP_READ_DENIED");
  assert.equal(
    browserAttempt.response.headers.get("access-control-allow-origin"),
    null,
  );

  const publishTokenAttempt = await requestJson(`${baseUrl}/mcp/context`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${browserToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(publishTokenAttempt.response.status, 401);
  assert.equal(publishTokenAttempt.payload.error.code, "MCP_READ_DENIED");

  const canonicalRead = await requestJson(`${baseUrl}/mcp/context`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.getMcpReadToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(canonicalRead.response.status, 200);
  assert.equal(canonicalRead.payload.sessionId, owner.sessionId);
  assert.equal(canonicalRead.payload.reason, "NOT_PUBLISHED");
});

test("独立 MCP 副本经 canonical HTTP 读取唯一监听实例的 ROI、问题和双图", async (t) => {
  const owner = createBridgeState();
  const { server, baseUrl } = await startBridge(owner);
  t.after(() => close(server));

  const token = owner.issueToken(origin).token;
  owner.publish({
    origin,
    token,
    payload: readyPayload("region-canonical", "canonical 问题"),
  });

  const coreModuleUrl = new URL(
    "./canvas-context-mcp-core.mjs",
    import.meta.url,
  ).href;
  const replicaProgram = `
    import {
      createBridgeState,
      createCanonicalContextReader,
      createMcpMessageHandler,
    } from ${JSON.stringify(coreModuleUrl)};
    const localState = createBridgeState();
    const readSnapshot = createCanonicalContextReader({
      baseUrl: process.env.AI_CANVAS_TEST_BASE_URL,
      readToken: process.env.AI_CANVAS_TEST_READ_TOKEN,
    });
    const handle = createMcpMessageHandler({ readSnapshot });
    const response = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_canvas_context",
        arguments: { includeImage: true },
      },
    });
    process.stdout.write(JSON.stringify({ localSessionId: localState.sessionId, response }));
  `;
  const environment = {
    AI_CANVAS_TEST_BASE_URL: baseUrl,
    AI_CANVAS_TEST_READ_TOKEN: owner.getMcpReadToken(),
  };
  const replicas = await Promise.all([
    runNode(["--input-type=module", "--eval", replicaProgram], environment),
    runNode(["--input-type=module", "--eval", replicaProgram], environment),
  ]);

  for (const replica of replicas) {
    assert.equal(replica.code, 0, replica.stderr);
    const result = JSON.parse(replica.stdout);
    assert.notEqual(result.localSessionId, owner.sessionId);
    assert.equal(result.response.error, undefined);
    assert.equal(result.response.result.content.length, 3);
    const context = JSON.parse(result.response.result.content[0].text);
    assert.equal(context.sessionId, owner.sessionId);
    assert.equal(context.context.selection.regionId, "region-canonical");
    assert.equal(context.context.prompt.text, "canonical 问题");
    assert.equal(context.originalImage.contentIndex, 1);
    assert.equal(context.canvasSnapshot.contentIndex, 2);
  }
});

test("canonical 读取失败时 MCP 显式报错且不回退到本地私有 state", async () => {
  const localState = createBridgeState();
  const token = localState.issueToken(origin).token;
  localState.publish({
    origin,
    token,
    payload: readyPayload("region-local", "不应返回"),
  });
  const handle = createMcpMessageHandler({
    readSnapshot: async () => {
      throw new BridgeProtocolError(
        502,
        "CANONICAL_CONTEXT_UNAVAILABLE",
        "唯一监听实例不可达。",
      );
    },
  });

  const response = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_canvas_context", arguments: {} },
  });
  assert.equal(response.result, undefined);
  assert.equal(response.error.code, -32001);
  assert.match(response.error.message, /唯一监听实例不可达/);
});

test("独立桥接服务在端口被占用时退出且不覆盖现有能力描述", async (t) => {
  const blocker = createServer();
  const port = await listen(blocker);
  t.after(() => close(blocker));

  const capabilityDirectory = await mkdtemp(join(tmpdir(), "ai-canvas-bridge-"));
  const capabilityPath = join(capabilityDirectory, "capability.json");
  const controlCapabilityPath = join(
    capabilityDirectory,
    "control-capability.json",
  );
  const existingCapability = "existing canonical bridge capability\n";
  await writeFile(capabilityPath, existingCapability, "utf8");
  t.after(() => rm(capabilityDirectory, { recursive: true, force: true }));

  const entrypoint = fileURLToPath(
    new URL("./canvas-context-bridge.mjs", import.meta.url),
  );
  const child = await runNode([entrypoint], {
    AI_CANVAS_BRIDGE_PORT: String(port),
    AI_CANVAS_ALLOWED_ORIGINS: origin,
    AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath,
    AI_CANVAS_BRIDGE_CONTROL_FILE: controlCapabilityPath,
  });
  assert.equal(child.signal, null);
  assert.equal(child.code, 1, child.stderr);
  assert.match(child.stderr, /AI Canvas bridge service failed/);
  assert.equal(await readFile(capabilityPath, "utf8"), existingCapability);
});

test("bridge 缺失时 stdio adapter 仍可初始化，并清楚返回 BRIDGE_UNAVAILABLE", async (t) => {
  const capabilityDirectory = await mkdtemp(join(tmpdir(), "ai-canvas-adapter-"));
  const capabilityPath = join(capabilityDirectory, "missing-capability.json");
  t.after(() => rm(capabilityDirectory, { recursive: true, force: true }));

  const entrypoint = fileURLToPath(
    new URL("./canvas-context-mcp.mjs", import.meta.url),
  );
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_canvas_context", arguments: { includeImage: false } },
    }),
  ].join("\n");
  const adapter = await runNodeWithInput([entrypoint], `${input}\n`, {
    AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath,
  });

  assert.equal(adapter.code, 0, adapter.stderr);
  const responses = adapter.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.serverInfo.name, "ai-canvas-local-context");
  assert.equal(responses[1].error.code, -32001);
  assert.match(responses[1].error.message, /BRIDGE_UNAVAILABLE/);
});

test("独立服务发布后，按需 stdio adapter 读取 canonical ROI 和双图", async (t) => {
  const capabilityDirectory = await mkdtemp(join(tmpdir(), "ai-canvas-service-"));
  const capabilityPath = join(capabilityDirectory, "capability.json");
  const controlCapabilityPath = join(
    capabilityDirectory,
    "control-capability.json",
  );
  t.after(() => rm(capabilityDirectory, { recursive: true, force: true }));

  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  const service = startBridgeService({
    port,
    capabilityPath,
    controlCapabilityPath,
  });
  t.after(() => closeChild(service.child));

  await waitFor(async () => {
    try {
      const capability = await readBridgeCapability(capabilityPath);
      return capability.baseUrl === `http://127.0.0.1:${port}`;
    } catch {
      return false;
    }
  }, `独立桥接服务未写入能力描述：${service.getStderr()}`);

  const session = await requestJson(`http://127.0.0.1:${port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(session.response.status, 200);
  const publication = await requestJson(`http://127.0.0.1:${port}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.payload.token}`,
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(readyPayload("region-service", "独立服务问题")),
  });
  assert.equal(publication.response.status, 200);

  const adapterEntrypoint = fileURLToPath(
    new URL("./canvas-context-mcp.mjs", import.meta.url),
  );
  const adapter = await runNodeWithInput(
    [adapterEntrypoint],
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_canvas_context", arguments: { includeImage: true } },
    })}\n`,
    { AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath },
  );
  assert.equal(adapter.code, 0, adapter.stderr);
  const response = JSON.parse(adapter.stdout.trim());
  assert.equal(response.error, undefined);
  assert.equal(response.result.content.length, 3);
  const context = JSON.parse(response.result.content[0].text);
  assert.equal(context.sessionId, session.payload.sessionId);
  assert.equal(context.context.selection.regionId, "region-service");
  assert.equal(context.context.prompt.text, "独立服务问题");
  assert.equal(context.originalImage.contentIndex, 1);
  assert.equal(context.canvasSnapshot.contentIndex, 2);
});

test("受控停止会先关闭 TCP 并删除两份能力描述，随后 adapter 报 BRIDGE_UNAVAILABLE", async (t) => {
  const capabilityDirectory = await mkdtemp(join(tmpdir(), "ai-canvas-stop-"));
  const capabilityPath = join(capabilityDirectory, "capability.json");
  const controlCapabilityPath = join(
    capabilityDirectory,
    "control-capability.json",
  );
  t.after(async () => {
    await closeChild(service.child);
    await rm(capabilityDirectory, { recursive: true, force: true });
  });

  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  const service = startBridgeService({
    port,
    capabilityPath,
    controlCapabilityPath,
  });

  await waitFor(async () => {
    try {
      const [readCapability, controlCapability] = await Promise.all([
        readBridgeCapability(capabilityPath),
        readBridgeControlCapability(controlCapabilityPath),
      ]);
      return (
        readCapability.baseUrl === `http://127.0.0.1:${port}` &&
        controlCapability.baseUrl === `http://127.0.0.1:${port}`
      );
    } catch {
      return false;
    }
  }, `独立桥接服务未准备好：${service.getStderr()}`);
  assert.equal(await canConnect(port), true);

  const denied = await requestJson(
    `http://127.0.0.1:${port}/control/shutdown`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer not-the-control-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: 1 }),
    },
  );
  assert.equal(denied.response.status, 401);
  assert.equal(denied.payload.error.code, "CONTROL_DENIED");
  assert.equal(await canConnect(port), true);

  const closed = once(service.child, "close");
  const stopper = await stopBridgeService({
    capabilityPath,
    controlCapabilityPath,
  });
  assert.equal(stopper.code, 0, stopper.stderr);
  assert.equal(stopper.signal, null, stopper.stderr);
  await closed;
  assert.equal(await canConnect(port), false);
  await assert.rejects(() => readBridgeCapability(capabilityPath));
  await assert.rejects(() => readBridgeControlCapability(controlCapabilityPath));

  const adapterEntrypoint = fileURLToPath(
    new URL("./canvas-context-mcp.mjs", import.meta.url),
  );
  const adapter = await runNodeWithInput(
    [adapterEntrypoint],
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_canvas_context", arguments: { includeImage: false } },
    })}\n`,
    { AI_CANVAS_BRIDGE_CAPABILITY_FILE: capabilityPath },
  );
  assert.equal(adapter.code, 0, adapter.stderr);
  const response = JSON.parse(adapter.stdout.trim());
  assert.equal(response.error.code, -32001);
  assert.match(response.error.message, /BRIDGE_UNAVAILABLE/);
});

test("陈旧能力描述只让 adapter 报 BRIDGE_UNAVAILABLE，不会回退到私有 state", async (t) => {
  const capabilityDirectory = await mkdtemp(join(tmpdir(), "ai-canvas-stale-"));
  const capabilityPath = join(capabilityDirectory, "capability.json");
  t.after(() => rm(capabilityDirectory, { recursive: true, force: true }));

  await writeFile(
    capabilityPath,
    JSON.stringify({
      version: 1,
      sessionId: "stale-session",
      readToken: "stale-token",
      baseUrl: "http://127.0.0.1:65530",
    }),
    "utf8",
  );
  const readSnapshot = createBridgeSnapshotReader({
    capabilityPath,
    timeoutMs: 100,
  });
  await assert.rejects(
    readSnapshot(),
    (error) =>
      error instanceof BridgeProtocolError && error.code === "BRIDGE_UNAVAILABLE",
  );
});
