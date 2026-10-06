using System.Collections.Concurrent;
using AiCanvas.WebViewHost;

const string address = "http://127.0.0.1:43129";
var ready = new BridgeConnectionResult("connected", "READY");
var checks = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; Console.WriteLine("PASS " + name); }
TaskCompletionSource<BridgeConnectionResult> Hold() => new(TaskCreationOptions.RunContinuationsAsynchronously);
async Task Cancelled(Task task, string name)
{
    try { await task.WaitAsync(TimeSpan.FromSeconds(5)); throw new Exception("Expected cancellation: " + name); }
    catch (OperationCanceledException) { Check(true, name); }
}

// A file-open request is local, single-document and one-shot. The host only
// reads the startup path; no page message can name an arbitrary system file.
{
    var root = Path.Combine(Path.GetTempPath(), "AiCanvasDocumentOpen", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    try
    {
        var project = Path.Combine(root, "中文 文件.excalidraw");
        await File.WriteAllTextAsync(project, "{\"type\":\"excalidraw\",\"elements\":[]}");
        Check(DocumentOpenRequest.TryCreate([project], out var request, out _) && request is not null, "local excalidraw path is accepted");
        Check(!request!.TryTakeDelivery("wrong", out _), "wrong request identity cannot claim document content");
        Check(request.TryTakeDelivery(request.RequestId, out var delivery) && delivery!.FileName == "中文 文件.excalidraw", "matched request delivers the selected local file once");
        Check(!request.TryTakeDelivery(request.RequestId, out _), "duplicate ready messages cannot redeliver a document");
        Check(DocumentOpenRequest.TryCreate([], out var none, out _) && none is null, "ordinary startup remains argument-free");
        Check(!DocumentOpenRequest.TryCreate(["https://example.test/file.excalidraw"], out _, out _), "network URLs are rejected");
        Check(!DocumentOpenRequest.TryCreate([root], out _, out _), "directories are rejected");
        Check(!DocumentOpenRequest.TryCreate([project, project], out _, out _), "multiple document arguments are rejected");
    }
    finally { Directory.Delete(root, true); }
}

// Startup is observed without blocking its caller. Pending page requests share
// that preparation, then independently preserve their requested operation.
{
    var gate = Hold();
    var calls = new ConcurrentQueue<(bool Ensure, string Address)>();
    var coordinator = new StartupConnectionCoordinator((ensure, target, _) =>
    {
        calls.Enqueue((ensure, target));
        return calls.Count == 1 ? gate.Task : Task.FromResult(target == address ? ready : new BridgeConnectionResult("disconnected", "CONFIG_MISMATCH"));
    });
    var startup = coordinator.Start(address, CancellationToken.None);
    Check(!startup.IsCompleted && calls.Count == 1, "startup returns while connection is still pending");
    Check(ReferenceEquals(startup, coordinator.Start(address, CancellationToken.None)), "startup is started only once");
    var check = coordinator.ConnectAsync(false, address, CancellationToken.None);
    var ensure = coordinator.ConnectAsync(true, address, CancellationToken.None);
    var wrongAddress = coordinator.ConnectAsync(true, "http://127.0.0.1:1", CancellationToken.None);
    Check(calls.Count == 1 && !check.IsCompleted && !ensure.IsCompleted, "page requests wait without issuing duplicate startup work");
    gate.SetResult(ready);
    await Task.WhenAll(startup, check, ensure, wrongAddress).WaitAsync(TimeSpan.FromSeconds(5));
    Check(calls.Count == 4 && calls.Contains((false, address)) && calls.Contains((true, "http://127.0.0.1:1")), "revalidation preserves check/ensure and address");
    Check((await wrongAddress).Code == "CONFIG_MISMATCH", "earlier success does not bypass address validation");
    await coordinator.DrainAsync();
}

// Returned failures keep their existing classification; exceptions expose no details.
{
    var count = 0;
    var coordinator = new StartupConnectionCoordinator((_, _, _) =>
    {
        if (Interlocked.Increment(ref count) == 1) throw new IOException("private diagnostic detail");
        return Task.FromResult(ready);
    });
    var result = await coordinator.Start(address, CancellationToken.None);
    Check(result.Status == "disconnected" && result.Code == "UNAVAILABLE", "startup exception becomes fixed unavailable result");
    Check((await coordinator.ConnectAsync(true, address, CancellationToken.None)).Code == "READY", "failed startup does not permanently block retry");
    await coordinator.DrainAsync();
    var denied = new StartupConnectionCoordinator((_, _, _) => Task.FromResult(new BridgeConnectionResult("disconnected", "ORIGIN_DENIED")));
    Check((await denied.Start(address, CancellationToken.None)).Code == "ORIGIN_DENIED", "known startup rejection code is preserved");
    Check((await denied.ConnectAsync(false, address, CancellationToken.None)).Code == "ORIGIN_DENIED", "known page rejection code is preserved");
}

// A cancelled waiter must never revive and issue a new connection after startup.
{
    var startupGate = Hold();var count = 0;
    var coordinator = new StartupConnectionCoordinator((_, _, _) =>
    {
        Interlocked.Increment(ref count);return startupGate.Task;
    });
    var startup = coordinator.Start(address, CancellationToken.None);
    using var request = new CancellationTokenSource();
    var pending = coordinator.ConnectAsync(true, address, request.Token);
    request.Cancel();await Cancelled(pending, "cancelled startup waiter finishes promptly");
    var drain = coordinator.DrainAsync();
    Check(!drain.IsCompleted, "shutdown still waits for underlying startup work");
    startupGate.SetResult(ready);await startup;await drain.WaitAsync(TimeSpan.FromSeconds(5));
    Check(count == 1, "cancelled request does not start a late connection");
    using var alreadyCancelled = new CancellationTokenSource();alreadyCancelled.Cancel();
    await Cancelled(coordinator.ConnectAsync(true, address, alreadyCancelled.Token), "cancellation checked after an already-completed startup");
    Check(count == 1, "cancelled completed-startup request does not call controller");
}

// Deadline/lifetime cancellation bounds the waiter, without disposing a controller
// that still has work in flight (even if that operation ignores cancellation).
{
    var operation = Hold();var coordinator = new StartupConnectionCoordinator((_, _, _) => operation.Task);
    using var deadline = new CancellationTokenSource();
    var pending = coordinator.ConnectAsync(false, address, deadline.Token);
    deadline.Cancel();await Cancelled(pending, "request deadline releases the page waiter");
    var drain = coordinator.DrainAsync();
    Check(!drain.IsCompleted, "drain retains an operation after its waiter was cancelled");
    operation.SetException(new IOException("late private fault"));
    await drain.WaitAsync(TimeSpan.FromSeconds(5));
    Check(pending.IsCanceled, "late result or fault cannot become a stale success");
}

// Closing with the old token cannot revive old work when stop failure permits retry.
{
    var gate = Hold();var count = 0;
    var coordinator = new StartupConnectionCoordinator((_, _, cancellation) =>
    {
        return Interlocked.Increment(ref count) == 1 ? gate.Task.WaitAsync(cancellation) : Task.FromResult(ready);
    });
    using var oldLifetime = new CancellationTokenSource();
    var startup = coordinator.Start(address, oldLifetime.Token);
    var oldRequest = coordinator.ConnectAsync(true, address, oldLifetime.Token);
    oldLifetime.Cancel();
    Check((await startup).Code == "UNAVAILABLE", "startup cancellation is observed");
    await Cancelled(oldRequest, "old page request remains cancelled");
    await coordinator.DrainAsync().WaitAsync(TimeSpan.FromSeconds(5));
    using var newLifetime = new CancellationTokenSource();
    Check((await coordinator.ConnectAsync(true, address, newLifetime.Token)).Code == "READY", "new lifetime can retry after a cancelled startup");
    Check(count == 2, "retry does not revive the old request");
}

// Navigation and the deadline can complete while a coordinated close is paused.
// A failed stop must recover the saved outcome, not wait for a second event.
{
    var navigation = new StartupNavigationState();
    navigation.NavigationCompleted(true, null);
    navigation.DeadlineElapsed();
    Check(navigation.Pending(true, false, false, false).Action == StartupNavigationAction.None, "navigation during close does not display early");
    Check(navigation.Pending(false, false, false, false).Action == StartupNavigationAction.Reveal, "failed close resumes navigation that completed while paused");
    Check(navigation.Pending(false, true, false, false).Action == StartupNavigationAction.None, "disposed window never resumes saved navigation");
    Check(navigation.Pending(false, false, false, true).Action == StartupNavigationAction.None, "deadline cannot interrupt an already completed startup");

    var timedOut = new StartupNavigationState();
    timedOut.DeadlineElapsed();
    Check(timedOut.Pending(true, false, false, false).Action == StartupNavigationAction.None, "deadline while closing is retained without showing error");
    Check(timedOut.Pending(false, false, false, false).Action == StartupNavigationAction.Error, "failed close reports the saved deadline if navigation is not ready");
    timedOut.NavigationCompleted(true, null);
    Check(timedOut.Pending(false, false, true, false).Action == StartupNavigationAction.None, "navigation after an already-reported fatal error cannot revive display");

    var failed = new StartupNavigationState();
    failed.NavigationCompleted(false, "navigation failure");
    Check(failed.Pending(true, false, false, false).Action == StartupNavigationAction.None, "navigation failure during closing is deferred");
    var restored = failed.Pending(false, false, false, false);
    Check(restored.Action == StartupNavigationAction.Error && restored.Message == "navigation failure", "failed close restores the actual navigation error");
    Check(failed.Pending(false, false, false, true).Action == StartupNavigationAction.Error, "later navigation failure remains visible after a completed startup");
}

Console.WriteLine($"StartupConnectionTests: {checks} checks passed.");
