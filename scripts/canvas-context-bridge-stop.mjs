import process from "node:process";
import { access } from "node:fs/promises";
import {
  readBridgeControlCapability,
  resolveBridgeCapabilityPath,
  resolveBridgeControlCapabilityPath,
} from "./canvas-context-bridge-runtime.mjs";

const timeoutMs = Number.parseInt(
  process.env.AI_CANVAS_BRIDGE_STOP_TIMEOUT_MS ?? "5000",
  10,
);
const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000;
const controlCapabilityPath = resolveBridgeControlCapabilityPath();
const capabilityPath = resolveBridgeCapabilityPath();

const exists = async (path) =>
  access(path)
    .then(() => true)
    .catch(() => false);

const waitForCleanup = async () => {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!(await exists(controlCapabilityPath)) && !(await exists(capabilityPath))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("桥接服务未在限定时间内完成受控关闭。");
};

const stop = async () => {
  const control = await readBridgeControlCapability(controlCapabilityPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), waitMs);
  try {
    const response = await fetch(`${control.baseUrl}/control/shutdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${control.controlToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: 1 }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`桥接受控关闭被拒绝（HTTP ${response.status}）。`);
    }
    await response.text();
    await waitForCleanup();
  } finally {
    clearTimeout(timeout);
  }
};

stop()
  .then(() => {
    process.stderr.write("AI Canvas bridge service stopped gracefully.\n");
  })
  .catch((error) => {
    process.stderr.write(
      `AI Canvas bridge graceful shutdown failed: ${
        error instanceof Error ? error.message : "未知错误"
      }\n`,
    );
    process.exitCode = 1;
  });
