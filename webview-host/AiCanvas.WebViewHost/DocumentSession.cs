using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AiCanvas.WebViewHost;

// This object follows the living view between windows. It owns no replacement
// Canvas/history. Owner can change; identity, Core and pending replies cannot.
internal sealed class DocumentSession : IDisposable
{
    private readonly DocumentOpenRequest? _open;
    private readonly DocumentSaveQueue _saves = new();
    private readonly DocumentCloseStateBarrier _closeState;
    private bool _canvasReported;
    private readonly Dictionary<string, TaskCompletionSource<bool>> _commands = new(StringComparer.Ordinal);
    private bool _offered, _delivered, _disposed;
    private string? _clipboardReadRequest;
    private long _clipboardReadDeadline;
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal DocumentSession(WebView2 view, DocumentOpenRequest? open)
    {
        View = view; _open = open;
        State = new DocumentSessionState(open?.FilePath);
        _closeState = new DocumentCloseStateBarrier(State);
        State.Changed += () => Changed?.Invoke(this);
    }
    internal WebView2 View { get; }
    internal DocumentSessionState State { get; }
    internal Window? Owner { get; set; }
    internal bool Ready => _ready.Task.IsCompletedSuccessfully && _ready.Task.Result;
    internal Task? Initialization { get; set; }
    internal Action<DocumentSession>? Changed { get; set; }
    internal Func<Task>? OpenFilePicker { get; set; }
    internal Func<string, bool> PathAvailable { get; set; } = _ => false;
    internal Func<DocumentSession, string, bool, CancellationToken, Task<BridgeConnectionResult>>? Connect { get; set; }
    internal Dictionary<string, string> Palette { get; } = new(StringComparer.Ordinal);
    internal CoreWebView2? OriginalCore { get; private set; }
    internal event Action? DisposingView;
    internal int NavigationCount { get; private set; }
    internal Task<bool> ReadyTask => _ready.Task;
    internal bool Lightweight { get; private set; }
    internal void SetPresentation(bool lightweight)
    {
        Lightweight = lightweight;
        Post(new { type = "canvas-document-presentation", documentId = State.Id, presentation = lightweight ? "lightweight" : "normal" });
    }

