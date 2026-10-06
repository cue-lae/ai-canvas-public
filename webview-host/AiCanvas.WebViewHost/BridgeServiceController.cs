using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

using AiCanvas.Diagnostics;

namespace AiCanvas.WebViewHost;

internal sealed record BridgeConnectionResult(string Status, string Code);

// Fixed local entrypoint only. No commands, executable paths or process IDs come from the page.
internal sealed class BridgeServiceController : IDisposable
{
    private readonly string _root;
    private readonly int _port;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly HttpClient _http = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false })
        { Timeout = Timeout.InfiniteTimeSpan, MaxResponseContentBufferSize = 4096 };
    private Process? _started;
    private readonly PackageWindowLifetime? _lifetime;

    public BridgeServiceController(string root, PackageWindowLifetime? lifetime = null)
    {
        _lifetime = lifetime;
        _root = Path.GetFullPath(root);
        var configured = InstalledPackagePolicy.Enabled ? InstalledPackagePolicy.Port.ToString()
            : Environment.GetEnvironmentVariable("AI_CANVAS_BRIDGE_PORT");
        _port = string.IsNullOrEmpty(configured) ? 43127
            : int.TryParse(configured, out var value) && value is > 0 and <= 65535 ? value : 0;
    }

    public async Task<BridgeConnectionResult> ConnectAsync(bool ensure, string requestedBaseUrl, CancellationToken cancellation)
    {
        if (DocumentRunScope.Isolated) return new("disconnected", "UNAVAILABLE");
        if (_lifetime != null)
            return await _lifetime.RunAsync(() => ConnectCoreAsync(ensure, requestedBaseUrl, cancellation), cancellation);
        return await ConnectCoreAsync(ensure, requestedBaseUrl, cancellation);
    }

    private async Task<BridgeConnectionResult> ConnectCoreAsync(bool ensure, string requestedBaseUrl, CancellationToken cancellation)
    {
        if (_port == 0 || requestedBaseUrl != $"http://127.0.0.1:{_port}")
            return new("disconnected", "CONFIG_MISMATCH");
        await _gate.WaitAsync(cancellation);
        try
        {
            TimingTrace.Mark(TimingStage.BridgeProbeBegin);
            var probe = await ProbeAsync(cancellation);
            TimingTrace.Mark(TimingStage.BridgeProbeEnd);
            if (!ensure || probe.Code != "NOT_RUNNING") return probe;
            if (_started is null || _started.HasExited)
            {
                if (InstalledPackagePolicy.Enabled) InstalledPackagePolicy.ResolveRoot(_root);
                var script = Path.Combine(_root, "scripts", InstalledPackagePolicy.Enabled ? "package-entry.mjs" : "canvas-context-bridge.mjs");
                var bundledNode = Path.Combine(_root, "runtime", "node.exe");
                var developmentNode = Path.Combine(_root, "webview-host", ".toolchain", "node", "node.exe");
                var node = InstalledPackagePolicy.Enabled || File.Exists(bundledNode) ? bundledNode : developmentNode;
                if (!File.Exists(script) || !File.Exists(node)) return new("disconnected", "RUNTIME_MISSING");
                _started?.Dispose();
                var start = new ProcessStartInfo(node)
                {
                    UseShellExecute = false, CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = _root,
                };
                start.ArgumentList.Add(script);
                if (InstalledPackagePolicy.Enabled)
                {
                    start.ArgumentList.Add("bridge");
                    InstalledPackagePolicy.Configure(start);
                }
                start.Environment["AI_CANVAS_BRIDGE_PORT"] = _port.ToString();
                // Preserve explicit installation policy; the bridge's default includes this desktop origin.
                TimingTrace.Mark(TimingStage.BridgeSpawn);
                _started = Process.Start(start);
                if (_started is null) return new("disconnected", "START_FAILED");
            }
            var elapsed = Stopwatch.StartNew();
            while (elapsed.Elapsed < TimeSpan.FromSeconds(8))
            {
                await Task.Delay(250, cancellation);
                probe = await ProbeAsync(cancellation);
                if (probe.Code is not ("NOT_RUNNING" or "OWNERSHIP_UNVERIFIED")) return probe;
                if (_started.HasExited) return new("disconnected", "START_FAILED");
            }
            return new("disconnected", "TIMEOUT");
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            return new("disconnected", "TIMEOUT");
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
        {
            return new("disconnected", "START_FAILED");
        }
        finally { _gate.Release(); }
    }

    private async Task<BridgeConnectionResult> ProbeAsync(CancellationToken cancellation)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{_port}/session");
            request.Headers.Add("Origin", $"https://{HostNavigationPolicy.AppHost}");
            request.Content = new StringContent("{\"version\":1}", Encoding.UTF8, "application/json");
            using var response = await _http.SendAsync(request, timeout.Token);
            if (response.StatusCode == HttpStatusCode.Forbidden) return new("disconnected", "ORIGIN_DENIED");
            if (!response.IsSuccessStatusCode) return new("disconnected", "INCOMPATIBLE");
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var protocol) || protocol != 1 ||
                !root.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(session.GetString()) ||
                !root.TryGetProperty("token", out var token) || token.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(token.GetString()))
                return new("disconnected", "INCOMPATIBLE");
            // Do not expose the session or capability tokens to WebView messages/logs.
            if (InstalledPackagePolicy.Enabled && !InstalledPackagePolicy.OwnsSession(session.GetString()!))
                return new("disconnected", "OWNERSHIP_UNVERIFIED");
            return new("connected", "READY");
        }
        catch (HttpRequestException error)
        {
            for (Exception? cause = error; cause is not null; cause = cause.InnerException)
                if (cause is SocketException { SocketErrorCode: SocketError.ConnectionRefused })
                    return new("disconnected", "NOT_RUNNING");
            return new("disconnected", "UNAVAILABLE");
        }
        catch (JsonException) { return new("disconnected", "INCOMPATIBLE"); }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { return new("disconnected", "TIMEOUT"); }
    }

    public async Task CloseWindowAsync()
    {
        if (_lifetime == null) return;
        if (DocumentRunScope.Isolated || !InstalledPackagePolicy.Enabled)
        {
            await _lifetime.CloseAsync(() => Task.CompletedTask);
            return;
        }
        await _lifetime.CloseAsync(async () => {
            InstalledPackagePolicy.ResolveRoot(_root);
            var start = new ProcessStartInfo(Path.Combine(_root, "runtime", "node.exe")) {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = _root,
                RedirectStandardError = true, RedirectStandardOutput = true,
            };
            InstalledPackagePolicy.Configure(start);
            start.ArgumentList.Add(Path.Combine(_root, "scripts", "package-entry.mjs"));
            start.ArgumentList.Add("stop");
            using var process = Process.Start(start) ?? throw new IOException("连接结束操作未能启动。");
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            // This packaged operation is itself bounded. Keep the lifetime gate
            // until it exits; never race a still-running stop against a new start.
            await process.WaitForExitAsync().ConfigureAwait(false);
            await Task.WhenAll(output, errors).ConfigureAwait(false);
            if (process.ExitCode != 0) throw new IOException("连接未能正常结束。画布将保持打开，请稍后再次关闭重试。");
        });
    }

    public void Dispose()
    {
        _http.Dispose();
        // Installed windows complete coordinated shutdown before disposal.
        _started?.Dispose();
    }
}
