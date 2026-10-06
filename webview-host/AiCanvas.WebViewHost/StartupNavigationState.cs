namespace AiCanvas.WebViewHost;

internal enum StartupNavigationAction { None, Reveal, Error }
internal readonly record struct StartupNavigationDecision(StartupNavigationAction Action, string? Message = null);

// The window's one navigation result is retained even while display is paused
// for coordinated shutdown. No Canvas content or scene state lives here.
internal sealed class StartupNavigationState
{
    private const string TimeoutMessage = "页面加载超时：请重新启动 AI Canvas。";
    internal bool IsReady { get; private set; }
    private string? _failure;
    private bool _deadlineElapsed;

    internal void NavigationCompleted(bool success, string? failure)
    {
        IsReady = success;
        _failure = success ? null : failure ?? "页面加载失败，请重新启动 AI Canvas。";
    }

    internal void DeadlineElapsed() => _deadlineElapsed = true;

    internal StartupNavigationDecision Pending(bool closing, bool disposed, bool loadingCancelled, bool finished)
    {
        if (closing || disposed || loadingCancelled) return new(StartupNavigationAction.None);
        if (_failure is not null) return new(StartupNavigationAction.Error, _failure);
        if (finished) return new(StartupNavigationAction.None);
        // On a failed close, prefer the navigation result received while paused.
        if (IsReady) return new(StartupNavigationAction.Reveal);
        if (_deadlineElapsed) return new(StartupNavigationAction.Error, TimeoutMessage);
        return new(StartupNavigationAction.None);
    }
}
