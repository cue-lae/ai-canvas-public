import process from "node:process";
import { createMcpMessageHandler } from "./canvas-context-mcp-core.mjs";
import {
  createBridgeSnapshotReader,
  resolveBridgeCapabilityPath,
} from "./canvas-context-bridge-runtime.mjs";

const timeoutMs = Number.parseInt(
  process.env.AI_CANVAS_MCP_READ_TIMEOUT_MS ?? "5000",
  10,
);
const readSnapshot = createBridgeSnapshotReader({
  capabilityPath: resolveBridgeCapabilityPath(),
  timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000,
});
const handleMcpMessage = createMcpMessageHandler({ readSnapshot });

let inputBuffer = "";
let messageQueue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split(/\r?\n/);
  inputBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    messageQueue = messageQueue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const response = await handleMcpMessage(message);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
  }
});
