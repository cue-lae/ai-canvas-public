import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  createBridgeHttpServer,
  createBridgeState,
  DEFAULT_LIMITS,
} from "./canvas-context-mcp-core.mjs";
import {
  removeBridgeCapability,
  removeBridgeControlCapability,
  resolveBridgeCapabilityPath,
  resolveBridgeControlCapabilityPath,
  writeBridgeCapability,
  writeBridgeControlCapability,
} from "./canvas-context-bridge-runtime.mjs";

const host = "127.0.0.1";
const port = Number.parseInt(
  process.env.AI_CANVAS_BRIDGE_PORT ?? "43127",
  10,
);
const allowedOrigins = (
  process.env.AI_CANVAS_ALLOWED_ORIGINS ??
  "http://127.0.0.1:4173,http://127.0.0.1:5173,https://appassets.local"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const state = createBridgeState({
  allowedOrigins,
  limits: {
    ...DEFAULT_LIMITS,
    tokenTtlMs: Number.parseInt(
      process.env.AI_CANVAS_TOKEN_TTL_MS ?? "30000",
      10,
    ),
    snapshotTtlMs: Number.parseInt(
      process.env.AI_CANVAS_SNAPSHOT_TTL_MS ?? "900000",
      10,
    ),
    maxRequestBytes: Number.parseInt(
      process.env.AI_CANVAS_MAX_REQUEST_BYTES ?? "52428800",
      10,
    ),
    maxImageBytes: Number.parseInt(
      process.env.AI_CANVAS_MAX_IMAGE_BYTES ?? "10485760",
      10,
    ),
  },
});
const capabilityPath = resolveBridgeCapabilityPath();
const controlCapabilityPath = resolveBridgeControlCapabilityPath();
const controlToken = randomUUID();
let shuttingDown = false;

const exitFailure = (error) => {
  console.error(`AI Canvas bridge service failed: ${error.message}`);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
};

const removeCapabilities = async () => {
  await Promise.all([
    removeBridgeCapability({
      capabilityPath,
      sessionId: state.sessionId,
      readToken: state.getMcpReadToken(),
    }),
    removeBridgeControlCapability({
      capabilityPath: controlCapabilityPath,
      sessionId: state.sessionId,
      controlToken,
    }),
  ]);
};

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  httpServer.close(async () => {
    try {
      await removeCapabilities();
      process.exit(0);
    } catch (error) {
      exitFailure(error);
    }
  });
};

const httpServer = createBridgeHttpServer(state, {
  controlToken,
  onShutdown: shutdown,
});

httpServer.on("error", exitFailure);
httpServer.listen(port, host, async () => {
  try {
    await writeBridgeControlCapability({
      capabilityPath: controlCapabilityPath,
      baseUrl: `http://${host}:${port}`,
      sessionId: state.sessionId,
      controlToken,
    });
    await writeBridgeCapability({
      capabilityPath,
      baseUrl: `http://${host}:${port}`,
      sessionId: state.sessionId,
      readToken: state.getMcpReadToken(),
    });
    console.error(
      `AI Canvas bridge service listening on http://${host}:${port} for session ${state.sessionId}`,
    );
  } catch (error) {
    await removeCapabilities().catch(() => undefined);
    exitFailure(error);
  }
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
