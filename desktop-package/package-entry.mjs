import { packageProfile, applyPackageEnvironment, readOwnedCapability, packageInactive, stopPackageBridge } from './package-policy.mjs';

try {
  const profile = await packageProfile();
  applyPackageEnvironment(profile);
  const mode = process.argv[2] ?? 'mcp';
  if (mode === 'bridge') await import('./canvas-context-bridge.mjs');
  else if (mode === 'status') process.exitCode = await packageInactive(profile) ? 0 : 1;
  else if (mode === 'stop') await stopPackageBridge(profile);
  else if (mode === 'mcp') {
    const { createMcpMessageHandler, BridgeProtocolError } = await import('./canvas-context-mcp-core.mjs');
    const { createBridgeSnapshotReader } = await import('./canvas-context-bridge-runtime.mjs');
    const reader = createBridgeSnapshotReader({ capabilityPath: profile.capability, timeoutMs: 5000 });
    const handle = createMcpMessageHandler({ readSnapshot: async () => {
      try { await readOwnedCapability(profile.capability); }
      catch { throw new BridgeProtocolError(503, 'BRIDGE_UNAVAILABLE', 'BRIDGE_UNAVAILABLE：请先打开 AI Canvas 并主动点击 Codex Read；未回退到开发连接。'); }
      return reader();
    } });
    let buffer = '', queue = Promise.resolve();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { process.stderr.write('MCP input too large.\n'); process.exit(1); }
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        queue = queue.then(async () => {
          let request; try { request = JSON.parse(line); } catch { return; }
          const result = await handle(request);
          if (result) process.stdout.write(JSON.stringify(result) + '\n');
        }).catch(() => { process.stderr.write('MCP request failed.\n'); process.exitCode = 1; });
      }
    });
  } else throw new Error('Unknown package action.');
} catch (error) {
  process.stderr.write(`AI Canvas: ${error.message}\n`);
  process.exitCode = 1;
}
