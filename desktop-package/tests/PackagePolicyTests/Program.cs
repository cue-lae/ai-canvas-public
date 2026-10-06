using System.Diagnostics;
using System.Text.Json;
using AiCanvas.WebViewHost;

var root = Path.Combine(Path.GetFullPath(args[0]), "temp", "desktop-test-installer-20260927", "policy-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var checks = 0;
void Check(bool ok, string name) { if (!ok) throw new Exception(name); checks++; }
void Reject(Action action, string name) { try { action(); } catch { checks++; return; } throw new Exception(name); }
var app = Path.Combine(root, "app"); Directory.CreateDirectory(app);
var parentDist = Path.Combine(root, "dist"); Directory.CreateDirectory(parentDist); File.WriteAllText(Path.Combine(parentDist, "index.html"), "developer");
Check(InstalledPackagePolicy.Enabled, "package compile flag");
Reject(() => HostPaths.ResolveDistRoot(parentDist, app), "must not fall back to configured or ancestor dist");
File.WriteAllText(Path.Combine(app, "installed-package.json"), "{\"id\":\"wrong\",\"port\":43129}");
Reject(() => InstalledPackagePolicy.ResolveRoot(app), "wrong manifest");
File.WriteAllText(Path.Combine(app, "installed-package.json"), "{\"id\":\"ai-canvas-desktop-test\",\"port\":43129}");
Reject(() => InstalledPackagePolicy.ResolveRoot(app), "missing payload");
foreach (var file in new[] { "dist/index.html", "runtime/node.exe", "scripts/package-entry.mjs" }) {
    var target = Path.Combine(app, file); Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.WriteAllText(target, "test");
}
Check(HostPaths.ResolveDistRoot(parentDist, app) == Path.Combine(app, "dist"), "exact installed root");
var start = new ProcessStartInfo();
start.Environment["AI_CANVAS_DIST_ROOT"] = parentDist;
start.Environment["AI_CANVAS_BRIDGE_PORT"] = "43127";
start.Environment["NODE_OPTIONS"] = "--require developer.js";
start.Environment["NODE_PATH"] = root;
InstalledPackagePolicy.Configure(start);
Check(!start.Environment.ContainsKey("AI_CANVAS_DIST_ROOT") && !start.Environment.ContainsKey("NODE_OPTIONS") && !start.Environment.ContainsKey("NODE_PATH"), "strip development overrides");
Check(start.Environment["AI_CANVAS_BRIDGE_PORT"] == "43129", "dedicated endpoint");
Check(start.Environment["AI_CANVAS_BRIDGE_CAPABILITY_FILE"] == InstalledPackagePolicy.CapabilityFile, "dedicated capability");
var capability = Path.Combine(root, "capability.json");
Check(!InstalledPackagePolicy.OwnsSession("s", capability), "missing identity rejected");
File.WriteAllText(capability, JsonSerializer.Serialize(new { version = 1, sessionId = "s", baseUrl = "http://127.0.0.1:43127" }));
Check(!InstalledPackagePolicy.OwnsSession("s", capability), "development endpoint rejected");
File.WriteAllText(capability, JsonSerializer.Serialize(new { version = 1, sessionId = "s", baseUrl = "http://127.0.0.1:43129" }));
Check(!InstalledPackagePolicy.OwnsSession("other", capability), "other session rejected");
Check(InstalledPackagePolicy.OwnsSession("s", capability), "owned session accepted");
Console.WriteLine($"PackagePolicyTests: {checks} checks passed.");
