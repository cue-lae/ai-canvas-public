using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using AiCanvas.WebViewHost;

var projectRoot = Path.GetFullPath(args[0]);
var testRoot = Path.Combine(projectRoot, "temp", "canvas-bridge-reconnect-20260927", "native-test");
Directory.CreateDirectory(testRoot);
var count = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); count++; }
int FreePort() { var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop(); return port; }
using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(40));

async Task WithServer(string body, int status, Func<BridgeServiceController, string, Task> verify)
{
    var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    Environment.SetEnvironmentVariable("AI_CANVAS_BRIDGE_PORT", port.ToString());
    var serve = Task.Run(async () => {
        using var client = await listener.AcceptTcpClientAsync(timeout.Token);
        using var stream = client.GetStream();
        var buffer = new byte[2048];
        var received = await stream.ReadAsync(buffer, timeout.Token);
        Check(Encoding.UTF8.GetString(buffer, 0, received).Contains("Origin: https://appassets.local"), "origin header");
        var bytes = Encoding.UTF8.GetBytes(body);
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n"), timeout.Token);
        await stream.WriteAsync(bytes, timeout.Token);
    });
    try { using var controller = new BridgeServiceController(testRoot); await verify(controller, $"http://127.0.0.1:{port}"); await serve; }
    finally { listener.Stop(); }
}
await WithServer("{\"version\":1,\"sessionId\":\"test\",\"token\":\"test-only\"}", 200,
    async (controller, address) => Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "READY", "reuse protocol-ready service"));
await WithServer("{\"version\":99}", 200,
    async (controller, address) => Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "INCOMPATIBLE", "do not replace unrelated service"));
await WithServer("{}", 403,
    async (controller, address) => Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "ORIGIN_DENIED", "preserve origin policy"));
await WithServer("{}", 302,
    async (controller, address) => Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "INCOMPATIBLE", "do not follow redirects"));
var freePort = FreePort(); Environment.SetEnvironmentVariable("AI_CANVAS_BRIDGE_PORT", freePort.ToString());
using (var missing = new BridgeServiceController(testRoot)) {
    Check((await missing.ConnectAsync(true, "https://example.invalid", timeout.Token)).Code == "CONFIG_MISMATCH", "reject nonlocal/config mismatch");
    Check((await missing.ConnectAsync(false, $"http://127.0.0.1:{freePort}", timeout.Token)).Code == "NOT_RUNNING", "check does not start service");
    Check((await missing.ConnectAsync(true, $"http://127.0.0.1:{freePort}", timeout.Token)).Code == "RUNTIME_MISSING", "report missing runtime");
}

// Real, isolated service lifecycle. Capability files stay inside this test directory.
var controlFile = Path.Combine(testRoot, "control.json");
Environment.SetEnvironmentVariable("AI_CANVAS_BRIDGE_CONTROL_FILE", controlFile);
Environment.SetEnvironmentVariable("AI_CANVAS_BRIDGE_CAPABILITY_FILE", Path.Combine(testRoot, "capability.json"));
async Task StopOwnedTestService()
{
    if (!File.Exists(controlFile)) return;
    using var document = JsonDocument.Parse(await File.ReadAllTextAsync(controlFile));
    var data = document.RootElement;
    var expected = $"http://127.0.0.1:{freePort}";
    if (data.GetProperty("baseUrl").GetString() != expected) throw new Exception("test service scope mismatch");
    using var http = new HttpClient(new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false });
    using var request = new HttpRequestMessage(HttpMethod.Post, expected + "/control/shutdown");
    request.Headers.Authorization = new("Bearer", data.GetProperty("controlToken").GetString());
    request.Content = new StringContent("{\"version\":1}", Encoding.UTF8, "application/json");
    using var response = await http.SendAsync(request, timeout.Token);
    response.EnsureSuccessStatusCode();
    for (var i = 0; i < 40 && File.Exists(controlFile); i++) await Task.Delay(50, timeout.Token);
}
try {
    using var controller = new BridgeServiceController(projectRoot);
    var address = $"http://127.0.0.1:{freePort}";
    Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "READY", "start real service");
    var firstSession = JsonDocument.Parse(await File.ReadAllTextAsync(controlFile)).RootElement.GetProperty("sessionId").GetString();
    Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "READY", "repeat ensure");
    var secondSession = JsonDocument.Parse(await File.ReadAllTextAsync(controlFile)).RootElement.GetProperty("sessionId").GetString();
    Check(firstSession == secondSession, "reuse without replacing published state");
    await StopOwnedTestService();
    Check((await controller.ConnectAsync(false, address, timeout.Token)).Code == "NOT_RUNNING", "detect stopped service");
    Check((await controller.ConnectAsync(true, address, timeout.Token)).Code == "READY", "recover stopped service");
} finally { await StopOwnedTestService(); }
Console.WriteLine($"BridgeConnectionTests: {count} checks passed.");
