using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using AiCanvas.WebViewHost;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        var result = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Startup += async (_, _) => {
            var views = new List<WebView2>();
            Window? window = null;
            try
            {
                var assembly = typeof(MainWindow).Assembly;
                var installed = (bool)assembly.GetType("AiCanvas.WebViewHost.InstalledPackagePolicy")!
                    .GetProperty("Enabled", BindingFlags.Public | BindingFlags.Static)!.GetValue(null)!;
                var sessionType = assembly.GetType("AiCanvas.WebViewHost.DocumentSession")!;
                var bind = sessionType.GetMethod("BindCoreAsync", BindingFlags.NonPublic | BindingFlags.Instance)!;
                var setPresentation = sessionType.GetMethod("SetPresentation", BindingFlags.NonPublic | BindingFlags.Instance)!;
                var grid = new Grid();
                window = new Window { Content = grid, Width = 300, Height = 240, ShowInTaskbar = false, Opacity = 0 };
                window.Show();
                var profile = Path.GetFullPath($"temp/release-1.0.4-build-027-20261005/devtools-profile-{installed}");
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                for (var i = 0; i < 2; i++)
                {
                    var view = new WebView2(); views.Add(view); grid.Children.Add(view);
                    await view.EnsureCoreWebView2Async(environment);
                    var session = Activator.CreateInstance(sessionType, BindingFlags.NonPublic | BindingFlags.Instance, null, [view, null], null)!;
                    await (Task)bind.Invoke(session, [i == 0])!;
                    if (view.CoreWebView2.Settings.AreDevToolsEnabled != !installed)
                        throw new InvalidOperationException($"Document {i}: DevTools policy must match installed={installed}");
                    Console.WriteLine($"PASS document {i}: installed={installed}, DevTools={view.CoreWebView2.Settings.AreDevToolsEnabled}");
                    var core = view.CoreWebView2;
                    var other = new Grid(); grid.Children.Remove(view); grid.Children.Add(other); other.Children.Add(view);
                    setPresentation.Invoke(session, [true]);
                    if (!ReferenceEquals(core, view.CoreWebView2) || core.Settings.AreDevToolsEnabled != !installed)
                        throw new InvalidOperationException("Moving the existing view changed its DevTools policy");
                    Console.WriteLine($"PASS document {i}: same Core and policy after transfer/presentation");
                }
                result = 0;
                Console.WriteLine("DocumentDevToolsTests: 4 checks passed.");
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally { foreach (var view in views) view.Dispose(); window?.Close(); app.Shutdown(result); }
        };
        app.Run(); return result;
    }
}
