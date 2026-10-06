namespace AiCanvas.WebViewHost;

// Serializes physical writes, not only acknowledgements. An older revision
// that arrives after a newer completed write cannot roll the file backwards.
internal sealed class DocumentSaveQueue
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private long _writtenRevision = -1;
    internal async Task<(bool Written, string? Path)> WriteAsync(long revision, Func<Task<string?>> write)
    {
        await _gate.WaitAsync();
        try
        {
            if (revision < _writtenRevision) return (false, null);
            var path = await write();
            if (path is null) return (false, null);
            _writtenRevision = revision;
            return (true, path);
        }
        finally { _gate.Release(); }
    }
    internal async Task DrainAsync()
    {
        await _gate.WaitAsync();
        _gate.Release();
    }
    internal async Task ExclusiveAsync(Func<Task> operation)
    {
        await _gate.WaitAsync();
        try { await operation(); }
        finally { _gate.Release(); }
    }
}
