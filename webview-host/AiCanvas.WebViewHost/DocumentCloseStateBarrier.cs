namespace AiCanvas.WebViewHost;

// A correlated freshness acknowledgement, not another document state owner.
internal sealed class DocumentCloseStateBarrier(DocumentSessionState state)
{
    private string? _requestId;
    private TaskCompletionSource<bool>? _pending;

    internal async Task<bool> RefreshAsync(Action<string> send, TimeSpan timeout, CancellationToken cancellation = default)
    {
        if (_pending is not null) return false;
        var requestId = Guid.NewGuid().ToString("N");
        var pending = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _requestId = requestId; _pending = pending;
        try
        {
            send(requestId);
            return await pending.Task.WaitAsync(timeout, cancellation);
        }
        catch (Exception error) when (error is TimeoutException or OperationCanceledException or InvalidOperationException or System.IO.IOException)
        {
            return false;
        }
        finally { _requestId = null; _pending = null; }
    }

    internal bool Receive(string documentId, string requestId, bool ready, long revision, bool dirty)
    {
        if (_pending is null || documentId != state.Id || requestId != _requestId) return false;
        if (!ready) { _pending.TrySetResult(false); return true; }
        if (!state.Observe(documentId, revision, dirty)) return false;
        _pending.TrySetResult(true);
        return true;
    }
    internal void Cancel() => _pending?.TrySetResult(false);
}

// Hold through refresh, prompt and save. Every cancellation/failure releases it.
internal sealed class DocumentCloseInputGate : IDisposable
{
    private Action<bool>? _setEnabled;
    internal DocumentCloseInputGate(Action<bool> setEnabled)
    {
        _setEnabled = setEnabled;
        setEnabled(false);
    }
    public void Dispose()
    {
        var restore = _setEnabled; _setEnabled = null;
        restore?.Invoke(true);
    }
}