    internal async Task BindCoreAsync(bool initialWindowOwnsFileHandshake)
    {
        var core = View.CoreWebView2 ?? throw new IOException("WebView尚未初始化。");
        if (InstalledPackagePolicy.Enabled)
            core.Settings.AreDevToolsEnabled = false;
        // Browser page zoom changes the entire UI independently for each tab.
        // Keep one CSS-to-DIP baseline; Canvas scene zoom and OS DPI stay independent.
        core.Settings.IsZoomControlEnabled = false;
        View.ZoomFactor = 1;
        OriginalCore = core;
        await core.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window,'__AI_CANVAS_NATIVE_DOCUMENT__',{value:Object.freeze(" +
            JsonSerializer.Serialize(new { documentId = State.Id, recoveryId = State.RecoveryId, isolated = DocumentRunScope.Isolated,
                presentation = Lightweight ? "lightweight" : "normal" }) + "),writable:false,configurable:false});");
        if (DocumentRunScope.Isolated)
        {
            var environment = core.Environment;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) =>
            {
                if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) &&
                    (IsSource(uri) || uri.Scheme is "data" or "blob" or "about")) return;
                e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 403, "Isolated candidate network disabled", "Content-Type: text/plain");
            };
        }
        core.NavigationStarting += (_, e) =>
        {
            NavigationCount++;
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || !IsSource(uri) || uri.AbsolutePath != "/index.html") e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind != CoreWebView2PermissionKind.ClipboardRead || _clipboardReadRequest is null) return;
            var valid = !_disposed && Ready && View.IsVisible && Owner?.IsActive == true && e.IsUserInitiated &&
                Environment.TickCount64 <= _clipboardReadDeadline && Uri.TryCreate(e.Uri, UriKind.Absolute, out var origin) && IsSource(origin);
            _clipboardReadRequest = null;
            e.SavesInProfile = false;
            e.State = valid ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            e.Handled = true;
        };
        core.WebMessageReceived += async (_, e) =>
        {
            try
            {
                if (_disposed || !Uri.TryCreate(e.Source, UriKind.Absolute, out var uri) || !IsSource(uri) || uri.AbsolutePath != "/index.html") return;
                using var json = JsonDocument.Parse(e.WebMessageAsJson);
                var root = json.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type)) return;
                var kind = type.GetString();
                if ((kind == "canvas-clipboard-read-begin" || kind == "canvas-clipboard-read-end") && Matches(root) &&
                    root.TryGetProperty("requestId", out var clipboardId) && clipboardId.ValueKind == JsonValueKind.String && Guid.TryParse(clipboardId.GetString(), out var clipboardGuid))
                {
                    var requestId = clipboardId.GetString()!;
                    if (kind == "canvas-clipboard-read-end") { if (_clipboardReadRequest == requestId) _clipboardReadRequest = null; }
                    else
                    {
                        var ready = Ready && View.IsVisible && Owner?.IsActive == true;
                        _clipboardReadRequest = ready ? requestId : null;
                        _clipboardReadDeadline = Environment.TickCount64 + 2000;
                        Post(new { type = "canvas-clipboard-read-ready", documentId = State.Id, requestId, ready });
                    }
                }
                else if (kind == "canvas-document-state" && Matches(root) &&
                    root.TryGetProperty("revision", out var revision) && revision.TryGetInt64(out var number) &&
                    root.TryGetProperty("dirty", out var dirty) && dirty.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    _canvasReported = true;
                    State.Observe(State.Id, number, dirty.GetBoolean());
                }
                else if (kind == "canvas-document-close-state-result" && Matches(root) &&
                    root.TryGetProperty("requestId", out var refreshId) && refreshId.ValueKind == JsonValueKind.String &&
                    root.TryGetProperty("ready", out var refreshReady) && refreshReady.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    var ready = refreshReady.GetBoolean();
                    if (!ready) _closeState.Receive(State.Id, refreshId.GetString()!, false, 0, false);
                    else if (root.TryGetProperty("revision", out var freshRevision) && freshRevision.TryGetInt64(out var freshNumber) &&
                        root.TryGetProperty("dirty", out var freshDirty) && freshDirty.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        _closeState.Receive(State.Id, refreshId.GetString()!, true, freshNumber, freshDirty.GetBoolean());
                }
                else if (kind == "canvas-theme" && Matches(root) && root.TryGetProperty("palette", out var palette) && palette.ValueKind == JsonValueKind.Object)
                {
                    foreach (var name in new[] { "header", "canvas", "text", "mutedText", "icon", "accentSurface", "accentText", "surface", "raised", "border", "accent", "danger" })
                        if (palette.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String &&
                            System.Text.RegularExpressions.Regex.IsMatch(value.GetString()!, "^#[A-Fa-f0-9]{6}$")) Palette[name] = value.GetString()!;
                    Changed?.Invoke(this);
                }
                else if (kind == "canvas-document-open-picker" && Matches(root) && OpenFilePicker is not null) await OpenFilePicker();
                else if (kind == "canvas-document-save" && Matches(root)) await ReceiveSaveAsync(root.Clone());
                else if (kind == "canvas-document-command-result" && Matches(root) &&
                    root.TryGetProperty("requestId", out var commandId) && commandId.ValueKind == JsonValueKind.String &&
                    _commands.TryGetValue(commandId.GetString()!, out var command))
                {
                    var success = root.TryGetProperty("status", out var status) && status.GetString() == "saved" &&
                        root.TryGetProperty("revision", out var current) && current.TryGetInt64(out var currentRevision) && currentRevision == State.Revision &&
                        root.TryGetProperty("savedRevision", out var saved) && saved.TryGetInt64(out var savedRevision) && savedRevision == State.SavedRevision &&
                        root.TryGetProperty("dirty", out var commandDirty) && commandDirty.ValueKind == JsonValueKind.False && !State.Dirty;
                    command.TrySetResult(success);
                }
                else if (kind == "canvas-bridge-connect" && root.TryGetProperty("requestId", out var bridgeId) && bridgeId.ValueKind == JsonValueKind.String &&
                    Guid.TryParse(bridgeId.GetString(), out var parsedBridgeRequest) && root.TryGetProperty("action", out var action) && action.GetString() is "check" or "ensure" &&
                    root.TryGetProperty("baseUrl", out var baseUrl) && baseUrl.ValueKind == JsonValueKind.String)
                {
                    var result = DocumentRunScope.Isolated || Connect is null ? new BridgeConnectionResult("disconnected", "UNAVAILABLE") :
                        await Connect(this, baseUrl.GetString()!, action.GetString() == "ensure", CancellationToken.None);
                    Post(new { type = "canvas-bridge-state", requestId = bridgeId.GetString(), documentId = State.Id, status = result.Status, code = result.Code });
                }
                else if (kind == "canvas-ready")
                {
                    SetPresentation(Lightweight);
                    _canvasReported = true;
                    if (_open is null) _ready.TrySetResult(true);
                    else if (!initialWindowOwnsFileHandshake && !_offered)
                    {
                        _offered = true;
                        Post(new { type = "canvas-document-open-offer", requestId = _open.RequestId, name = _open.FileName });
                    }
                }
                else if (kind == "canvas-document-open-ready" && _open is not null && !initialWindowOwnsFileHandshake && _offered && !_delivered &&
                    root.TryGetProperty("requestId", out var openId) && openId.GetString() == _open?.RequestId &&
                    _open!.TryTakeDelivery(openId.GetString()!, out var delivery))
                {
                    _delivered = true;
                    Post(new { type = "canvas-document-open", requestId = delivery!.RequestId, name = delivery.FileName, content = delivery.Content });
                }
                else if (kind == "canvas-document-open-result" && root.TryGetProperty("requestId", out var resultOpenId) && resultOpenId.GetString() == _open?.RequestId &&
                    root.TryGetProperty("ok", out var ok) && ok.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    _ready.TrySetResult(ok.GetBoolean());
            }
            catch (Exception error) when (error is JsonException or InvalidOperationException or IOException or OperationCanceledException)
            {
                if (!_ready.Task.IsCompleted) _ready.TrySetException(new IOException("文档初始化或消息处理未完成。", error));
            }
        };
    }

    private bool Matches(JsonElement value) => value.TryGetProperty("documentId", out var id) && id.ValueKind == JsonValueKind.String && id.GetString() == State.Id;
    private static bool IsSource(Uri uri) => HostNavigationPolicy.IsAllowed(uri) && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
    private void Post(object value) { if (!_disposed) View.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(value)); }

    private async Task ReceiveSaveAsync(JsonElement request)
    {
        if (!request.TryGetProperty("requestId", out var id) || id.ValueKind != JsonValueKind.String || !Guid.TryParse(id.GetString(), out _) ||
            !request.TryGetProperty("revision", out var version) || !version.TryGetInt64(out var revision) ||
            !request.TryGetProperty("content", out var value) || value.ValueKind != JsonValueKind.String ||
            Owner is null || !State.BeginSave(id.GetString()!, revision)) return;
        var requestId = id.GetString()!;
        string status = "failed", message = "保存未完成。", confirmedPath = "";
        try
        {
            var cancelled = false;
            var saveAs = false;
            if (request.TryGetProperty("saveAs", out var saveAsValue))
            {
                if (saveAsValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new InvalidOperationException("另存请求格式无效。");
                saveAs = saveAsValue.GetBoolean();
            }
            var outcome = await _saves.WriteAsync(revision, async () =>
            {
                var path = await DocumentFileStore.SaveAsync(State, value.GetString()!, Owner!, PathAvailable, saveAs);
                if (path is not null) State.CompleteSave(new DocumentSaveReceipt(State.Id, requestId, revision, "saved"), path);
                cancelled = path is null; return path;
            });
            status = outcome.Written ? "saved" : cancelled ? "cancelled" : "failed";
            message = cancelled ? "已取消保存。" : outcome.Written ? "" : "过期保存已拒绝，磁盘没有回退。";
            confirmedPath = outcome.Path ?? "";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException) { message = error.Message; }
        var result = new DocumentSaveReceipt(State.Id, requestId, revision, status, State.Name);
        if (status != "saved") State.CompleteSave(result, null);
        Post(new { type = "canvas-document-save-result", documentId = State.Id, recoveryId = State.RecoveryId, requestId, revision, status, fileName = State.Name, message });
    }

    internal async Task<bool> SaveForCloseAsync(bool saveAs = false)
    {
        if (_disposed || !Ready) return false;
        var requestId = Guid.NewGuid().ToString("N");
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _commands.Add(requestId, completed);
        try
        {
            Post(new { type = "canvas-document-command", action = saveAs ? "save-as" : "save", documentId = State.Id, requestId });
            return await completed.Task.WaitAsync(TimeSpan.FromMinutes(5));
        }
        catch (TimeoutException) { return false; }
        finally { _commands.Remove(requestId); }
    }
    internal Task DrainSavesAsync() => _saves.DrainAsync();
    internal Task RenameAsync(string proposedName) => _saves.ExclusiveAsync(() =>
    {
        if (_disposed || !Ready) throw new IOException("画布尚未准备好，名称未改动。");
        var name = DocumentRenamePolicy.FileName(proposedName);
        if (name == State.Name) return Task.CompletedTask;
        var path = State.FilePath is null ? null :
            DocumentRenamePolicy.RenameFile(State.FilePath, name, PathAvailable, DocumentRunScope.CanWrite);
        State.Renamed(name, path);
        Post(new { type = "canvas-document-renamed", documentId = State.Id, fileName = State.Name, recoveryId = State.RecoveryId });
        return Task.CompletedTask;
    });
    internal Task<bool> RefreshCloseStateAsync()
    {
        if (_disposed) return Task.FromResult(false);
        // Before any Canvas has reported readiness/state, no editable document
        // has been presented. An initialization/error page may still be closed.
        if (!_canvasReported && !Ready) return Task.FromResult(true);
        return _closeState.RefreshAsync(requestId => Post(new {
            type = "canvas-document-command", action = "refresh-close-state", documentId = State.Id, requestId,
        }), TimeSpan.FromSeconds(5));
    }
    public void Dispose()
    {
        if (_disposed) return; _disposed = true;
        _clipboardReadRequest = null;
        _closeState.Cancel();
        foreach (var command in _commands.Values) command.TrySetResult(false);
        DisposingView?.Invoke();
        DisposingView = null;
        View.Dispose();
    }
}
