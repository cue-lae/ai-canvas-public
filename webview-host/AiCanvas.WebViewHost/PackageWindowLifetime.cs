using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Globalization;

namespace AiCanvas.WebViewHost;

// An OS-held file lease represents one actual window, never an MCP client.
// All start/register/last-close operations use the same process-wide gate.
internal sealed class PackageWindowLifetime : IDisposable
{
    private readonly string _directory;
    private readonly string _gateName;
    private readonly string _leasePath;
    private FileStream? _lease;

    internal PackageWindowLifetime(string dataRoot)
    {
        _directory = Path.Combine(Path.GetFullPath(dataRoot), "desktop-windows");
        _gateName = "Local\\AI.Canvas.WindowLifetime." + Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(_directory.ToUpperInvariant())))[..24];
        _leasePath = Path.Combine(_directory, Guid.NewGuid().ToString("N") + ".lease");
        WithGate(() => {
            Directory.CreateDirectory(_directory);
            if ((File.GetAttributes(_directory) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("窗口状态目录包含链接，无法安全管理连接。");
            _ = CountOtherWindows();
            _lease = new FileStream(_leasePath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            var identity = Encoding.UTF8.GetBytes(Environment.ProcessId.ToString(CultureInfo.InvariantCulture) + "\n" +
                Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture));
            _lease.Write(identity); _lease.Flush(true);
            return true;
        });
    }

    private T WithGate<T>(Func<T> action, CancellationToken cancellation = default)
    {
        using var gate = new Mutex(false, _gateName);
        var held = false;
        try
        {
            var clock = Stopwatch.StartNew();
            while (!held)
            {
                cancellation.ThrowIfCancellationRequested();
                try { held = gate.WaitOne(100); } catch (AbandonedMutexException) { held = true; }
                if (!held && clock.Elapsed > TimeSpan.FromSeconds(25))
                    throw new IOException("连接正在切换，请稍后重试。");
            }
            cancellation.ThrowIfCancellationRequested();
            return action();
        }
        finally { if (held) gate.ReleaseMutex(); }
    }

    internal Task<T> RunAsync<T>(Func<Task<T>> action, CancellationToken cancellation) =>
        Task.Run(() => WithGate(() => {
            if (_lease == null) throw new OperationCanceledException("Window has already closed");
            return action().GetAwaiter().GetResult();
        }, cancellation), cancellation);

    private int CountOtherWindows()
    {
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(_directory, "*.lease"))
        {
            if (file == _leasePath || !Guid.TryParseExact(Path.GetFileNameWithoutExtension(file), "N", out _)) continue;
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("无法确认其他画布窗口状态。");
            try
            {
                using var read = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (read.Length > 128) throw new InvalidDataException("Unknown window lease contents");
                using var reader = new StreamReader(read, Encoding.UTF8);
                if (!int.TryParse(reader.ReadLine(), out var pid) || !long.TryParse(reader.ReadLine(), out var started))
                    throw new InvalidDataException("Unknown window lease identity");
                var alive = false;
                try { using var process = Process.GetProcessById(pid); alive = !process.HasExited && process.StartTime.ToUniversalTime().Ticks == started; }
                catch (ArgumentException) { }
                reader.Dispose(); read.Dispose();
                if (alive)
                {
                    try { using var exclusive = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None); }
                    catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33) { count++; continue; }
                }
                // Process identity, including creation time, prevents PID reuse
                // from making a crashed window appear live. OS handle cleanup may lag.
                try { File.Delete(file); }
                catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33) { }
            }
            catch (FileNotFoundException) { }
        }
        return count;
    }

    internal Task<bool> CloseAsync(Func<Task> stopOwnedBridge) => Task.Run(() => WithGate(() => {
        if (_lease == null) return false;
        var last = CountOtherWindows() == 0;
        // Retain our lease on failure so the window can stay open and retry.
        if (last) stopOwnedBridge().GetAwaiter().GetResult();
        ReleaseLease();
        return last;
    }));

    private void ReleaseLease()
    {
        _lease?.Dispose(); _lease = null;
        try { if (File.Exists(_leasePath)) File.Delete(_leasePath); }
        catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33) { }
    }

    public void Dispose() => WithGate(() => { ReleaseLease(); return true; });
}
