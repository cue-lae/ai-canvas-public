import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeEntrypoint = resolve(projectRoot, "scripts/canvas-context-bridge.mjs");
const bridgeStopEntrypoint = resolve(
  projectRoot,
  "scripts/canvas-context-bridge-stop.mjs",
);
const viteEntrypoint = resolve(projectRoot, "node_modules/vite/bin/vite.js");

const parsePort = (value, fallback, name) => {
  const port = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的端口。`);
  }
  return port;
};

const bridgePort = parsePort(
  process.env.AI_CANVAS_BRIDGE_PORT,
  "43127",
  "AI_CANVAS_BRIDGE_PORT",
);
const vitePort = parsePort(
  process.env.AI_CANVAS_VITE_PORT,
  "5173",
  "AI_CANVAS_VITE_PORT",
);

const spawnChild = (entrypoint, args = [], onOutput) => {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      process.stderr.write(chunk);
      onOutput?.(chunk);
    });
  }
  return child;
};

const waitForClose = async (child, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    once(child, "close"),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("子进程未在限定时间内退出。")), timeoutMs);
    }),
  ]);
};

let bridgeReady = false;
let previewReady = false;
let browserOpened = false;
const maybeOpenBrowser = () => {
  if (
    browserOpened ||
    !bridgeReady ||
    !previewReady ||
    process.env.AI_CANVAS_OPEN_BROWSER === "0"
  ) {
    return;
  }
  browserOpened = true;
  const url = `http://127.0.0.1:${vitePort}/`;
  const command = process.platform === "win32" ? "rundll32.exe" : "open";
  const args =
    process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", url]
      : [url];
  const browser = spawn(command, args, { detached: true, stdio: "ignore" });
  browser.once("error", (error) => {
    browserOpened = false;
    process.stderr.write(
      `AI Canvas browser launch failed for ${url}: ${error.message}\n`,
    );
  });
  browser.once("spawn", () => {
    process.stderr.write(`AI Canvas requested browser opening for ${url}.\n`);
  });
  browser.once("close", (code) => {
    if (code !== 0) {
      browserOpened = false;
      process.stderr.write(
        `AI Canvas browser launcher exited unexpectedly (code ${code}).\n`,
      );
    }
  });
  browser.unref();
};

const bridge = spawnChild(bridgeEntrypoint, [], (chunk) => {
  if (chunk.includes("AI Canvas bridge service listening")) {
    bridgeReady = true;
    maybeOpenBrowser();
  }
});
const preview = spawnChild(viteEntrypoint, [
  "--host",
  "127.0.0.1",
  "--port",
  String(vitePort),
  "--strictPort",
], (chunk) => {
  if (chunk.includes("ready in")) {
    previewReady = true;
    maybeOpenBrowser();
  }
});
let shuttingDown = false;

const stopPreview = async () => {
  if (preview.exitCode !== null || preview.signalCode !== null) {
    return;
  }
  preview.kill("SIGTERM");
  await waitForClose(preview);
};

const stopBridgeGracefully = async () => {
  if (bridge.exitCode !== null || bridge.signalCode !== null) {
    return;
  }
  const stop = spawnChild(bridgeStopEntrypoint);
  await waitForClose(stop);
  if (stop.exitCode !== 0) {
    throw new Error("AI Canvas bridge 优雅关闭失败。");
  }
  await waitForClose(bridge);
};

const shutdown = async (exitCode) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopBridgeGracefully();
  } catch (error) {
    process.stderr.write(
      `AI Canvas bridge graceful shutdown failed: ${
        error instanceof Error ? error.message : "未知错误"
      }\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      await stopPreview();
    } catch (error) {
      process.stderr.write(
        `AI Canvas preview shutdown failed: ${
          error instanceof Error ? error.message : "未知错误"
        }\n`,
      );
      process.exitCode = 1;
    }
  }
  if (process.exitCode === undefined) {
    process.exitCode = exitCode;
  }
};

bridge.once("error", (error) => {
  process.stderr.write(`AI Canvas bridge start failed: ${error.message}\n`);
  void shutdown(1);
});
preview.once("error", (error) => {
  process.stderr.write(`AI Canvas preview start failed: ${error.message}\n`);
  void shutdown(1);
});
bridge.once("close", (code) => {
  if (!shuttingDown) {
    if (code === 0) {
      process.stderr.write("AI Canvas bridge stopped; closing preview.\n");
      void shutdown(0);
    } else {
      process.stderr.write(`AI Canvas bridge exited unexpectedly (code ${code}).\n`);
      void shutdown(1);
    }
  }
});
preview.once("close", (code) => {
  if (!shuttingDown) {
    process.stderr.write(`AI Canvas preview exited unexpectedly (code ${code}).\n`);
    void shutdown(1);
  }
});

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

process.stderr.write(
  `AI Canvas local session starting: bridge http://127.0.0.1:${bridgePort} and preview http://127.0.0.1:${vitePort}\n`,
);
