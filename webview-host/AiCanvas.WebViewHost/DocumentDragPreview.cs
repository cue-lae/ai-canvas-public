using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace AiCanvas.WebViewHost;

internal static class DocumentDragDesktop
{
    [StructLayout(LayoutKind.Sequential)] internal struct Point { internal int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { internal int Size; internal Rect Monitor, Work; internal uint Flags; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern nint MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern nint CreateWindowExW(uint extendedStyle, string className, string? name, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint window, out Rect rect);
    [DllImport("user32.dll")] private static extern nint SetThreadDpiAwarenessContext(nint context);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint window, nint after, int x, int y, int width, int height, uint flags);
    // Each drag owns its probe. Reuse monitor facts while moving within that
    // monitor; refresh on crossing and at release, never across separate drags.
    internal sealed class Reader : IDisposable
    {
        private nint _monitor, _dpiWindow;
        private DocumentBounds _work;
        private double _scale;
        internal (Point Pointer, DocumentBounds Work, double Scale) Read(bool refresh = false, Window? window = null)
        {
            var previous = SetThreadDpiAwarenessContext(-4);
            if (previous == 0) throw new IOException("无法读取落点显示密度。");
            try {
            var point = new Point();
            if (window is null && !GetCursorPos(out point)) throw new IOException("无法读取拖动指针。");
            var monitor = window is null ? MonitorFromPoint(point, 2) : MonitorFromWindow(new WindowInteropHelper(window).Handle, 2);
            if (_monitor != monitor || refresh)
            {
                var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
                if (!GetMonitorInfo(monitor, ref info)) throw new IOException("无法核对落点显示器。");
                if (window is not null) point = new Point { X = info.Work.Left + 1, Y = info.Work.Top + 1 };
                if (_dpiWindow == 0)
                    _dpiWindow = CreateWindowExW(0x08000080, "STATIC", null, 0x80000000, point.X, point.Y, 1, 1, 0, 0, 0, 0);
                else if (!SetWindowPos(_dpiWindow, 0, point.X, point.Y, 1, 1, 0x14))
                    throw new IOException("无法移动显示密度探针。");
                var dpi = _dpiWindow == 0 ? 0 : GetDpiForWindow(_dpiWindow);
                if (dpi == 0) throw new IOException("无法核对落点显示密度。");
                _monitor = monitor; _scale = dpi / 96d;
                _work = new(info.Work.Left, info.Work.Top, info.Work.Right - info.Work.Left, info.Work.Bottom - info.Work.Top);
            }
            return (point, _work, _scale);
            } finally { SetThreadDpiAwarenessContext(previous); }
        }
        public void Dispose() { if (_dpiWindow != 0) { DestroyWindow(_dpiWindow); _dpiWindow = 0; } }
    }
    internal static void Place(Window window, DocumentBounds bounds, bool preview)
    {
        var previous = SetThreadDpiAwarenessContext(-4);
        try {
            var handle = new WindowInteropHelper(window).Handle;
            if (handle == 0 || !SetWindowPos(handle, preview ? -1 : 0, (int)Math.Round(bounds.Left), (int)Math.Round(bounds.Top), (int)Math.Round(bounds.Width), (int)Math.Round(bounds.Height), preview ? 0x50u : 0x14u))
                throw new IOException("窗口外框未能按预览落位。");
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
    internal static System.Windows.Point WindowPointToScreen(Window window, System.Windows.Point local, double scale)
    {
        var bounds = ReadWindowBounds(window);
        return new System.Windows.Point(bounds.Left + local.X * scale, bounds.Top + local.Y * scale);
    }
    internal static DocumentBounds ReadWindowBounds(Window window)
    {
        var previous = SetThreadDpiAwarenessContext(-4);
        try
        {
            if (!GetWindowRect(new WindowInteropHelper(window).Handle, out var bounds))
                throw new IOException("无法核对目标窗口位置。");
            return new DocumentBounds(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
        }
        finally { SetThreadDpiAwarenessContext(previous); }
    }
}

internal sealed class DocumentDragOverlay : IDisposable
{
    private readonly Window _window;
    private DocumentBounds? _bounds;
    private bool _disposed;
    private readonly double _opacity;
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint h, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint h, int index, nint value);
    internal DocumentDragOverlay(FrameworkElement content, double width, double height, double opacity = .96)
    {
        _opacity = opacity;
        _window = new Window { Width = width, Height = height, Content = content,
            WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, AllowsTransparency = true,
            Background = Brushes.Transparent, ShowActivated = false, ShowInTaskbar = false, Focusable = false,
            IsHitTestVisible = false, Opacity = 0, WindowStartupLocation = WindowStartupLocation.Manual };
        _window.SourceInitialized += (_, _) => {
            var handle = new WindowInteropHelper(_window).Handle;
            SetWindowLongPtr(handle, -20, GetWindowLongPtr(handle, -20) | 0x080000A0);
            HwndSource.FromHwnd(handle)?.AddHook((nint h, int msg, nint w, nint l, ref bool handled) => {
                if (msg == 0x84) { handled = true; return -1; }
                if (msg == 0x21) { handled = true; return 3; }
                return 0;
            });
        };
    }
    internal void ShowAt(DocumentBounds bounds)
    {
        if (_disposed) return;
        if (!_window.IsVisible) { _window.Opacity = 0; _window.Show(); }
        if (_bounds != bounds || _window.Opacity == 0) DocumentDragDesktop.Place(_window, bounds, true);
        _bounds = bounds; _window.Opacity = _opacity;
    }
    internal void Resize(double width, double height)
    { _window.Width = width; _window.Height = height; _bounds = null; }
    internal void Caption(string text) { if (_window.Title != text) _window.Title = text; }
    public void Dispose() { if (_disposed) return; _disposed = true; _window.Close(); }
}

// One immutable image for this press/drag only. The live view stays at its source
// until a drop is accepted; no extra renderer or document state is created.
internal sealed class DocumentDragPreview : IDisposable
{
    internal static async Task<bool> WaitForPresentationAsync(DocumentSession document)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await document.View.Dispatcher.InvokeAsync(document.View.UpdateLayout, DispatcherPriority.Render);
            var core = document.View.CoreWebView2;
            while (document.Ready && document.View.IsVisible && ReferenceEquals(core, document.OriginalCore))
            {
                var value = await core.ExecuteScriptAsync("({width:innerWidth,height:innerHeight})").WaitAsync(timeout.Token);
                using var json = System.Text.Json.JsonDocument.Parse(value);
                var width = json.RootElement.GetProperty("width").GetDouble();
                var height = json.RootElement.GetProperty("height").GetDouble();
                if (width > 0 && height > 0 && Math.Abs(width - document.View.ActualWidth / document.View.ZoomFactor) <= 1 &&
                    Math.Abs(height - document.View.ActualHeight / document.View.ZoomFactor) <= 1)
                {
                    var stream = new MemoryStream();
                    Task paint;
                    try { paint = core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream); }
                    catch { stream.Dispose(); throw; }
                    _ = paint.ContinueWith(task => { _ = task.Exception; stream.Dispose(); }, TaskScheduler.Default);
                    await paint.WaitAsync(timeout.Token);
                    return true;
                }
                await Task.Delay(16, timeout.Token);
            }
        }
        catch (Exception error) when (error is OperationCanceledException or InvalidOperationException or System.Runtime.InteropServices.COMException or System.Text.Json.JsonException or KeyNotFoundException) { }
        // A cosmetic handoff timeout never discards the already transferred view.
        return false;
    }
    private readonly DocumentDragOverlay _overlay;
    private readonly DocumentDragLease _lease;
    private readonly DocumentSize _size;
    private readonly Border _outline;
    private readonly Border _body;
    private readonly Grid _grid;
    private readonly Image _content;
    private bool _compact = true;
    internal bool HasContent => _content.Source is not null;
    internal bool CaptureFailed { get; private set; }
    internal static async Task<ImageSource?> CaptureAsync(DocumentSession document, DocumentDragLease lease)
    {
        var dragId = lease.Id;
        try
        {
            // A press may activate a previously collapsed tab. Let WPF apply
            // that layout before asking WebView2 for its visible pixels.
            await document.View.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Render);
            if (!lease.Accept(document.State.Id, dragId) || !document.Ready || document.View.Visibility != Visibility.Visible) return null;
            var width = (int)Math.Clamp(Math.Ceiling(document.View.ActualWidth * VisualTreeHelper.GetDpi(document.View).DpiScaleX), 1, 2048);
            using var stream = new MemoryStream();
            await document.View.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            if (!lease.Accept(document.State.Id, dragId)) return null;
            stream.Position = 0;
            var image = await Task.Run(() =>
            {
                var bitmap = new BitmapImage();
                bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.DecodePixelWidth = width; bitmap.StreamSource = stream; bitmap.EndInit(); bitmap.Freeze();
                return bitmap;
            });
            return lease.Accept(document.State.Id, dragId) ? image : null;
        }
        catch { return null; } // A failed preview must not lose or block the live document.
    }
    internal async Task ReceiveAsync(Task<ImageSource?> capture, Action follow)
    {
        var image = await capture;
        if (!_lease.Active) return;
        if (image is null) { CaptureFailed = true; follow(); return; }
        _content.Source = image;
        follow(); // Also update when the pointer stopped while capture was pending.
    }
    internal DocumentDragPreview(DocumentSession document, DocumentDragLease lease, DocumentSize size, ImageSource? icon)
    {
        _lease = lease; _size = size;
        Brush Token(string key) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(document.Palette[key]));
        var title = new DockPanel { Margin = new Thickness(9, 0, 9, 0) };
        title.Children.Add(new Image { Source = icon, Width = 16, Height = 16, Margin = new Thickness(0, 0, 8, 0) });
        title.Children.Add(new TextBlock { Text = document.State.Name + (document.State.Dirty ? " *" : ""), FontSize = 12.5,
            FontWeight = FontWeights.SemiBold, Foreground = Token("text"), VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis });
        _grid = new Grid(); _grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });
        _grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(0) });
        _grid.Children.Add(new Border { Background = Token("header"), CornerRadius = new CornerRadius(5,5,0,0), Child = title });
        _content = new Image { Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
        RenderOptions.SetBitmapScalingMode(_content, BitmapScalingMode.HighQuality);
        _body = new Border { Background = Token("canvas"), Child = _content, ClipToBounds = true, Visibility = Visibility.Collapsed };
        Grid.SetRow(_body, 1); _grid.Children.Add(_body);
        _outline = new Border { BorderThickness = new Thickness(1), BorderBrush = Token("border"), CornerRadius = new CornerRadius(6), Child = _grid };
        _overlay = new DocumentDragOverlay(_outline, 238, 34, opacity: 1);
        _overlay.Caption("拖动 " + document.State.Name);
    }
    internal void Move(DocumentBounds bounds, bool compact)
    {
        if (!_lease.Active) return;
        if (_compact != compact)
        {
            _compact = compact;
            _body.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            _grid.RowDefinitions[1].Height = compact ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
            _overlay.Resize(compact ? 238 : _size.Width, compact ? 34 : _size.Height);
        }
        _overlay.ShowAt(bounds);
    }
    public void Dispose() { _lease.End(); _content.Source = null; _overlay.Dispose(); }
}

internal sealed class DocumentDropHint : IDisposable
{
    private readonly TextBlock _text;
    private readonly DocumentDragOverlay _overlay;
    private double _width = 380;
    internal DocumentDropHint(IReadOnlyDictionary<string, string> palette)
    {
        var background = DocumentThemeTokens.Mix(palette["accentSurface"], palette["header"], .18);
        _text = new TextBlock { FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(palette["text"])),
            TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10,0,10,0) };
        var panel = new Border { Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(background)), CornerRadius = new CornerRadius(6), Child = _text };
        _overlay = new DocumentDragOverlay(panel, 380, 28);
    }
    internal void Show(string text, Point point, DocumentBounds work, double scale)
    {
        if (_text.Text != text)
        {
            _text.Text = text;
            _text.Measure(new Size(380, 28));
            _width = Math.Clamp(_text.DesiredSize.Width, 80, 380);
            _overlay.Resize(_width, 28); _overlay.Caption(text);
        }
        var bounds = DocumentDragGeometry.Place(point.X, point.Y, 0, 0, new DocumentSize(_width, 28), work, scale);
        _overlay.ShowAt(bounds);
    }
    public void Dispose() => _overlay.Dispose();
}
