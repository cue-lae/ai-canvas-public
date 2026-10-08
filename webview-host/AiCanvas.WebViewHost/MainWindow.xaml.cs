using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;

using AiCanvas.Diagnostics;

namespace AiCanvas.WebViewHost;

public partial class MainWindow : Window
{
    // 1350 ms hold + 50 ms browser reveal + 200 ms fade = 1600 ms when ready.
    private const int MinimumLoadingMilliseconds = 1350;
    private const int LoadingFadeMilliseconds = 200;
    private const int LoadingTimeoutMilliseconds = 5000;
    private const int WmGetMinMaxInfo = 0x0024;
    private const uint MonitorDefaultToNearest = 2;
    private const int DwmWindowCornerPreference = 33;
    private const int DwmCornerRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int value,
        int valueSize);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo monitorInfo);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public Point Reserved;
        public Point MaxSize;
        public Point MaxPosition;
        public Point MinTrackSize;
        public Point MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect WorkArea;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private CoreWebView2Environment? _environment;
    private bool _isFullscreen;
    private WindowStyle _restoredWindowStyle;
    private ResizeMode _restoredResizeMode;
    private WindowState _restoredWindowState;
    private readonly Stopwatch _loadingClock = new();
    private readonly CancellationTokenSource _loadingCancellation = new();
    private bool _loadingFinished;
    private StartupLoadingSurface? _loadingSurface;
    private readonly Stopwatch _navigationClock = new();
    private string? _startupViewportRequest;
    private TaskCompletionSource<bool>? _startupViewportReady;
    private readonly StartupNavigationState _navigation = new();
    private bool _canvasReady;
    private bool _loadingRevealStarted;
    private bool _isClosing;
    private string _themeHeaderColor = "#F2F2F2";
    private BridgeServiceController? _bridgeService;
    private StartupConnectionCoordinator? _connectionCoordinator;
    private Task _startupConnection = Task.CompletedTask;
    private bool _browserDisposed;
    private CancellationTokenSource _bridgeCancellation = new();
    private readonly PackageWindowLifetime? _windowLifetime;
    private readonly DocumentTabController _tabs;
    private readonly DocumentSession? _initialDocument;
    private CoreWebView2? _initialHandlerCore;
    private readonly bool _liveTransferWindow;
    private readonly TaskCompletionSource<bool> _initialPresentation = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly DocumentOpenRequest? _documentOpen;
    private bool _documentOpenOffered;
    private readonly TaskCompletionSource<bool> _documentApplied = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _closeCompleted;
    private bool _preparingDocumentClose;
    internal bool IsLightweight => _liveTransferWindow;
    internal bool IsDocumentFullscreen => _isFullscreen;
    internal DocumentSize DefaultDocumentWindowSize { get; }
    private string? _mergeHighlightColor;
    private TaskCompletionSource<bool>? _closeDecision;

    internal MainWindow(PackageWindowLifetime? lifetime = null, DocumentOpenRequest? documentOpen = null, bool liveTransferWindow = false)
    {
        _windowLifetime = lifetime;
        _documentOpen = documentOpen;
        _liveTransferWindow = liveTransferWindow;
        InitializeComponent();
        DefaultDocumentWindowSize = new DocumentSize(Width, Height);
        _tabs = new DocumentTabController(this, DocumentViews, DocumentTabs);
        _tabs.CreateDocument = CreateDocumentAsync;
        _tabs.CreateDetachedWindow = (session, size, bounds) =>
        {
            var target = new MainWindow(CreateWindowLease(), null, true) { WindowStartupLocation = WindowStartupLocation.Manual, Width = size.Width, Height = size.Height };
            try { new WindowInteropHelper(target).EnsureHandle(); DocumentDragDesktop.Place(target, bounds, false); }
            catch { target.Close(); throw; }
            return target;
        };
        _tabs.ActivatedDocument += ApplyDocumentTheme;
        if (!liveTransferWindow)
        {
            _initialDocument = new DocumentSession(Browser, documentOpen);
            _initialDocument.DisposingView += DetachInitialBrowserHandlers;
            _initialDocument.Connect = ConnectDocumentAsync;
            _tabs.Attach(_initialDocument);
            Browser.Visibility = Visibility.Hidden;
        }
        else { DocumentViews.Children.Remove(Browser); Browser.Dispose(); }
        Loaded += OnLoaded;
        Closing += OnClosing;
        StateChanged += (_, _) => UpdateBrowserResizeMargin();
    }

    private void UpdateBrowserResizeMargin()
    {
        if (_browserDisposed) return;
        DocumentViews.Margin = WindowState == WindowState.Normal && !_isFullscreen
            ? new Thickness(4, 0, 4, 4) : new Thickness(0);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(hwnd)?.AddHook(WindowMessageHook);
        var cornerPreference = DwmCornerRound;
        _ = DwmSetWindowAttribute(
            hwnd,
            DwmWindowCornerPreference,
            ref cornerPreference,
            Marshal.SizeOf<int>());
    }

    private IntPtr WindowMessageHook(
        IntPtr hwnd,
        int message,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (message != WmGetMinMaxInfo)
        {
            return IntPtr.Zero;
        }

        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref monitorInfo))
        {
            return IntPtr.Zero;
        }

        var minMaxInfo = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        minMaxInfo.MaxPosition = new Point
        {
            X = monitorInfo.WorkArea.Left - monitorInfo.Monitor.Left,
            Y = monitorInfo.WorkArea.Top - monitorInfo.Monitor.Top,
        };
        minMaxInfo.MaxSize = new Point
        {
            X = monitorInfo.WorkArea.Right - monitorInfo.WorkArea.Left,
            Y = monitorInfo.WorkArea.Bottom - monitorInfo.WorkArea.Top,
        };
        // This hook handles WM_GETMINMAXINFO, so preserve WPF's minimum size
        // in the native tracking limits as well as any larger system minimum.
        var dpi = GetDpiForWindow(hwnd);
        var scaleX = dpi == 0 ? VisualTreeHelper.GetDpi(this).DpiScaleX : dpi / 96d;
        var scaleY = dpi == 0 ? VisualTreeHelper.GetDpi(this).DpiScaleY : dpi / 96d;
        minMaxInfo.MinTrackSize.X = Math.Max(minMaxInfo.MinTrackSize.X, (int)Math.Ceiling(MinWidth * scaleX));
        minMaxInfo.MinTrackSize.Y = Math.Max(minMaxInfo.MinTrackSize.Y, (int)Math.Ceiling(MinHeight * scaleY));
        Marshal.StructureToPtr(minMaxInfo, lParam, false);
        handled = true;
        return IntPtr.Zero;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_liveTransferWindow)
        {
            _loadingFinished = true;
            LoadingOverlay.Visibility = Visibility.Collapsed;
            LoadingBreath.Storyboard.Remove(LoadingLogo);
            SetLoadingChrome(false);
            DocumentTabs.Visibility = Visibility.Visible;
            // Attach occurs while hidden; apply the retained document palette
            // now that the lightweight window is ready to present it.
            if (_tabs.Active is not null) ApplyDocumentTheme(_tabs.Active);
            _initialPresentation.TrySetResult(true);
            return;
        }
        TimingTrace.Mark(TimingStage.WindowLoaded);
        try
        {
            var logoResource = Application.GetResourceStream(new Uri(
                "pack://application:,,,/AiCanvas.WebViewHost;component/Assets/AI-Canvas-Startup-Logo-Black-AC.ico"));
            using (var stream = logoResource!.Stream)
            {
                var decoder = new IconBitmapDecoder(stream,
                    BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                var frame = decoder.Frames.OrderByDescending(image => image.PixelWidth).First();
                frame.Freeze();
                LoadingLogo.Source = frame;
            }
            _loadingClock.Restart();
            SetLoadingChrome(true);
            _loadingSurface = new StartupLoadingSurface(this, Browser, LoadingOverlay, LoadingLogo, LoadingLogoScale,
                () => { _navigation.NavigationCompleted(false, "加载画面显示失败，请重新启动 AI Canvas。"); _ = ApplyStartupNavigationAsync(); });
            Browser.Visibility = Visibility.Visible;
            Browser.UpdateLayout();
            var distRoot = HostPaths.ResolveDistRoot(
                Environment.GetEnvironmentVariable("AI_CANVAS_DIST_ROOT"),
                AppContext.BaseDirectory);
            _bridgeService = new BridgeServiceController(Path.GetDirectoryName(distRoot)!, _windowLifetime);
            _connectionCoordinator = new StartupConnectionCoordinator(_bridgeService.ConnectAsync);
            if (!await CanContinueBrowserInitializationAsync()) return;
            var userDataFolder = DocumentRunScope.Profile(_initialDocument!.State.Id);

            // The canvas can load while the optional local connection is preparing.
            // The coordinator observes failures and shutdown drains the same work.
            _startupConnection = PrepareConnectionAsync();
            if (!await PrepareBrowserAsync(userDataFolder)) return;
            if (InstalledPackagePolicy.Enabled)
                Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;

            Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                HostNavigationPolicy.AppHost,
                distRoot,
                CoreWebView2HostResourceAccessKind.DenyCors);
            Browser.CoreWebView2.NavigationStarting += OnNavigationStarting;
            Browser.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            Browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            Browser.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _initialHandlerCore = Browser.CoreWebView2;
            TimingTrace.Mark(TimingStage.NavigateBegin);
            _navigationClock.Restart();
            Browser.CoreWebView2.Navigate($"https://{HostNavigationPolicy.AppHost}/index.html");
            _ = EnforceLoadingTimeoutAsync();
        }
        catch (Exception ex)
        {
            if (await CanContinueBrowserInitializationAsync()) ShowError(ex.Message);
        }
    }

    private async Task<bool> PrepareBrowserAsync(string userDataFolder)
    {
        TimingTrace.Mark(TimingStage.BrowserEnvironmentBegin);
        _environment = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataFolder);
        TimingTrace.Mark(TimingStage.BrowserEnvironmentEnd);
        // Environment creation cannot be cancelled; never initialize a disposed view.
        if (!await CanContinueBrowserInitializationAsync()) return false;
        TimingTrace.Mark(TimingStage.BrowserControlBegin);
        Browser.DefaultBackgroundColor = System.Drawing.Color.White;
        await Browser.EnsureCoreWebView2Async(_environment);
        await _initialDocument!.BindCoreAsync(true);
        TimingTrace.Mark(TimingStage.BrowserControlEnd);
        return await CanContinueBrowserInitializationAsync();
    }

    private async Task<bool> CanContinueBrowserInitializationAsync()
    {
        // Keep the original continuation when shutdown fails. Closing must never
        // wait on browser initialization, which may itself wait on this decision.
        while (_isClosing && !_browserDisposed)
        {
            var decision = _closeDecision;
            if (decision is null || !await decision.Task) return false;
        }
        return !_browserDisposed && !_closeCompleted;
    }

    private async Task PrepareConnectionAsync()
    {
        TimingTrace.Mark(TimingStage.BridgePrepareBegin);
        try
        {
            if (_windowLifetime != null && _connectionCoordinator != null)
                await _connectionCoordinator.Start($"http://127.0.0.1:{InstalledPackagePolicy.Port}", _bridgeCancellation.Token);
        }
        finally { TimingTrace.Mark(TimingStage.BridgePrepareEnd); }
    }

    private async Task EnforceLoadingTimeoutAsync()
    {
        try
        {
            await Task.Delay(LoadingTimeoutMilliseconds, _loadingCancellation.Token);
            _navigation.DeadlineElapsed();
            await ApplyStartupNavigationAsync();
        }
        catch (OperationCanceledException)
        {
            // A completed load, error, or window close cancels the timeout.
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || !HostNavigationPolicy.IsAllowed(uri))
        {
            e.Cancel = true;
        }
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            if (_browserDisposed) return;
            if (sender is CoreWebView2 sourceCore && _tabs.Active?.View.CoreWebView2 != sourceCore) return;
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) ||
                !HostNavigationPolicy.IsAllowed(source) || !source.IsDefaultPort || source.AbsolutePath != "/index.html" ||
                !string.IsNullOrEmpty(source.UserInfo)) return;
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            if (root.TryGetProperty("type", out var viewportType) && viewportType.GetString() == "canvas-startup-viewport")
            {
                if (_startupViewportRequest is null ||
                    !root.TryGetProperty("requestId", out var viewportRequest) || viewportRequest.GetString() != _startupViewportRequest ||
                    !root.TryGetProperty("width", out var viewportWidth) || !viewportWidth.TryGetDouble(out var width) ||
                    !root.TryGetProperty("height", out var viewportHeight) || !viewportHeight.TryGetDouble(out var height)) return;
                if (StartupViewportMatches(width, height)) _startupViewportReady?.TrySetResult(true);
                return;
            }
            if (root.TryGetProperty("type", out var readyType) && readyType.GetString() == "canvas-ready")
            {
                if (_isClosing || _canvasReady) return;
                _canvasReady = true;
                OfferDocumentOpen();
                TimingTrace.Mark(TimingStage.CanvasReady);
                // This is a page lifecycle hint, not proof of a presented frame.
                // Do not gate a hidden WebView's visibility on animation frames.
                return;
            }
            if (root.TryGetProperty("type", out var documentReadyType) && documentReadyType.GetString() == "canvas-document-open-ready")
            {
                if (_isClosing || _loadingFinished || _loadingCancellation.IsCancellationRequested || !_canvasReady || _documentOpen is null ||
                    !root.TryGetProperty("requestId", out var documentRequest) ||
                    documentRequest.ValueKind != JsonValueKind.String ||
                    !_documentOpen.TryTakeDelivery(documentRequest.GetString()!, out var delivery)) return;
                Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "canvas-document-open", requestId = delivery!.RequestId,
                    name = delivery.FileName, content = delivery.Content,
                }));
                return;
            }
            if (root.TryGetProperty("type", out var documentResultType) && documentResultType.GetString() == "canvas-document-open-result")
            {
                if (_isClosing || _loadingFinished || _loadingCancellation.IsCancellationRequested || _documentOpen is null ||
                    !root.TryGetProperty("requestId", out var resultRequest) || resultRequest.ValueKind != JsonValueKind.String ||
                    resultRequest.GetString() != _documentOpen.RequestId || !_documentOpen.Delivered ||
                    !root.TryGetProperty("ok", out var resultOk) || resultOk.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return;
                _documentApplied.TrySetResult(resultOk.GetBoolean());
                return;
            }
            if (root.TryGetProperty("type", out var messageType) && messageType.GetString() == "canvas-bridge-connect")
            {
                // DocumentSession routes connection replies back to the exact
                // originating view, including after transfer to another window.
                return;
            }
            if (!root.TryGetProperty("type", out var type) ||
                type.GetString() != "canvas-theme" ||
                !root.TryGetProperty("header", out var header))
            {
                return;
            }

            var color = header.GetString();
            if (string.IsNullOrWhiteSpace(color)) return;
            _themeHeaderColor = color;
            if (_loadingFinished) ApplyThemeHeaderColor();
        }
        catch (JsonException) { }
        catch (FormatException) { }
        catch (InvalidOperationException) { }
        catch (OperationCanceledException) { }
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        TimingTrace.Mark(TimingStage.NavigationCompleted);
        if (_browserDisposed) return;
        _navigation.NavigationCompleted(e.IsSuccess, e.IsSuccess ? null : $"页面加载失败：{e.WebErrorStatus}");
        await ApplyStartupNavigationAsync();
    }

    private async Task ApplyStartupNavigationAsync()
    {
        var decision = _navigation.Pending(_isClosing, _browserDisposed, _loadingCancellation.IsCancellationRequested, _loadingFinished);
        if (decision.Action == StartupNavigationAction.Error) ShowError(decision.Message!);
        else if (decision.Action == StartupNavigationAction.Reveal) await TryRevealCanvasAsync();
    }

    private async Task TryRevealCanvasAsync()
    {
        if (!_navigation.IsReady || _loadingRevealStarted || _loadingFinished || _isClosing || _browserDisposed || _loadingCancellation.IsCancellationRequested) return;
        _loadingRevealStarted = true;
        try
        {
            if (_documentOpen is not null)
            {
                var applied = await _documentApplied.Task.WaitAsync(StartupPresentationRemaining(), _loadingCancellation.Token);
                if (!applied)
                {
                    ShowError("打开项目失败：文件损坏或内容不受支持。原有画布窗口未改变。");
                    return;
                }
            }
            // A failed close may have paused the continuation after the fade ended.
            // Finish it without flashing the same logo back to full opacity.
            if (Browser.Visibility == Visibility.Visible && LoadingOverlay.Opacity <= 0)
            {
                FinishStartupReveal();
                return;
            }
            await EnsureStartupViewportAsync();
            if (!CanContinueStartupReveal()) return;
            var remaining = TimeSpan.FromMilliseconds(MinimumLoadingMilliseconds) - _loadingClock.Elapsed;
            if (remaining > TimeSpan.Zero)
            {
                await Task.Delay(remaining, _loadingCancellation.Token);
            }
            if (!CanContinueStartupReveal()) return;
            Browser.Visibility = Visibility.Visible;
            await Task.Delay(50, _loadingCancellation.Token);
            if (!CanContinueStartupReveal()) return;
            SetLoadingChrome(false);
            var headerBrush = ThemeHeaderBrush();
            TitleBar.Background = headerBrush;
            headerBrush.BeginAnimation(SolidColorBrush.ColorProperty,
                new ColorAnimation(Colors.White, headerBrush.Color, TimeSpan.FromMilliseconds(LoadingFadeMilliseconds)));
            MinimizeButton.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(LoadingFadeMilliseconds)));
            MaximizeButton.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(LoadingFadeMilliseconds)));
            TimingTrace.Mark(TimingStage.RevealBegin);
            // Use the same single native splash as the accepted local host.
            // Keep its breathing phase until fade completion; no second web logo.
            var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(LoadingFadeMilliseconds));
            var faded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            EventHandler completed = (_, _) => faded.TrySetResult(true);
            fade.Completed += completed;
            try
            {
                LoadingOverlay.BeginAnimation(OpacityProperty, fade);
                await faded.Task.WaitAsync(_loadingCancellation.Token);
            }
            finally { fade.Completed -= completed; }
            FinishStartupReveal();
        }
        catch (TimeoutException)
        {
            _loadingRevealStarted = false;
            // Closing pauses display preparation. A failed close must resume
            // the saved successful navigation instead of consuming its budget.
            if (_isClosing || _navigationClock.Elapsed.TotalMilliseconds < LoadingTimeoutMilliseconds)
            {
                if (await CanContinueBrowserInitializationAsync()) await ApplyStartupNavigationAsync();
                return;
            }
            _navigation.NavigationCompleted(false, "页面加载超时：请重新启动 AI Canvas。");
            await ApplyStartupNavigationAsync();
        }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException or JsonException or KeyNotFoundException)
        {
            _loadingRevealStarted = false;
            _navigation.NavigationCompleted(false, "画布显示准备失败，请重新启动 AI Canvas。");
            await ApplyStartupNavigationAsync();
        }
        catch (OperationCanceledException)
        {
            _loadingRevealStarted = false;
            // Closing or a load error must not reveal a disposed/failed browser.
        }
    }

    private bool CanContinueStartupReveal()
    {
        if (!_isClosing && !_browserDisposed && !_loadingCancellation.IsCancellationRequested) return true;
        _loadingRevealStarted = false;
        return false;
    }

    private async Task EnsureStartupViewportAsync()
    {
        // ExecuteScriptAsync serializes a Promise; it does not await it. Verify
        // synchronous values, and use correlated resize messages if necessary.
        while (true)
        {
            var json = await Browser.CoreWebView2.ExecuteScriptAsync("({width:innerWidth,height:innerHeight})")
                .WaitAsync(StartupPresentationRemaining(), _loadingCancellation.Token);
            using var dimensions = JsonDocument.Parse(json);
            if (StartupViewportMatches(dimensions.RootElement.GetProperty("width").GetDouble(),
                    dimensions.RootElement.GetProperty("height").GetDouble())) break;
            _startupViewportRequest = Guid.NewGuid().ToString("N");
            _startupViewportReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
            var id = JsonSerializer.Serialize(_startupViewportRequest);
            var script = $"(() => {{ window.__aiCanvasStartupViewportCleanup?.(); const report=()=>chrome.webview.postMessage({{type:'canvas-startup-viewport',requestId:{id},width:innerWidth,height:innerHeight}}); addEventListener('resize',report); window.__aiCanvasStartupViewportCleanup=()=>{{removeEventListener('resize',report);delete window.__aiCanvasStartupViewportCleanup;}}; report(); }})()";
            try
            {
                await Browser.CoreWebView2.ExecuteScriptAsync(script).WaitAsync(StartupPresentationRemaining(), _loadingCancellation.Token);
                await _startupViewportReady.Task.WaitAsync(StartupPresentationRemaining(), _loadingCancellation.Token);
            }
            finally
            {
                _startupViewportRequest = null;
                _startupViewportReady = null;
                if (!_browserDisposed)
                {
                    var cleanup = Browser.CoreWebView2.ExecuteScriptAsync("window.__aiCanvasStartupViewportCleanup?.()");
                    _ = cleanup.ContinueWith(task => { _ = task.Exception; }, TaskScheduler.Default);
                }
            }
        }
        // Prepare a rendered browser snapshot through the supported API. It is
        // discarded and never becomes a second displayed Canvas or renderer.
        var stream = new MemoryStream();
        Task paint;
        try { paint = Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream); }
        catch { stream.Dispose(); throw; }
        _ = paint.ContinueWith(task => { _ = task.Exception; stream.Dispose(); }, TaskScheduler.Default);
        await paint.WaitAsync(StartupPresentationRemaining(), _loadingCancellation.Token);
    }

    private bool StartupViewportMatches(double width, double height) =>
        double.IsFinite(width) && double.IsFinite(height) && width > 0 && height > 0 &&
        Math.Abs(width - Browser.ActualWidth / Browser.ZoomFactor) <= 1 &&
        Math.Abs(height - Browser.ActualHeight / Browser.ZoomFactor) <= 1;

    private TimeSpan StartupPresentationRemaining()
    {
        var remaining = LoadingTimeoutMilliseconds - _navigationClock.Elapsed.TotalMilliseconds;
        if (remaining <= 0) throw new TimeoutException();
        return TimeSpan.FromMilliseconds(remaining);
    }

    private void FinishStartupReveal()
    {
        if (!CanContinueStartupReveal()) return;
        LoadingOverlay.Visibility = Visibility.Collapsed;
        _loadingSurface?.Dispose();
        _loadingSurface = null;
        LoadingBreath.Storyboard.Remove(LoadingLogo);
        _loadingFinished = true;
        SetLoadingChrome(false);
        _initialPresentation.TrySetResult(true);
        DocumentTabs.Visibility = Visibility.Visible;
        if (_tabs.Active is not null) ApplyDocumentTheme(_tabs.Active);
        _ = Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Input, new Action(() =>
        {
            if (!_browserDisposed && !_isClosing && IsActive && Browser.Visibility == Visibility.Visible)
                Keyboard.Focus(Browser);
        }));
        TimingTrace.Mark(TimingStage.RevealEnd);
    }

    private void ReplyConnectionState(string requestId, BridgeConnectionResult result)
    {
        if (_browserDisposed || Browser.CoreWebView2 is null) return;
        try
        {
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "canvas-bridge-state", requestId, status = result.Status, code = result.Code,
            }));
        }
        catch (InvalidOperationException) { /* The window may already be shutting down. */ }
        catch (COMException) { /* A closing/failed renderer cannot receive a reply. */ }
    }

    private void OfferDocumentOpen()
    {
        if (_documentOpenOffered || _documentOpen is null || _browserDisposed || Browser.CoreWebView2 is null) return;
        _documentOpenOffered = true;
        try
        {
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "canvas-document-open-offer", requestId = _documentOpen.RequestId, name = _documentOpen.FileName,
            }));
        }
        catch (InvalidOperationException) { }
        catch (COMException) { }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F11)
        {
            ToggleFullscreen();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape && _isFullscreen)
        {
            ToggleFullscreen();
            e.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (!_isFullscreen)
        {
            _restoredWindowStyle = WindowStyle;
            _restoredResizeMode = ResizeMode;
            _restoredWindowState = WindowState;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            TitleBar.Visibility = Visibility.Collapsed;
            TitleBarRow.Height = new GridLength(0);
            _isFullscreen = true;
            UpdateBrowserResizeMargin();
            return;
        }

        WindowState = _restoredWindowState;
        WindowStyle = _restoredWindowStyle;
        ResizeMode = _restoredResizeMode;
        TitleBar.Visibility = Visibility.Visible;
        TitleBarRow.Height = new GridLength(34);
        _isFullscreen = false;
        UpdateBrowserResizeMargin();
    }

    private void OnTitleBarMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left)
        {
            return;
        }

        if (e.ClickCount == 2)
        {
            ToggleMaximize();
            return;
        }

        if (WindowState == WindowState.Normal)
        {
            DragMove();
        }
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e)
    {
        SystemCommands.MinimizeWindow(this);
    }

    private void OnMaximizeClick(object sender, RoutedEventArgs e)
    {
        ToggleMaximize();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        SystemCommands.CloseWindow(this);
    }

    private void ToggleMaximize()
    {
        if (WindowState == WindowState.Maximized)
        {
            SystemCommands.RestoreWindow(this);
            return;
        }

        SystemCommands.MaximizeWindow(this);
    }

    private void ShowError(string message)
    {
        if (_browserDisposed) return;
        _loadingCancellation.Cancel();
        _loadingRevealStarted = false;
        LoadingBreath.Storyboard.Remove(LoadingLogo);
        SetLoadingChrome(false);
        LoadingOverlay.Visibility = Visibility.Collapsed;
        _loadingSurface?.Dispose();
        _loadingSurface = null;
        ErrorMessage.Text = message;
        ErrorPanel.Visibility = Visibility.Visible;
        Browser.Visibility = Visibility.Collapsed;
    }

    private void SetLoadingChrome(bool isLoading)
    {
        TitleBar.Background = isLoading
            ? Brushes.White
            : ThemeHeaderBrush();
        MinimizeButton.Visibility = isLoading ? Visibility.Collapsed : Visibility.Visible;
        MaximizeButton.Visibility = isLoading ? Visibility.Collapsed : Visibility.Visible;
        CloseButton.Visibility = Visibility.Visible;
    }

    private SolidColorBrush ThemeHeaderBrush() => new(
        (Color)ColorConverter.ConvertFromString(_themeHeaderColor));

    private void ApplyThemeHeaderColor() => TitleBar.Background = ThemeHeaderBrush();
    internal void SetDocumentMergeHighlight(string? color)
    {
        if (color is null) { DocumentMergeHighlight.Visibility = Visibility.Collapsed; return; }
        if (_mergeHighlightColor != color)
        {
            DocumentMergeHighlight.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
            _mergeHighlightColor = color;
        }
        DocumentMergeHighlight.Visibility = Visibility.Visible;
    }

    internal static PackageWindowLifetime? CreateWindowLease() => InstalledPackagePolicy.Enabled || DocumentRunScope.Isolated
        ? new PackageWindowLifetime(DocumentRunScope.DataRoot) : null;
    internal Task WaitForInitialPresentationAsync() => _initialPresentation.Task.WaitAsync(TimeSpan.FromSeconds(30));

    private void ApplyDocumentTheme(DocumentSession session)
    {
        if (_tabs.Active != session || !_loadingFinished) return;
        _themeHeaderColor = session.Palette.GetValueOrDefault("header", "#F7F7F7");
        ApplyThemeHeaderColor();
        var foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(session.Palette.GetValueOrDefault("icon", "#34373D")));
        MinimizeButton.Foreground = foreground; MaximizeButton.Foreground = foreground; CloseButton.Foreground = foreground;
        ChromeRoot.Resources["CaptionHoverBackground"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(session.Palette.GetValueOrDefault("accentSurface", "#E6E0F4")));
        ChromeRoot.Resources["CaptionHoverForeground"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(session.Palette.GetValueOrDefault("accentText", "#392B68")));
        ChromeRoot.Resources["CaptionPressedBackground"] = ChromeRoot.Resources["CaptionHoverBackground"];
    }

    internal async Task<BridgeConnectionResult> ConnectDocumentAsync(DocumentSession session, string address, bool ensure, CancellationToken cancellation)
    {
        if (DocumentRunScope.Isolated || _isClosing || _browserDisposed) return new("disconnected", "UNAVAILABLE");
        var distRoot = HostPaths.ResolveDistRoot(Environment.GetEnvironmentVariable("AI_CANVAS_DIST_ROOT"), AppContext.BaseDirectory);
        _bridgeService ??= new BridgeServiceController(Path.GetDirectoryName(distRoot)!, _windowLifetime);
        _connectionCoordinator ??= new StartupConnectionCoordinator(_bridgeService.ConnectAsync);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation, _bridgeCancellation.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(14));
        try { return await _connectionCoordinator.ConnectAsync(ensure, address, deadline.Token); }
        catch (OperationCanceledException) { return new("disconnected", "TIMEOUT"); }
    }

    private async Task<DocumentSession> CreateDocumentAsync(DocumentOpenRequest? open)
    {
        var palette = _tabs.Active?.Palette;
        var background = (Color)ColorConverter.ConvertFromString(palette?.GetValueOrDefault("canvas", "#FFFFFF") ?? "#FFFFFF");
        var view = new Microsoft.Web.WebView2.Wpf.WebView2 {
            DefaultBackgroundColor = System.Drawing.Color.FromArgb(background.A, background.R, background.G, background.B) };
        var session = new DocumentSession(view, open) { Owner = this, Connect = ConnectDocumentAsync };
        if (palette is not null) foreach (var token in palette) session.Palette[token.Key] = token.Value;
        _tabs.Attach(session); UpdateLayout(); view.IsEnabled = false;
        var environment = await CoreWebView2Environment.CreateAsync(null, DocumentRunScope.Profile(session.State.Id));
        await view.EnsureCoreWebView2Async(environment);
        await session.BindCoreAsync(false);
        var dist = HostPaths.ResolveDistRoot(Environment.GetEnvironmentVariable("AI_CANVAS_DIST_ROOT"), AppContext.BaseDirectory);
        view.CoreWebView2.SetVirtualHostNameToFolderMapping(HostNavigationPolicy.AppHost, dist, CoreWebView2HostResourceAccessKind.DenyCors);
        view.CoreWebView2.Navigate($"https://{HostNavigationPolicy.AppHost}/index.html");
        if (!await session.ReadyTask.WaitAsync(TimeSpan.FromSeconds(30))) throw new IOException("项目初始化失败。");
        view.IsEnabled = !_preparingDocumentClose && !_isClosing;
        return session;
    }

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_closeCompleted) return;
        e.Cancel = true;
        if (_isClosing) return;
        if (_preparingDocumentClose) return;
        // Do not cancel connection work, release leases or dispose a tab before
        // every document decision succeeds. Each attempt starts a fresh plan.
        _preparingDocumentClose = true;
        using var inputGate = new DocumentCloseInputGate(enabled => {
            if (!_closeCompleted) _tabs.SetInteractionEnabled(enabled);
        });
        bool approved = false;
        try { approved = await _tabs.PrepareWindowCloseAsync(); }
        finally { _preparingDocumentClose = false; }
        if (!approved) return;
        var closeDecision = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _closeDecision = closeDecision;
        _isClosing = true;
        _navigationClock.Stop();
        _bridgeCancellation.Cancel();
        try
        {
            await _startupConnection;
            if (_connectionCoordinator != null) await _connectionCoordinator.DrainAsync();
            if (_windowLifetime != null)
            {
                if (DocumentRunScope.Isolated) await _windowLifetime.CloseAsync(() => Task.CompletedTask);
                else if (_bridgeService != null) await _bridgeService.CloseWindowAsync();
                else
                {
                    _bridgeService = new BridgeServiceController(InstalledPackagePolicy.ResolveRoot(AppContext.BaseDirectory), _windowLifetime);
                    await _bridgeService.CloseWindowAsync();
                }
            }
        }
        catch (Exception error)
        {
            _bridgeCancellation.Dispose();
            _bridgeCancellation = new CancellationTokenSource();
            MessageBox.Show(error is IOException ? error.Message : "连接未能正常结束，画布将保持打开。请稍后再次关闭重试。", "AI Canvas", MessageBoxButton.OK, MessageBoxImage.Warning);
            _isClosing = false;
            inputGate.Dispose();
            _navigationClock.Start();
            closeDecision.TrySetResult(true);
            await ApplyStartupNavigationAsync();
            return;
        }
        _isClosing = true;
        _bridgeCancellation.Cancel();
        _bridgeService?.Dispose();
        _loadingCancellation.Cancel();
        LoadingBreath.Storyboard.Remove(LoadingLogo);
        _loadingSurface?.Dispose();
        _loadingSurface = null;
        DetachInitialBrowserHandlers();

        _browserDisposed = true;
        closeDecision.TrySetResult(false);
        _tabs.DisposeOwnedDocuments();
        _closeCompleted = true;
        // An empty transferred window can finish every await synchronously.
        // Leave WPF's current Closing callback before requesting the final close.
        _ = Dispatcher.BeginInvoke(new Action(Close));
    }

    private void DetachInitialBrowserHandlers()
    {
        // A document can outlive its first window, or be disposed in another
        // window first. Unsubscribe before disposal, without touching its view.
        if (_initialDocument is not null)
            _initialDocument.DisposingView -= DetachInitialBrowserHandlers;
        if (_initialHandlerCore is not { } core) return;
        _initialHandlerCore = null;
        core.NavigationStarting -= OnNavigationStarting;
        core.NewWindowRequested -= OnNewWindowRequested;
        core.NavigationCompleted -= OnNavigationCompleted;
        core.WebMessageReceived -= OnWebMessageReceived;
    }
}
