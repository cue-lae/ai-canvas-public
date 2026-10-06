namespace AiCanvas.WebViewHost;

// Observes connection work; the existing controller still owns validation and
// the package lifetime still owns cross-window startup/shutdown coordination.
internal sealed class StartupConnectionCoordinator
{
    private static readonly BridgeConnectionResult Unavailable = new("disconnected", "UNAVAILABLE");
    private readonly Func<bool, string, CancellationToken, Task<BridgeConnectionResult>> _connect;
    private readonly object _sync = new();
    private readonly HashSet<Task> _pending = new();
    private Task<BridgeConnectionResult>? _startup;

    internal StartupConnectionCoordinator(Func<bool, string, CancellationToken, Task<BridgeConnectionResult>> connect)
        => _connect = connect;

    internal Task<BridgeConnectionResult> Start(string address, CancellationToken cancellation)
    {
        lock (_sync)
        {
            if (_startup is not null) return _startup;
            _startup = ObserveStartupAsync(address, cancellation);
            Track(_startup);
            return _startup;
        }
    }

    private async Task<BridgeConnectionResult> ObserveStartupAsync(string address, CancellationToken cancellation)
    {
        try { return await InvokeAsync(true, address, cancellation); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return Unavailable; }
    }

    internal Task<BridgeConnectionResult> ConnectAsync(bool ensure, string address, CancellationToken cancellation)
    {
        var request = ConnectCoreAsync(ensure, address, cancellation);
        Track(request);
        return request;
    }

    private async Task<BridgeConnectionResult> ConnectCoreAsync(bool ensure, string address, CancellationToken cancellation)
    {
        Task<BridgeConnectionResult>? startup;
        lock (_sync) startup = _startup;
        if (startup is { IsCompleted: false }) await startup.WaitAsync(cancellation);
        cancellation.ThrowIfCancellationRequested();
        // Never infer current connection/ownership from the earlier startup result.
        return await InvokeAsync(ensure, address, cancellation);
    }

    private async Task<BridgeConnectionResult> InvokeAsync(bool ensure, string address, CancellationToken cancellation)
    {
        try
        {
            cancellation.ThrowIfCancellationRequested();
            var operation = _connect(ensure, address, cancellation);
            Track(operation);
            var result = await operation.WaitAsync(cancellation);
            cancellation.ThrowIfCancellationRequested();
            return result;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception) { return Unavailable; }
    }

    private void Track(Task task)
    {
        lock (_sync) _pending.Add(task);
        _ = task.ContinueWith(completed =>
        {
            // A cancelled waiter can leave an underlying operation finishing later.
            if (completed.IsFaulted) _ = completed.Exception;
            lock (_sync) _pending.Remove(completed);
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    // Call after the owner prevents new requests and cancels its original token.
    internal async Task DrainAsync()
    {
        while (true)
        {
            Task[] pending;
            lock (_sync) pending = _pending.ToArray();
            if (pending.Length == 0) return;
            try { await Task.WhenAll(pending); }
            catch (Exception) { /* Faults/cancellation are already observed. */ }
        }
    }
}
