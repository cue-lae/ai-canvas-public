using System.Diagnostics;
using System.Reflection;
using AiCanvas.WebViewHost;

if (args[0] == "child")
{
    using var childLease = new PackageWindowLifetime(args[1]);
    Console.WriteLine("ready"); Console.Out.Flush();
    if (Console.ReadLine() == "close")
    {
        var last = await childLease.CloseAsync(() => { File.WriteAllText(Path.Combine(args[1], "child-stopped"), "yes"); return Task.CompletedTask; });
        Console.WriteLine(last ? "last" : "shared");
    }
    return;
}
var root = Path.Combine(Path.GetFullPath(args[0]), "temp", "window-lifetime-tests", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var checks = 0;
void Check(bool result, string name) { if (!result) throw new Exception(name); checks++; Console.WriteLine("PASS " + name); }
async Task<Process> Child(string data)
{
    var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true };
    if (Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
    info.ArgumentList.Add("child"); info.ArgumentList.Add(data);
    var process = Process.Start(info)!;
    Check(await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) == "ready", "other process registered");
    return process;
}
var multi = Path.Combine(root, "multi");
using (var first = new PackageWindowLifetime(multi))
using (var other = await Child(multi))
{
    var stopped = false;
    Check(!await first.CloseAsync(() => { stopped = true; return Task.CompletedTask; }), "first window not last");
    Check(!stopped, "closing one process preserves shared service");
    await other.StandardInput.WriteLineAsync("close"); await other.StandardInput.FlushAsync();
    Check(await other.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) == "last", "other process closes last");
    await other.WaitForExitAsync();
    Check(File.Exists(Path.Combine(multi, "child-stopped")), "last window invokes stop");
    Check(!Directory.EnumerateFiles(Path.Combine(multi, "desktop-windows")).Any(), "leases removed after orderly close");
}
var failure = Path.Combine(root, "failure");
using (var window = new PackageWindowLifetime(failure))
{
    try { await window.CloseAsync(() => throw new IOException("expected failure")); throw new Exception("failure swallowed"); } catch (IOException) { checks++; }
    Check(Directory.GetFiles(Path.Combine(failure, "desktop-windows")).Length == 1, "failed stop retains window lease");
    Check(await window.RunAsync(() => Task.FromResult(true), default), "window can reconnect after stop failure");
    Check(await window.CloseAsync(() => Task.CompletedTask), "retry closes last window");
}
var race = Path.Combine(root, "race");
using (var closing = new PackageWindowLifetime(race))
{
    var entered = new TaskCompletionSource(); var release = new TaskCompletionSource();
    var stop = closing.CloseAsync(async () => { entered.SetResult(); await release.Task; });
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    var opening = Task.Run(() => new PackageWindowLifetime(race));
    await Task.Delay(250);
    Check(!opening.IsCompleted, "reopen waits for in-progress stop");
    release.SetResult(); await stop;
    using var next = await opening.WaitAsync(TimeSpan.FromSeconds(5));
    Check(await next.RunAsync(() => Task.FromResult(true), default), "reopen starts only after old stop");
    await next.CloseAsync(() => Task.CompletedTask);
}
var stale = Path.Combine(root, "stale");
using (var crashed = await Child(stale)) { crashed.Kill(); await crashed.WaitForExitAsync(); }
using (var next = new PackageWindowLifetime(stale))
{
    Check(await next.CloseAsync(() => Task.CompletedTask), "stale lease does not prevent last-close shutdown");
}
Console.WriteLine($"WindowLifetimeTests: {checks} checks passed.");
