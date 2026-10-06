import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BridgeProtocolError, createCanonicalContextReader } from "./canvas-context-mcp-core.mjs";

const CAPABILITY_VERSION = 1;
const DEFAULT_CAPABILITY_FILENAME = "ai-canvas-bridge-capability.json";
const DEFAULT_CONTROL_CAPABILITY_FILENAME = "ai-canvas-bridge-control.json";

const unavailable = (message) =>
  new BridgeProtocolError(
    503,
    "BRIDGE_UNAVAILABLE",
    `BRIDGE_UNAVAILABLE：${message}`,
  );

const validCapability = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw unavailable("本机桥接能力描述无效。请先启动独立桥接服务。");
  }
  if (
    value.version !== CAPABILITY_VERSION ||
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.readToken !== "string" ||
    !value.readToken ||
    typeof value.baseUrl !== "string" ||
    !value.baseUrl
  ) {
    throw unavailable("本机桥接能力描述不完整。请重新启动独立桥接服务。");
  }
  let url;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw unavailable("本机桥接能力描述中的地址无效。");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.port
  ) {
    throw unavailable("本机桥接能力描述未指向允许的回环服务。");
  }
  return Object.freeze({
    version: CAPABILITY_VERSION,
    sessionId: value.sessionId,
    readToken: value.readToken,
    baseUrl: url.origin,
  });
};

const validControlCapability = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw unavailable("本机桥接控制描述无效。请先启动独立桥接服务。");
  }
  if (
    value.version !== CAPABILITY_VERSION ||
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.controlToken !== "string" ||
    !value.controlToken ||
    typeof value.baseUrl !== "string" ||
    !value.baseUrl
  ) {
    throw unavailable("本机桥接控制描述不完整。请重新启动独立桥接服务。");
  }
  let url;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw unavailable("本机桥接控制描述中的地址无效。");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.port
  ) {
    throw unavailable("本机桥接控制描述未指向允许的回环服务。");
  }
  return Object.freeze({
    version: CAPABILITY_VERSION,
    sessionId: value.sessionId,
    controlToken: value.controlToken,
    baseUrl: url.origin,
  });
};

export const resolveBridgeCapabilityPath = ({
  cwd = process.cwd(),
  env = process.env,
} = {}) => {
  const configured = env.AI_CANVAS_BRIDGE_CAPABILITY_FILE;
  return resolve(
    cwd,
    typeof configured === "string" && configured.trim()
      ? configured
      : `temp/${DEFAULT_CAPABILITY_FILENAME}`,
  );
};

export const resolveBridgeControlCapabilityPath = ({
  cwd = process.cwd(),
  env = process.env,
} = {}) => {
  const configured = env.AI_CANVAS_BRIDGE_CONTROL_FILE;
  return resolve(
    cwd,
    typeof configured === "string" && configured.trim()
      ? configured
      : `temp/${DEFAULT_CONTROL_CAPABILITY_FILENAME}`,
  );
};

export const readBridgeCapability = async (capabilityPath) => {
  try {
    return validCapability(JSON.parse(await readFile(capabilityPath, "utf8")));
  } catch (error) {
    if (error instanceof BridgeProtocolError) {
      throw error;
    }
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw unavailable("本机桥接服务未运行，当前按需 MCP 无可读取上下文。");
    }
    throw unavailable("无法读取本机桥接能力描述。请重新启动独立桥接服务。");
  }
};

export const readBridgeControlCapability = async (capabilityPath) => {
  try {
    return validControlCapability(JSON.parse(await readFile(capabilityPath, "utf8")));
  } catch (error) {
    if (error instanceof BridgeProtocolError) {
      throw error;
    }
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw unavailable("本机桥接服务未运行，当前没有可停止的服务。");
    }
    throw unavailable("无法读取本机桥接控制描述。请重新启动独立桥接服务。");
  }
};

export const writeBridgeCapability = async ({
  capabilityPath,
  baseUrl,
  sessionId,
  readToken,
}) => {
  const descriptor = validCapability({
    version: CAPABILITY_VERSION,
    baseUrl,
    sessionId,
    readToken,
  });
  await mkdir(dirname(capabilityPath), { recursive: true });
  const temporaryPath = `${capabilityPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(descriptor)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, capabilityPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return descriptor;
};

export const writeBridgeControlCapability = async ({
  capabilityPath,
  baseUrl,
  sessionId,
  controlToken,
}) => {
  const descriptor = validControlCapability({
    version: CAPABILITY_VERSION,
    baseUrl,
    sessionId,
    controlToken,
  });
  await mkdir(dirname(capabilityPath), { recursive: true });
  const temporaryPath = `${capabilityPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(descriptor)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, capabilityPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return descriptor;
};

export const removeBridgeCapability = async ({
  capabilityPath,
  sessionId,
  readToken,
}) => {
  try {
    const current = await readBridgeCapability(capabilityPath);
    if (current.sessionId === sessionId && current.readToken === readToken) {
      await rm(capabilityPath, { force: true });
    }
  } catch (error) {
    if (!(error instanceof BridgeProtocolError)) {
      throw error;
    }
  }
};

export const removeBridgeControlCapability = async ({
  capabilityPath,
  sessionId,
  controlToken,
}) => {
  try {
    const current = await readBridgeControlCapability(capabilityPath);
    if (
      current.sessionId === sessionId &&
      current.controlToken === controlToken
    ) {
      await rm(capabilityPath, { force: true });
    }
  } catch (error) {
    if (!(error instanceof BridgeProtocolError)) {
      throw error;
    }
  }
};

export const createBridgeSnapshotReader = ({
  capabilityPath,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
}) => {
  if (typeof capabilityPath !== "string" || !capabilityPath) {
    throw new TypeError("capabilityPath 必须是非空字符串。");
  }
  return async () => {
    const capability = await readBridgeCapability(capabilityPath);
    try {
      return await createCanonicalContextReader({
        baseUrl: capability.baseUrl,
        readToken: capability.readToken,
        fetchImpl,
        timeoutMs,
      })();
    } catch (error) {
      if (error instanceof BridgeProtocolError) {
        throw unavailable(
          `本机桥接服务不可达、已停止或已更换会话（${error.code}）。`,
        );
      }
      throw unavailable("本机桥接服务不可达或已停止。");
    }
  };
};
