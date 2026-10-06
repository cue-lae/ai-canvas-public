using System.Reflection;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using AiCanvas.WebViewHost;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

internal static class Program
{
    private static readonly List<string> Errors = [];
    private static int _checks;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
        Console.WriteLine("PASS " + message); _checks++;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.DispatcherUnhandledException += (_, args) => {
            Errors.Add(args.Exception.ToString());
            // Only the regression runner catches crashes to report a failing exit.
            // The product receives no catch-all or diagnostic entry point.
            args.Handled = true;
        };
        var result = 1;
        app.Startup += async (_, _) => {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(args.Length == 0 ? 15 : 90));
                var keepAlive = EmptyWindow();
                keepAlive.Show();
                await RunCase("already-completed cleanup", false, false, timeout.Token);
                await RunCase("repeated close after completed cleanup", false, true, timeout.Token);
                await RunCase("in-flight cleanup", true, false, timeout.Token);
                await RunCase("repeated close during cleanup", true, true, timeout.Token);
                if (args.Length == 1) await RunDocumentTransfer(args[0], timeout.Token);
                Check(keepAlive.IsVisible, "closing a migrated empty source leaves another window open");
                Check(Errors.Count == 0, "no unhandled dispatcher exception");
                Console.WriteLine($"WindowCloseReentrancyTests: {_checks} checks passed.");
                result = 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally {
                foreach (var error in Errors) Console.Error.WriteLine(error);
                app.Shutdown(result);
            }
        };
        app.Run();
        return result;
    }

    private const BindingFlags Instance = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;
    private static object Read(object instance, string name) => instance.GetType().GetProperty(name, Instance)!.GetValue(instance)!;
    private static object Invoke(object instance, string name, params object?[] arguments) =>
        instance.GetType().GetMethod(name, Instance)!.Invoke(instance, arguments)!;
    private static object Tabs(MainWindow window) => typeof(MainWindow).GetField("_tabs", Instance)!.GetValue(window)!;
    private static object Open(string path)
    {
        var type = typeof(MainWindow).Assembly.GetType("AiCanvas.WebViewHost.DocumentOpenRequest")!;
        object?[] arguments = [new[] { path }, null, null];
        if (!(bool)type.GetMethod("TryCreate", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, arguments)!)
            throw new IOException((string?)arguments[2]);
        return arguments[1]!;
    }

    private static async Task Contains(CoreWebView2 core, string expected, CancellationToken timeout)
    {
        while (true)
        {
            timeout.ThrowIfCancellationRequested();
            var text = JsonSerializer.Deserialize<string>(await core.ExecuteScriptAsync("document.body.innerText"));
            if (text?.Contains(expected) == true) return;
            await Task.Delay(50, timeout);
        }
    }

    private static Task Closed(MainWindow window)
    {
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        window.Closed += (_, _) => closed.TrySetResult();
        return closed.Task;
    }

    private static async Task RunDocumentTransfer(string directory, CancellationToken timeout)
    {
        var fixtures = Path.GetFullPath(directory);
        if (!fixtures.StartsWith(Path.GetFullPath("temp/window-close-reentrancy-20261005") + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase)) throw new IOException("Use dedicated regression fixture copies only.");
        var aPath = Path.Combine(fixtures, "A.excalidraw");
        var bPath = Path.Combine(fixtures, "B.excalidraw");
        var initialA = File.ReadAllText(aPath); var initialB = File.ReadAllText(bPath);
        var main = (MainWindow)Activator.CreateInstance(typeof(MainWindow), Instance, null, [null, Open(aPath), false], null)!;
        main.ShowInTaskbar = false; main.Opacity = 0; main.Show();
        await ((Task)Invoke(main, "WaitForInitialPresentationAsync")).WaitAsync(timeout);
        var tabs = Tabs(main);
        var a = Read(tabs, "Active");
        var aView = (WebView2)Read(a, "View"); var aCore = aView.CoreWebView2;
        await Contains(aCore, "A 项目", timeout);
        var create = (Task)Invoke(main, "CreateDocumentAsync", Open(bPath));
        await create.WaitAsync(timeout);
        var b = Read(create, "Result");
        var bView = (WebView2)Read(b, "View"); var bCore = bView.CoreWebView2;
        await Contains(bCore, "B 项目", timeout);
        Check(!Equals(Read(Read(a, "State"), "Id"), Read(Read(b, "State"), "Id")), "live documents have independent identities");

        var detached = EmptyWindow(); detached.Width = 960; detached.Height = 600;
        Invoke(tabs, "Transfer", b, Tabs(detached), 0, false);
        detached.Show();
        var sourceClosed = Closed(detached);
        Invoke(Tabs(detached), "Transfer", b, tabs, 1, true);
        await sourceClosed.WaitAsync(timeout);
        await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
        Check(main.IsVisible && Errors.Count == 0, "B into A closes only empty B source without dispatcher crash");
        Check(ReferenceEquals(aCore, aView.CoreWebView2) && ReferenceEquals(bCore, bView.CoreWebView2), "B into A retains both live WebView cores");
        await Contains(aCore, "A 项目", timeout); await Contains(bCore, "B 项目", timeout);

        var receiver = EmptyWindow(); receiver.Width = 960; receiver.Height = 600;
        Invoke(tabs, "Transfer", b, Tabs(receiver), 0, false); receiver.Show();
        var mainClosed = Closed(main);
        Invoke(tabs, "Transfer", a, Tabs(receiver), 1, true);
        await mainClosed.WaitAsync(timeout);
        await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
        Check(receiver.IsVisible && Errors.Count == 0, "A into B closes only empty A source without dispatcher crash");
        Check(receiver.ActualWidth >= 1280 && receiver.ActualHeight >= 800, "small merge receiver keeps the default-size minimum");
        Check(ReferenceEquals(aCore, aView.CoreWebView2) && ReferenceEquals(bCore, bView.CoreWebView2), "A into B retains both live WebView cores");
        await Contains(aCore, "A 项目", timeout); await Contains(bCore, "B 项目", timeout);
        Check((bool)await ((Task<bool>)Invoke(a, "SaveForCloseAsync", false)).WaitAsync(timeout), "A still saves through its transferred owner");
        Check((bool)await ((Task<bool>)Invoke(b, "SaveForCloseAsync", false)).WaitAsync(timeout), "B still saves through its transferred owner");
        SameContent(initialA, File.ReadAllText(aPath), "A");
        SameContent(initialB, File.ReadAllText(bPath), "B");
        var receiverClosed = Closed(receiver); receiver.Close();
        await receiverClosed.WaitAsync(timeout);
        Check(Errors.Count == 0, "merged real-document window closes normally after save");
    }

    private static void SameContent(string before, string after, string name)
    {
        using var original = JsonDocument.Parse(before); using var saved = JsonDocument.Parse(after);
        var a = original.RootElement; var b = saved.RootElement;
        Check(a.GetProperty("appState").GetProperty("zoom").GetProperty("value").GetDouble() ==
            b.GetProperty("appState").GetProperty("zoom").GetProperty("value").GetDouble(), name + " scene zoom survives transfer and save");
        var oldDescriptions = a.GetProperty("aiCanvas").GetProperty("business").GetProperty("descriptions");
        var newDescriptions = b.GetProperty("aiCanvas").GetProperty("business").GetProperty("descriptions");
        Check(oldDescriptions.EnumerateObject().All(entry => newDescriptions.GetProperty(entry.Name).GetProperty("text").GetString() ==
            entry.Value.GetProperty("text").GetString()), name + " description text survives transfer and save");
        Check(a.GetProperty("files").EnumerateObject().All(entry => b.GetProperty("files").GetProperty(entry.Name).GetProperty("dataURL").GetString() ==
            entry.Value.GetProperty("dataURL").GetString()), name + " image bytes survive transfer and save");
    }

    private static MainWindow EmptyWindow()
    {
        var window = (MainWindow)Activator.CreateInstance(typeof(MainWindow),
            BindingFlags.Instance | BindingFlags.NonPublic, null, [null, null, true], null)!;
        window.ShowInTaskbar = false; window.Opacity = 0;
        return window;
    }

    private static async Task RunCase(string name, bool delayed, bool repeat, CancellationToken timeout)
    {
        // A real production MainWindow with no documents, as after its last
        // document moved to another window. No copied Closing implementation.
        var window = EmptyWindow();
        var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (delayed) typeof(MainWindow).GetField("_startupConnection", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(window, pending.Task);
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var closedCount = 0;
        window.Closed += (_, _) => { closedCount++; closed.TrySetResult(); };
        window.Show();
        window.Close();
        Check(!closed.Task.IsCompleted, name + ": original Closing returns before final close");
        if (repeat) window.Close();
        if (delayed)
        {
            await Task.Delay(30, timeout);
            Check(!closed.Task.IsCompleted, name + ": cleanup must finish before disposal");
            pending.SetResult();
        }
        // Force queued Dispatcher work to run before assessing the result.
        await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
        Check(Errors.Count == 0, name + ": no closing re-entry exception");
        await closed.Task.WaitAsync(timeout);
        Check(closedCount == 1, name + ": exactly one Closed notification");
    }
}
