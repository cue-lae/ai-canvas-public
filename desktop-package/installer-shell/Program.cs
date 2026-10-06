using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using AiCanvas.Diagnostics;
using System.Windows.Threading;

namespace AiCanvas.Installer;

internal static class Program
{
    [STAThread]
    public static void Main()
    {
        TimingTrace.Mark(TimingStage.ProcessEntry);
        using var mutex = new Mutex(true, "Local\\AI.Canvas.DesktopTest.Installer", out var first);
        if (!first) { MessageBox.Show("安装程序已经打开。", "AI Canvas 安装程序"); return; }
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.DispatcherUnhandledException += (_, e) => { MessageBox.Show("安装界面无法继续，请关闭后重试。", "AI Canvas 安装程序"); e.Handled = true; };
        app.Run(new InstallerWindow());
    }
}

internal sealed class InstallerWindow : Window
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    private const string Origin = "https://installer.ai-canvas.local";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{A824AB0C-29C1-4EF2-9117-EC098BF86169}_is1";
    private readonly WebView2 _browser = new();
    private bool _surfaceShown;
    private bool _closed;
    private readonly string _version;
    private readonly string _assets;
    private readonly string _run;
    private string _path = "";
    private string _previousVersion = "";
    private bool _update;
    private string _phase = "ready";
    private string _error = "";
    private int _percent;
    private bool _shortcut = true;
    private bool _cancelling;
    private bool _closeAfterCancel;
    private string? _job;
    private Process? _engine;

    public InstallerWindow()
    {
        TimingTrace.Mark(TimingStage.WindowConstructBegin);
        Title = "AI Canvas 安装程序";
        ReadInstalledState();
        // Approved ready-page heights at 660 DIP: fresh install 412, update 432.
        // Match the native white placeholder to the actual initial scenario;
        // wrapped content and later pages still use the browser's measured height.
        Width = 660; Height = _update ? 432 : 412; WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        Background = Brushes.White; Opacity = 0;
        // Let DWM draw the outer antialiased corners. A zero glass frame forces
        // WindowChrome down its integer HRGN clipping path and creates jaggies.
        WindowChrome.SetWindowChrome(this, new WindowChrome { CaptionHeight = 0, CornerRadius = new CornerRadius(0), GlassFrameThickness = new Thickness(1), ResizeBorderThickness = new Thickness(0), UseAeroCaptionButtons = false });
        using (var icon = Resource("AppIcon")) Icon = BitmapFrame.Create(icon, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        using var release = JsonDocument.Parse(ReadResource("Release"));
        _version = release.RootElement.GetProperty("packageVersion").GetString()!;
        _run = Path.Combine(Path.GetTempPath(), "AI-Canvas-Installer", Guid.NewGuid().ToString("N"));
        _assets = Path.Combine(_run, "ui"); Directory.CreateDirectory(_assets);
        WriteUi();
        _browser.DefaultBackgroundColor = System.Drawing.Color.White;
        Content = _browser;
        Loaded += async (_, _) => await InitializeBrowser();
        Closing += (_, e) => { if (_phase == "progress") { e.Cancel = true; _closeAfterCancel = true; RequestCancel(); } };
        Closed += (_, _) => { _closed = true; TimingTrace.Mark(TimingStage.WindowClose); _browser.Dispose(); };
        TimingTrace.Mark(TimingStage.WindowConstructEnd);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // Opacity hides the WPF content, not this non-layered HWND. Its native
        // clear color must match the intended white startup placeholder.
        if (PresentationSource.FromVisual(this) is HwndSource source)
            source.CompositionTarget.BackgroundColor = Colors.White;
        int round = 2; // DWMWCP_ROUND; supported by the configured Windows 11 VM.
        _ = DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 33, ref round, sizeof(int));
    }

    private static Stream Resource(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new InvalidDataException("Missing installer resource");
    private static string ReadResource(string name) { using var input = Resource(name); using var reader = new StreamReader(input, Encoding.UTF8); return reader.ReadToEnd(); }

    private void WriteUi()
    {
        // Reuse the approved markup and complete stylesheet verbatim. Only the
        // prototype scenario switcher and simulated timer are excluded.
        var reference = ReadResource("ApprovedPreview");
        var start = reference.IndexOf("<section class=\"ip-window\"", StringComparison.Ordinal);
        var end = reference.IndexOf("</section>", reference.IndexOf("</footer>", start, StringComparison.Ordinal), StringComparison.Ordinal) + "</section>".Length;
        var cssStart = reference.IndexOf("<style>", StringComparison.Ordinal) + 7;
        var cssEnd = reference.IndexOf("</style>", cssStart, StringComparison.Ordinal);
        if (start < 0 || end <= start || cssStart < 7 || cssEnd <= cssStart) throw new InvalidDataException("Approved preview structure changed");
        File.WriteAllText(Path.Combine(_assets, "approved.css"), reference[cssStart..cssEnd], new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(_assets, "controller.js"), ReadResource("Controller"), new UTF8Encoding(false));
        var html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'\"><link rel=\"stylesheet\" href=\"approved.css\"><style>html,body{margin:0;padding:0;background:white;color-scheme:light;overflow:hidden}#installer-flow-preview .ip-window{margin:0;box-shadow:none}#installer-flow-preview .ip-titlebar{user-select:none;app-region:drag}#installer-flow-preview .ip-titlebar button{app-region:no-drag}#installer-flow-preview .ip-runtime-error{color:var(--ip-error);margin-top:12px;font-size:12px}</style></head><body><div id=\"installer-flow-preview\">" + reference[start..end] + "</div><script src=\"controller.js\"></script></body></html>";
        File.WriteAllText(Path.Combine(_assets, "index.html"), html, new UTF8Encoding(false));
    }

    private async Task InitializeBrowser()
    {
        try
        {
            TimingTrace.Mark(TimingStage.WindowLoaded);
            TimingTrace.Mark(TimingStage.BrowserEnvironmentBegin);
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI Canvas Installer", "WebView2"));
            TimingTrace.Mark(TimingStage.BrowserEnvironmentEnd);
            if (_closed) return;
            TimingTrace.Mark(TimingStage.BrowserControlBegin);
            await _browser.EnsureCoreWebView2Async(environment);
            TimingTrace.Mark(TimingStage.BrowserControlEnd);
            if (_closed) return;
            var web = _browser.CoreWebView2;
            web.Settings.IsNonClientRegionSupportEnabled = true;
            web.Settings.AreDevToolsEnabled = false; web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.AreBrowserAcceleratorKeysEnabled = false; web.Settings.IsStatusBarEnabled = false;
            web.Settings.IsGeneralAutofillEnabled = false; web.Settings.IsPasswordAutosaveEnabled = false;
            web.SetVirtualHostNameToFolderMapping("installer.ai-canvas.local", _assets, CoreWebView2HostResourceAccessKind.DenyCors);
            web.NavigationStarting += (_, e) => { if (e.Uri != Origin + "/index.html") e.Cancel = true; };
            web.NewWindowRequested += (_, e) => e.Handled = true;
            web.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.WebMessageReceived += OnMessage;
            TimingTrace.Mark(TimingStage.NavigateBegin);
            web.Navigate(Origin + "/index.html");
            _ = CheckSurfaceTimeoutAsync();
        }
        catch { if (!_closed) { MessageBox.Show("无法打开安装界面。请确认 Microsoft Edge WebView2 Runtime 已安装。", Title); Close(); } }
    }

    private async Task CheckSurfaceTimeoutAsync()
    {
        await Task.Delay(TimeSpan.FromSeconds(15));
        if (!_closed && !_surfaceShown)
        {
            MessageBox.Show("安装界面加载超时，请关闭后重试。", Title);
            Close();
        }
    }

    private void ReadInstalledState()
    {
        TimingTrace.Mark(TimingStage.InstallerStateRead);
        using var key = Registry.CurrentUser.OpenSubKey(UninstallKey);
        _update = key != null;
        _previousVersion = key?.GetValue("DisplayVersion") as string ?? "";
        _path = key?.GetValue("InstallLocation") as string ?? key?.GetValue("Inno Setup: App Path") as string ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "AI Canvas");
        _phase = "ready"; _error = ""; _percent = 0; _cancelling = false;
        SendState();
    }

    private void SendState() => _browser.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { kind = "state", phase = _phase, path = _path, isUpdate = _update, previousVersion = _previousVersion, version = _version + " · 初版", shortcut = _shortcut, percent = _percent, error = _error, cancelling = _cancelling }));

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_closed || e.Source != Origin + "/index.html") return;
        try
        {
            using var data = JsonDocument.Parse(e.WebMessageAsJson); var root = data.RootElement;
            switch (root.GetProperty("action").GetString())
            {
                case "ready": if (_phase != "progress" && _phase != "done") ReadInstalledState(); else SendState(); break;
                // Ignore the prototype's default ready-page measurement until
                // the real installed state has been rendered and fonts are ready.
                case "resize": if (_surfaceShown && root.TryGetProperty("height", out var height) && height.TryGetInt32(out var value) && value is >= 380 and <= 720) Height = value; break;
                case "surface-ready":
                    if (!_surfaceShown && root.TryGetProperty("height", out var initialHeight) && initialHeight.TryGetInt32(out var measured) && measured is >= 380 and <= 720)
                    {
                        Height = measured; _surfaceShown = true;
                        await Dispatcher.BeginInvoke(DispatcherPriority.Render, new Action(() => {
                            if (_closed) return;
                            Opacity = 1;
                            TimingTrace.Mark(TimingStage.InstallerLayoutReady);
                        }));
                    }
                    break;
                case "close": if (_phase == "progress") { _closeAfterCancel = true; RequestCancel(); } else Close(); break;
                case "cancel": RequestCancel(); break;
                case "install":
                    if (_phase != "ready") break;
                    var chosen = root.GetProperty("path").GetString() ?? "";
                    var shortcut = root.GetProperty("shortcut").GetBoolean();
                    await Install(chosen, shortcut); break;
                case "open": if (_phase == "done") { Process.Start(new ProcessStartInfo(Path.Combine(_path, "AiCanvas.WebViewHost.exe")) { UseShellExecute = false, WorkingDirectory = _path }); Close(); } break;
            }
        }
        catch { _error = "操作未完成，请检查安装位置后重试。"; SendState(); }
    }

    private static Dictionary<string, string> ReadState(string path)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return result;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(stream, Encoding.Unicode, true);
        while (reader.ReadLine() is { } line) { var index = line.IndexOf('='); if (index > 0) result[line[..index].Trim()] = line[(index + 1)..].Trim(); }
        return result;
    }

    private void RequestCancel()
    {
        if (_phase != "progress" || _cancelling) return;
        _cancelling = true;
        if (_job != null) File.WriteAllText(Path.Combine(_job, "command.ini"), "[control]\r\ncancel=1\r\n", Encoding.Unicode);
        SendState();
    }

    private async Task Install(string chosen, bool shortcut)
    {
        if (string.IsNullOrWhiteSpace(chosen) || !Path.IsPathFullyQualified(chosen)) { _error = "请输入完整的本地文件夹路径。"; SendState(); return; }
        if (!_update) _path = Path.GetFullPath(chosen);
        _shortcut = shortcut; _phase = "progress"; _percent = 0; _error = ""; _cancelling = false; SendState();
        TimingTrace.Mark(TimingStage.InstallBegin);
        _job = Path.Combine(_run, "job-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(_job);
        var stateFile = Path.Combine(_job, "state.ini");
        File.WriteAllText(stateFile, "[state]\r\nphase=preparing\r\npercent=0\r\n", Encoding.Unicode);
        var engineFile = Path.Combine(_job, "installer-engine.exe");
        try
        {
            TimingTrace.Mark(TimingStage.EngineExtractBegin);
            using (var resource = Resource("InstallerEngine"))
            await using (var file = new FileStream(engineFile, FileMode.CreateNew, FileAccess.Write)) await resource.CopyToAsync(file);
            TimingTrace.Mark(TimingStage.EngineExtractEnd);
            var start = new ProcessStartInfo(engineFile) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = _job };
            foreach (var argument in new[] { "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/DIR=" + _path, "/CANVASSTATE=" + stateFile, "/CANVASDESKTOP=" + (shortcut ? "1" : "0"), "/LOG=" + Path.Combine(_job, "installer.log") }) start.ArgumentList.Add(argument);
            _engine = Process.Start(start) ?? throw new IOException("安装进程未能启动。");
            TimingTrace.Mark(TimingStage.EngineStart);
            var wait = _engine.WaitForExitAsync();
            while (!wait.IsCompleted)
            {
                await Task.WhenAny(wait, Task.Delay(120));
                try { var state = ReadState(stateFile); if (state.TryGetValue("percent", out var text) && int.TryParse(text, out var percent)) _percent = Math.Clamp(percent, 0, 100); SendState(); } catch (IOException) { }
            }
            await wait;
            TimingTrace.Mark(TimingStage.EngineExit);
            var final = ReadState(stateFile);
            if (_engine.ExitCode == 0 && final.GetValueOrDefault("phase") == "completed")
            {
                using var installed = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(_path, "installed-package.json")));
                if (installed.RootElement.GetProperty("id").GetString() != "ai-canvas-desktop-test" || installed.RootElement.GetProperty("version").GetString() != _version || !File.Exists(Path.Combine(_path, "AiCanvas.WebViewHost.exe"))) throw new IOException("安装结果无法确认。");
                _phase = "done"; _percent = 100; _cancelling = false;
            }
            else if (final.GetValueOrDefault("phase") == "cancelled") { _phase = "cancelled"; _cancelling = false; }
            else { _phase = "ready"; _cancelling = false; _error = final.GetValueOrDefault("error", "安装未完成，请确认程序已关闭并检查安装位置后重试。"); }
        }
        catch (Exception error) { _phase = "ready"; _cancelling = false; _error = error is IOException ? error.Message : "安装未完成，请检查安装位置后重试。"; }
        finally { _engine?.Dispose(); _engine = null; }
        SendState();
        if (_closeAfterCancel && _phase != "progress") Close();
    }
}
