namespace AiCanvas.WebViewHost;

// Use the controller's existing operation flag. No second tab/state owner.
internal static class DocumentOpenOperation
{
    internal static async Task<bool> TryRunAsync(Func<bool> blocked, Action<bool> setBusy, Func<Task> open)
    {
        if (blocked()) return false;
        setBusy(true);
        try { await open(); return true; }
        finally { setBusy(false); }
    }
}
