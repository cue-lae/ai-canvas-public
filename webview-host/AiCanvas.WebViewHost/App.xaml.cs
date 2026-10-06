using System.Configuration;
using System.Data;
using System.Windows;
using System.Diagnostics;
using System.IO;
using AiCanvas.Diagnostics;

namespace AiCanvas.WebViewHost;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    private Mutex? _packageWindowMutex;
    private PackageWindowLifetime? _windowLifetime;
    private DocumentDispatchBroker? _documents;
    protected override async void OnStartup(StartupEventArgs e)
    {
        TimingTrace.Mark(TimingStage.ProcessEntry);
        base.OnStartup(e);
        try
        {
            DocumentOpenRequest? documentOpen = null;
            if (InstalledPackagePolicy.Enabled)
            {
                var root = InstalledPackagePolicy.ResolveRoot(AppContext.BaseDirectory);
                if (e.Args.Length == 1 && e.Args[0] == "--mcp")
                {
                    ShutdownMode = ShutdownMode.OnExplicitShutdown;
                    _packageWindowMutex = new Mutex(false, InstalledPackagePolicy.WindowMutex);
                    var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"))
                    {
                        UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root,
                        RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    };
                    InstalledPackagePolicy.Configure(start);
                    start.ArgumentList.Add(Path.Combine(root, "scripts", "package-entry.mjs"));
                    start.ArgumentList.Add("mcp");
                    using var process = Process.Start(start) ?? throw new IOException("无法启动读取组件。");
                    var input = Task.Run(async () => {
                        try { await Console.OpenStandardInput().CopyToAsync(process.StandardInput.BaseStream); }
                        catch (IOException) { }
                        finally { process.StandardInput.Close(); }
                    });
                    var output = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                    var errors = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                    await process.WaitForExitAsync();
                    await Task.WhenAll(output, errors);
                    Shutdown(process.ExitCode);
                    return;
                }
                if (e.Args.Length == 1 && e.Args[0] is "--stop-bridge" or "--package-status")
                {
                    ShutdownMode = ShutdownMode.OnExplicitShutdown;
                    var action = e.Args[0] == "--stop-bridge" ? "stop" : "status";
                    var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"))
                    {
                        UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root,
                    };
                    InstalledPackagePolicy.Configure(start);
                    start.ArgumentList.Add(Path.Combine(root, "scripts", "package-entry.mjs"));
                    start.ArgumentList.Add(action);
                    using var process = Process.Start(start) ?? throw new IOException("无法启动安装包组件。");
                    using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                    await process.WaitForExitAsync(limit.Token);
                    if (action == "status") { Shutdown(process.ExitCode); return; }
                    if (process.ExitCode != 0) throw new IOException("操作未完成。请确认使用完整安装包，并关闭画布后重试；未关闭其他程序。");
                    MessageBox.Show("画布连接服务已停止。", "AI Canvas");
                    Shutdown();
                    return;
                }
            }
            TimingTrace.Mark(TimingStage.WindowConstructBegin);
            if (e.Args.Length > 1) throw new IOException("一次只能打开一个项目文件。");
            string? dispatchPath = e.Args.Length == 0 ? null : DocumentPathIdentity.Canonical(e.Args[0]);
            _documents = new DocumentDispatchBroker();
            if (!_documents.IsPrimary)
            {
                var forwarded = await _documents.ForwardAsync(dispatchPath);
                Shutdown(forwarded == DocumentDispatchResult.Accepted ? 0 : 1); return;
            }
            if (!DocumentOpenRequest.TryCreate(e.Args, out documentOpen, out var documentError)) throw new IOException(documentError);
            if (InstalledPackagePolicy.Enabled)
            {
                _packageWindowMutex = new Mutex(false, InstalledPackagePolicy.WindowMutex);
                _windowLifetime = AiCanvas.WebViewHost.MainWindow.CreateWindowLease();
            }
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            _documents.Start(request => Dispatcher.InvokeAsync(() => DocumentTabController.DispatchAsync(request)).Task.Unwrap());
            if (DocumentRunScope.Isolated && _windowLifetime is null) _windowLifetime = AiCanvas.WebViewHost.MainWindow.CreateWindowLease();
            MainWindow = new MainWindow(_windowLifetime, documentOpen);
            TimingTrace.Mark(TimingStage.WindowConstructEnd);
            MainWindow.Show();
        }
        catch (Exception error)
        {
            if (e.Args.Contains("--mcp") || e.Args.Contains("--package-status")) Console.Error.WriteLine("AI Canvas component startup failed: " + error.Message);
            else MessageBox.Show(error.Message, "AI Canvas 启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
    protected override void OnExit(ExitEventArgs e)
    {
        _documents?.Dispose();
        _windowLifetime?.Dispose();
        _packageWindowMutex?.Dispose();
        base.OnExit(e);
    }
}
