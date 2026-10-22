import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtime = resolve(packageRoot, "runtime", "node-v22.23.2-win-x64", "node.exe");
const server = resolve(packageRoot, "app", "package-mcp.mjs");
const timeoutMs = 12_000;
const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ai-canvas-local-skills-fallback", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_canvas_context", arguments: { includeImage: true } },
  },
];

const fail = (message) => {
  throw new Error(message);
};

const run = () => new Promise((resolveResult, reject) => {
  const child = spawn(runtime, [server], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let finalResponse = null;
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill();
    reject(new Error("fallback MCP 请求超时。"));
  }, timeoutMs);
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolveResult(value);
  };
  child.once("error", (error) => finish(error));
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try { response = JSON.parse(line); } catch { finish(new Error("fallback MCP 返回了无效 JSON。")); return; }
      if (response.id === 1 && response.error) { finish(new Error("fallback MCP initialize 失败。")); return; }
      if (response.id === 2) {
        const tools = response.result?.tools;
        if (!Array.isArray(tools) || tools.length !== 1 || tools[0]?.name !== "get_canvas_context") {
          finish(new Error("fallback MCP 工具清单不符合只读合同。"));
          return;
        }
      }
      if (response.id === 3) finalResponse = response;
    }
    if (finalResponse) child.stdin.end();
  });
  child.once("exit", (code) => {
    if (!finalResponse) {
      finish(new Error(`fallback MCP 未返回 get_canvas_context：${stderr.trim() || `exit=${code}`}`));
      return;
    }
    if (code !== 0) {
      finish(new Error(`fallback MCP 进程异常退出：${stderr.trim() || `exit=${code}`}`));
      return;
    }
    finish(null, finalResponse);
  });
  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
});

try {
  const response = await run();
  process.stdout.write(`${JSON.stringify(response)}\n`);
  const expectedUnavailable = response.error?.code === -32001 && /BRIDGE_UNAVAILABLE|NOT_PUBLISHED|NO_ACTIVE_REGION/.test(response.error.message ?? "");
  process.exitCode = response.error && !expectedUnavailable ? 1 : 0;
} catch (error) {
  process.stderr.write(`FALLBACK_READ_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
