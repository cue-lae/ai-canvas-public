using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace AiCanvas.Diagnostics;

internal enum TimingStage
{
    ProcessEntry, WindowConstructBegin, WindowConstructEnd, WindowLoaded,
    BrowserEnvironmentBegin, BrowserEnvironmentEnd, BrowserControlBegin, BrowserControlEnd,
    BridgePrepareBegin, BridgePrepareEnd, BridgeProbeBegin, BridgeProbeEnd, BridgeSpawn,
    NavigateBegin, NavigationCompleted, CanvasReady, RevealBegin, RevealEnd,
    InstallerStateRead, InstallerLayoutReady, InstallBegin, EngineExtractBegin,
    EngineExtractEnd, EngineStart, EngineExit, InstallComplete, WindowClose
}

internal static class TimingTrace
{
#if CANVAS_TIMING_DIAGNOSTICS
    private static readonly object Gate = new();
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly DateTime Started = Process.GetCurrentProcess().StartTime.ToUniversalTime();
    private static readonly string FilePath = Path.Combine(Path.GetTempPath(), "AI-Canvas-Timing", $"process-{Environment.ProcessId}.jsonl");
    private static int _rows;
#endif

    [Conditional("CANVAS_TIMING_DIAGNOSTICS")]
    internal static void Mark(TimingStage stage)
    {
#if CANVAS_TIMING_DIAGNOSTICS
        // Fixed enum only: no page data, paths, tokens, arguments or exception text.
        lock (Gate)
        {
            if (_rows++ >= 200) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                File.AppendAllText(FilePath, JsonSerializer.Serialize(new {
                    stage = stage.ToString(), elapsedMs = Math.Round(Clock.Elapsed.TotalMilliseconds, 3),
                    processAgeMs = Math.Round((DateTime.UtcNow - Started).TotalMilliseconds, 3)
                }) + "\n");
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
#endif
    }
}
