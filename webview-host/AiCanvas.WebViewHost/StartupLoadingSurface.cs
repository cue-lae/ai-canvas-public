using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace AiCanvas.WebViewHost;

// Hosts the existing loading visual above the HWND-backed WebView. It contains
// no Canvas, browser, application state or additional loading animation.
internal sealed class StartupLoadingSurface : IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y,
        int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    private const uint NoZOrder = 0x0004;
    private const uint NoActivate = 0x0010;
    private readonly Window _owner;
    private readonly FrameworkElement _anchor;
    private readonly Grid _visual;
    private readonly Window _surface;
    private readonly Action _onPositionFailure;
    private bool _disposed;

    internal StartupLoadingSurface(Window owner, FrameworkElement anchor, Grid visual,
        Image logo, ScaleTransform scale, Action onPositionFailure)
    {
        _owner = owner; _anchor = anchor; _visual = visual;
        _onPositionFailure = onPositionFailure;
        if (visual.Parent is not Panel parent)
            throw new InvalidOperationException("Loading visual is not in the host layout.");
        parent.Children.Remove(visual);
        NameScope.SetNameScope(visual, new NameScope());
        visual.RegisterName(logo.Name, logo);
        visual.RegisterName("LoadingLogoScale", scale);
        _surface = new Window
        {
            Owner = owner, WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize,
            AllowsTransparency = true, Background = Brushes.Transparent,
            ShowInTaskbar = false, ShowActivated = false, Focusable = false,
            WindowStartupLocation = WindowStartupLocation.Manual, Content = visual,
            Width = Math.Max(1, anchor.ActualWidth), Height = Math.Max(1, anchor.ActualHeight),
            Left = owner.Left, Top = owner.Top + 34
        };
        try
        {
            _surface.SourceInitialized += (_, _) =>
            {
                var hwnd = new WindowInteropHelper(_surface).Handle;
                // A startup cover must not steal focus when clicked.
                var style = GetWindowLongPtr(hwnd, -20).ToInt64();
                SetWindowLongPtr(hwnd, -20, new IntPtr(style | 0x08000000));
            };
            owner.LocationChanged += OnBoundsChanged;
            owner.SizeChanged += OnBoundsChanged;
            anchor.SizeChanged += OnBoundsChanged;
            _surface.Show();
            SynchronizeBounds();
        }
        catch
        {
            Dispose();
            if (visual.Parent is null) parent.Children.Add(visual);
            throw;
        }
    }

    private void OnBoundsChanged(object? sender, EventArgs args)
    {
        try { SynchronizeBounds(); }
        catch (InvalidOperationException) { _onPositionFailure(); }
    }

    internal void SynchronizeBounds()
    {
        if (_disposed || _owner.WindowState == WindowState.Minimized) return;
        var origin = _anchor.PointToScreen(new Point());
        var opposite = _anchor.PointToScreen(new Point(_anchor.ActualWidth, _anchor.ActualHeight));
        var hwnd = new WindowInteropHelper(_surface).Handle;
        if (hwnd == IntPtr.Zero) return;
        if (!SetWindowPos(hwnd, IntPtr.Zero, (int)Math.Round(origin.X), (int)Math.Round(origin.Y),
            Math.Max(1, (int)Math.Round(opposite.X - origin.X)),
            Math.Max(1, (int)Math.Round(opposite.Y - origin.Y)), NoZOrder | NoActivate))
            throw new InvalidOperationException("Unable to position the loading surface.");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _owner.LocationChanged -= OnBoundsChanged;
        _owner.SizeChanged -= OnBoundsChanged;
        _anchor.SizeChanged -= OnBoundsChanged;
        _surface.Content = null;
        _surface.Close();
    }
}
