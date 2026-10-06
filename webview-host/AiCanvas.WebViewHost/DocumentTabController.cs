using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Wpf;

namespace AiCanvas.WebViewHost;

internal sealed class DocumentTabController
{
    private const string DragFormat = "AI.Canvas.LiveDocumentTab";
    private sealed class DragToken
    {
        internal required DocumentSession Session;
        internal required DocumentTabController Source;
        internal bool Cancelled, Received, Released;
        internal DocumentTabController? HoverTarget;
        internal DocumentTabController? ReceivedBy;
    }
    internal static List<DocumentTabController> Windows { get; } = [];
    private readonly MainWindow _window;
    private readonly Panel _host;
    private readonly StackPanel _strip;
    private readonly List<DocumentSession> _documents = [];
    private readonly List<(DocumentSession Document, FrameworkElement Tab)> _visible = [];
    private readonly List<Action> _updateTabAppearance = [];
    private readonly List<Button> _stripButtons = [];
    private ImageSource? _tabIcon;
    private double _tabIconScale;
    private bool _busy;
    private int _firstVisible;
    private DocumentSession? _dragDocument;
    private DocumentDragLease? _dragPreparation;
    private Task<ImageSource?>? _dragSnapshot;
    private Point _dragStart;
    private Point _dragGrab;
    private bool _dragCaptureOwned;
    private bool _refreshPending;
    private bool _dragging;
    private bool _dragCancelled;
    private readonly DocumentMergeSizeState _mergeSize = new();
    private DocumentDropHint? _dropHint;
    private bool _busyNoticePending, _busyNoticeShowing;
    internal Func<DocumentOpenRequest?, Task<DocumentSession>> CreateDocument { get; set; } = null!;
    internal Func<DocumentSession, DocumentSize, DocumentBounds, MainWindow> CreateDetachedWindow { get; set; } = null!;
    internal DocumentSession? Active { get; private set; }
    internal IReadOnlyList<DocumentSession> Documents => _documents;
    internal MainWindow Window => _window;
    internal long ActivationOrder { get; private set; }
    private static long _activationSequence;
    internal event Action<DocumentSession>? ActivatedDocument;
    internal void SetInteractionEnabled(bool enabled)
    {
        _strip.IsEnabled = enabled;
        foreach (var document in _documents) document.View.IsEnabled = enabled && document.Ready;
    }

    internal DocumentTabController(MainWindow window, Panel host, StackPanel strip)
    {
        _window = window; _host = host; _strip = strip; Windows.Add(this);
        strip.AllowDrop = true;
        strip.Focusable = true;
        window.PreviewKeyDown += (_, e) => {
            if (e.Key != Key.Escape || (_dragDocument is null && !_dragging)) return;
            _dragCancelled = true;
            if (!_dragging)
            {
                _dragDocument = null; EndDragPreparation();
                if (_dragCaptureOwned && ReferenceEquals(Mouse.Captured, _window)) Mouse.Capture(null);
                _dragCaptureOwned = false; ScheduleDeferredRefresh();
                if (_window.IsActive) Active?.View.Focus();
            }
            e.Handled = true;
        };
        strip.DragOver += OnDragOver;
        strip.DragLeave += (_, e) => {
            if (new Rect(strip.RenderSize).Contains(e.GetPosition(strip))) return;
            if(e.Data.GetData(DragFormat, false) is DragToken token && token.HoverTarget == this) token.HoverTarget = null;
            ClearInsertion();
        };
        strip.Drop += OnDrop;
        strip.Background = Brushes.Transparent;
        window.PreviewMouseMove += OnStripMouseMove;
        window.PreviewMouseLeftButtonUp += (_, _) =>
        {
            var selected = _dragDocument; _dragDocument = null;
            EndDragPreparation();
            if (_dragCaptureOwned && ReferenceEquals(Mouse.Captured, _window)) Mouse.Capture(null);
            _dragCaptureOwned = false;
            selected?.View.Focus();
            ScheduleDeferredRefresh();
        };
        strip.LostMouseCapture += (_, _) => ScheduleDeferredRefresh();
        strip.MouseLeftButtonDown += (_, e) =>
        {
            if (e.OriginalSource != strip) return;
            if (e.ClickCount == 2) { if (window.WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(window); else SystemCommands.MaximizeWindow(window); }
            else if (window.WindowState == WindowState.Normal) window.DragMove();
        };
        strip.SizeChanged += (_, _) => Refresh();
        window.SizeChanged += (_, e) => {
            if (!_mergeSize.Remembered || window.WindowState != WindowState.Normal) return;
            try
            {
                // A reused probe can still report the old DPI while its queued
                // DPI notification is pending. Size events need a fresh probe.
                using var densityReader = new DocumentDragDesktop.Reader();
                var density = densityReader.Read(true, window).Scale;
                _mergeSize.Observe(new(e.NewSize.Width, e.NewSize.Height), true, density);
            }
            catch (System.IO.IOException) { } // Missing display facts never invent a manual resize.
        };
        window.Activated += (_, _) => ActivationOrder = ++_activationSequence;
        window.Closed += (_, _) => { EndDragPreparation(); ClearInsertion(); Windows.Remove(this); if (Windows.Count == 0) Application.Current.Shutdown(); };
    }

    internal bool PathAvailable(DocumentSession owner, string path) => Windows.SelectMany(item => item._documents)
        .All(document => document == owner || document.State.FilePath is null ||
            !string.Equals(document.State.FilePath, path, StringComparison.OrdinalIgnoreCase));

    internal void Attach(DocumentSession session, int? index = null)
    {
        if (session.View.Parent is Panel old) old.Children.Remove(session.View);
        session.Owner = _window;
        session.SetPresentation(_window.IsLightweight);
        session.Connect = _window.ConnectDocumentAsync;
        session.OpenFilePicker = async () =>
        {
            var dialog = new Microsoft.Win32.OpenFileDialog { Title = "打开文档为新标签", Filter = "AI Canvas 项目|*.excalidraw", Multiselect = false };
            if (dialog.ShowDialog(_window) != true) return;
            if (!DocumentOpenRequest.TryCreate([dialog.FileName], out var open, out var error)) throw new InvalidOperationException(error);
            if (!await OpenAsync(open)) ShowBusyOpenMessage();
        };
        session.PathAvailable = path => PathAvailable(session, path);
        session.Changed = document => {
            var owner = Windows.FirstOrDefault(item => item._documents.Contains(document)); owner?.Refresh();
            if (owner?.Active == document) owner.ActivatedDocument?.Invoke(document);
        };
        _documents.Insert(Math.Clamp(index ?? _documents.Count, 0, _documents.Count), session);
        _host.Children.Add(session.View);
        Activate(session);
    }

    internal void Activate(DocumentSession session, bool focus = true)
    {
        if (!_documents.Contains(session)) return;
        if (Active == session) { Refresh(); if (focus) session.View.Focus(); return; }
        Active = session;
        // Selection feedback during mouse capture must update the existing
        // elements; Refresh remains deferred so the captured tab is not removed.
        UpdateTabAppearance();
        foreach (var document in _documents) document.View.Visibility = document == session ? Visibility.Visible : Visibility.Collapsed;
        session.Owner = _window;
        session.SetPresentation(_window.IsLightweight);
        var activeIndex = _documents.IndexOf(session);
        var capacity = Capacity();
        if (activeIndex < _firstVisible) _firstVisible = activeIndex;
        if (activeIndex >= _firstVisible + capacity) _firstVisible = activeIndex - capacity + 1;
        Refresh(); ActivatedDocument?.Invoke(session); if (focus) session.View.Focus();
    }

    internal Task<bool> OpenAsync(DocumentOpenRequest? open) => DocumentOpenOperation.TryRunAsync(
        () => _busy || !_strip.IsEnabled, busy => _busy = busy, async () =>
        {
            if (open is not null)
            {
                var duplicate = Windows.SelectMany(owner => owner._documents.Select(document => (owner, document)))
                    .FirstOrDefault(item => string.Equals(item.document.State.FilePath, open.FilePath, StringComparison.OrdinalIgnoreCase));
                if (duplicate.document is not null) { duplicate.owner.Activate(duplicate.document); duplicate.owner._window.Activate(); return; }
            }
            var session = await CreateDocument(open);
            if (!_documents.Contains(session)) Attach(session);
            if (!await session.ReadyTask.WaitAsync(TimeSpan.FromSeconds(30))) throw new InvalidOperationException("新文档加载失败，原文档保留。");
            Refresh();
        });
    private void ShowBusyOpenMessage()
    {
        if (!QueueBusyNotice()) MessageBox.Show(_window,
            "当前窗口正在处理文档操作，未打开新的文档。请稍后重试。", "AI Canvas", MessageBoxButton.OK, MessageBoxImage.Information);
    }
    private bool QueueBusyNotice()
    {
        if (Active is null || !DocumentThemeTokens.Ready(Active.Palette)) return false;
        if (!_busyNoticeShowing) _busyNoticePending = true;
        FlushBusyNotice(); return true;
    }
    private void FlushBusyNotice()
    {
        if (!_busyNoticePending || _busyNoticeShowing || _dragging || !Windows.Contains(this)) return;
        _busyNoticePending = false; _busyNoticeShowing = true;
        _window.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Background, new Action(() =>
        {
            try
            {
                if (Windows.Contains(this) && Active is not null)
                    DocumentCloseDialog.Notify(_window, "暂时无法打开文档", "当前窗口正在处理文档操作。新的文档尚未打开，请稍后重试。", Active.Palette);
            }
            finally { _busyNoticeShowing = false; }
        }));
    }
    internal static async Task<DocumentDispatchResult> DispatchAsync(DocumentDispatchRequest request)
    {
        if (request.Path is not null)
        {
            var duplicate = Windows.SelectMany(owner => owner._documents.Select(document => (owner, document)))
                .FirstOrDefault(item => string.Equals(item.document.State.FilePath, request.Path, StringComparison.OrdinalIgnoreCase));
            if (duplicate.document is not null)
            {
                duplicate.owner.Activate(duplicate.document); BringToFront(duplicate.owner._window); return DocumentDispatchResult.Accepted;
            }
        }
        var target = Windows.OrderByDescending(window => window.ActivationOrder).FirstOrDefault();
        if (target is null) return DocumentDispatchResult.Rejected;
        BringToFront(target._window);
        if (request.Action == "activate") return DocumentDispatchResult.Accepted;
        if (!DocumentOpenRequest.TryCreate([request.Path!], out var open, out var error)) throw new InvalidOperationException(error);
        await target._window.WaitForInitialPresentationAsync();
        if (await target.OpenAsync(open)) return DocumentDispatchResult.Accepted;
        return target.QueueBusyNotice() ? DocumentDispatchResult.RejectedWithNotice : DocumentDispatchResult.Rejected;
    }
    private static void BringToFront(MainWindow window)
    {
        if (window.WindowState == WindowState.Minimized) SystemCommands.RestoreWindow(window);
        window.Activate();
    }

    private int Capacity() => Math.Max(1, (int)Math.Floor((Math.Max(_strip.ActualWidth, 280) - 68) / 238));
    private Brush Color(DocumentSession? session, string key, string fallback) => new SolidColorBrush(
        (System.Windows.Media.Color)ColorConverter.ConvertFromString(session?.Palette.GetValueOrDefault(key, fallback) ?? fallback));
    internal void Refresh()
    {
        if (_dragging || _dragDocument is not null || _dragCaptureOwned ||
            Mouse.Captured is DependencyObject captured && IsInside(captured, _strip))
        {
            _refreshPending = true;
            return;
        }
        _refreshPending = false;
        if (_strip.ActualWidth <= 0 && _documents.Count == 0) return;
        var capacity = Capacity();
        _firstVisible = Math.Clamp(_firstVisible, 0, Math.Max(0, _documents.Count - 1));
        var visible = _documents.Skip(_firstVisible).Take(capacity).ToArray();
        var buttonCount = _documents.Count > capacity ? 2 : 1;
        if (_visible.Select(item => item.Document).SequenceEqual(visible) && _stripButtons.Count == buttonCount)
        {
            UpdateTabAppearance();
            return;
        }
        ClearInsertion(); _strip.Children.Clear(); _visible.Clear(); _updateTabAppearance.Clear(); _stripButtons.Clear();
        foreach (var document in visible)
        {
            var tab = new Border { Width = 236, Height = 31, Margin = new Thickness(0, 3, 2, 0),
                Background = Color(Active, document == Active ? "canvas" : "header", "#F7F7F7"),
                CornerRadius = new CornerRadius(6, 6, 0, 0), ToolTip = document.State.Name };
            Brush TabSurface(bool hover)
            {
                var normal = Active?.Palette.GetValueOrDefault(document == Active ? "canvas" : "header", "#F7F7F7") ?? "#F7F7F7";
                var accent = Active?.Palette.GetValueOrDefault("accentSurface", normal) ?? normal;
                // An active tab keeps its selection surface through press/release.
                // Only inactive tabs need a separate hover cue.
                return new SolidColorBrush((System.Windows.Media.Color)ColorConverter.ConvertFromString(hover && document != Active ? DocumentThemeTokens.Mix(accent, normal, .55) : normal));
            }
            tab.MouseEnter += (_, _) => tab.Background = TabSurface(true);
            tab.MouseLeave += (_, _) => tab.Background = TabSurface(false);
            tab.PreviewMouseLeftButtonUp += (_, _) => tab.Background = TabSurface(tab.IsMouseOver);
            var grid = new Grid(); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
            grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
            var label = new TextBlock { Text = document.State.Name, FontSize = 12.5,
                FontWeight = document == Active ? FontWeights.SemiBold : FontWeights.Normal,
                VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = Color(Active, document == Active ? "text" : "mutedText", "#303238") };
            Grid.SetColumn(label, 1); grid.Children.Add(label);
            var dirtyMark = new TextBlock { Text = document.State.Dirty ? "*" : "", FontSize = 12.5, Width = document.State.Dirty ? 10 : 0,
                VerticalAlignment = VerticalAlignment.Center, Foreground = Color(Active, "accent", "#6B56A5") };
            Grid.SetColumn(dirtyMark, 2); grid.Children.Add(dirtyMark);
            var symbol = new Image { Width = 16, Height = 16, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center,
                Source = DocumentTabIcon() };
            grid.Children.Add(symbol);
            var close = new Button { Width = 24, Height = 24, VerticalAlignment = VerticalAlignment.Center, Content = new System.Windows.Shapes.Path { Width = 7, Height = 7,
                    Data = Geometry.Parse("M0,0 L7,7 M7,0 L0,7"), Stroke = Color(Active, "icon", "#34373D"), StrokeThickness = 1.1 }, Padding = new Thickness(0), BorderThickness = new Thickness(0),
                Background = Brushes.Transparent, Foreground = Color(Active, "icon", "#34373D"), ToolTip = "关闭 " + document.State.Name };
            var closeBorder = new FrameworkElementFactory(typeof(Border)); closeBorder.SetValue(Border.CornerRadiusProperty, new CornerRadius(5));
            closeBorder.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
            var closeContent = new FrameworkElementFactory(typeof(ContentPresenter)); closeContent.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center); closeContent.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            closeBorder.AppendChild(closeContent); close.Template = new ControlTemplate(typeof(Button)) { VisualTree = closeBorder };
            close.MouseEnter += (_, _) => { var brush = (SolidColorBrush)Color(Active, "text", "#303238"); var color = brush.Color; color.A = 26; close.Background = new SolidColorBrush(color); };
            close.MouseLeave += (_, _) => close.Background = Brushes.Transparent;
            Grid.SetColumn(close, 3); grid.Children.Add(close); tab.Child = grid;
            _updateTabAppearance.Add(() => {
                tab.Background = TabSurface(tab.IsMouseOver);
                tab.ToolTip = document.State.Name;
                label.Text = document.State.Name;
                label.FontWeight = document == Active ? FontWeights.SemiBold : FontWeights.Normal;
                label.Foreground = Color(Active, document == Active ? "text" : "mutedText", "#303238");
                dirtyMark.Text = document.State.Dirty ? "*" : "";
                dirtyMark.Width = document.State.Dirty ? 10 : 0;
                dirtyMark.Foreground = Color(Active, "accent", "#6B56A5");
                symbol.Source = DocumentTabIcon();
                close.ToolTip = "关闭 " + document.State.Name;
                ((System.Windows.Shapes.Path)close.Content).Stroke = Color(Active, "icon", "#34373D");
            });
            close.Click += async (_, _) => await CloseOneAsync(document);
            tab.MouseRightButtonUp += (_, e) => {
                e.Handled = true;
                if (_busy || _dragging || !_strip.IsEnabled) { QueueBusyNotice(); return; }
                if (!_documents.Contains(document) || Active is null || !DocumentThemeTokens.Ready(Active.Palette)) return;
                // Move the native keyboard owner out of the WebView before
                // opening a WPF popup, including on a background tab.
                Keyboard.Focus(_strip);
                var menu = DocumentContextMenu.Create(tab, Active.Palette,
                    ("保存", () => _ = SaveFromMenuAsync(document, false), document.Ready),
                    ("另存为", () => _ = SaveFromMenuAsync(document, true), document.Ready),
                    ("重命名", () => _ = RenameFromMenuAsync(document), document.Ready),
                    ("关闭", () => _ = CloseOneAsync(document), true));
                menu.Closed += (_, _) => _window.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.ContextIdle,
                    new Action(() => { if (_window.IsActive && !_busy && Windows.Contains(this)) Active?.View.Focus(); }));
                tab.ContextMenu = menu; menu.IsOpen = true;
            };
            tab.PreviewMouseLeftButtonDown += (_, e) =>
            {
                if (e.OriginalSource is FrameworkElement element && (element == close || IsInside(element, close))) return;
                _dragDocument = document; _dragStart = e.GetPosition(_strip);
                _dragCancelled = false;
                _dragGrab = e.GetPosition(tab); _dragGrab.Y += 3;
                Activate(document, false); _dragCaptureOwned = Mouse.Capture(_window, CaptureMode.SubTree); e.Handled = true;
                // The press/drag belongs to the title strip. Keep an early Esc
                // in this window instead of routing it into the live WebView.
                Keyboard.Focus(_strip);
                tab.Background = TabSurface(tab.IsMouseOver);
                EndDragPreparation();
                _dragPreparation = new DocumentDragLease(document.State.Id);
                if (!_busy && _documents.Count > 1 && document.Ready)
                    _dragSnapshot = DocumentDragPreview.CaptureAsync(document, _dragPreparation);
            };
            _strip.Children.Add(tab); _visible.Add((document, tab));
        }
        var add = new Button { Content = "+", Width = 32, Height = 34, Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            Foreground = Color(Active, "icon", "#34373D"), ToolTip = "新建文档" };
        KeepDisabledStripSurface(add);
        add.Click += async (_, _) => { if (!await OpenAsync(null)) ShowBusyOpenMessage(); }; _strip.Children.Add(add);
        _stripButtons.Add(add);
        if (_documents.Count > capacity)
        {
            var overflow = new Button { Content = "»", Width = 32, Height = 34, Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                Foreground = Color(Active, "icon", "#34373D"), ToolTip = "选择文档" };
            KeepDisabledStripSurface(overflow);
            overflow.Click += (_, _) =>
            {
                var menu = new ContextMenu();
                foreach (var document in _documents)
                {
                    var item = new MenuItem { Header = document.State.Name + (document.State.Dirty ? " *" : ""), IsCheckable = true, IsChecked = document == Active };
                    item.Click += (_, _) => Activate(document); menu.Items.Add(item);
                }
                overflow.ContextMenu = menu; menu.IsOpen = true;
            };
            _strip.Children.Add(overflow);
            _stripButtons.Add(overflow);
        }
        UpdateTabAppearance();
    }
    private void UpdateTabAppearance()
    {
        foreach (var update in _updateTabAppearance) update();
        foreach (var button in _stripButtons) button.Foreground = Color(Active, "icon", "#34373D");
    }
    private static void KeepDisabledStripSurface(Button button)
    {
        // A modal disables the owner. The system ButtonChrome otherwise paints
        // a white block in a dark title strip; keep its enabled style unchanged.
        var surface = new FrameworkElementFactory(typeof(Border));
        surface.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center); surface.AppendChild(content);
        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(Control.TemplateProperty, new ControlTemplate(typeof(Button)) { VisualTree = surface }));
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, .5));
        var style = new Style(typeof(Button)); style.Triggers.Add(disabled); button.Style = style;
    }
    private static bool IsInside(DependencyObject element, DependencyObject parent)
    {
        for (var current = element; current is not null; current = VisualTreeHelper.GetParent(current)) if (current == parent) return true;
        return false;
    }
    private void ScheduleDeferredRefresh()
    {
        _window.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Input, new Action(() =>
        {
            if (_refreshPending && !_dragging && _dragDocument is null && !_dragCaptureOwned &&
                !(Mouse.Captured is DependencyObject captured && IsInside(captured, _strip))) Refresh();
        }));
    }
    private System.Windows.Media.ImageSource? DocumentTabIcon()
    {
        var scale = VisualTreeHelper.GetDpi(_window).DpiScaleX;
        if (_tabIcon is not null && _tabIconScale == scale) return _tabIcon;
        var path = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "AI-Canvas-Document-A.ico");
        if (!System.IO.File.Exists(path)) return null;
        using var stream = System.IO.File.OpenRead(path);
        var decoder = new System.Windows.Media.Imaging.IconBitmapDecoder(stream,
            System.Windows.Media.Imaging.BitmapCreateOptions.PreservePixelFormat, System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);
        var pixels = 16 * scale;
        var frame = decoder.Frames.OrderBy(image => Math.Abs(image.PixelWidth - pixels)).First(); frame.Freeze();
        _tabIconScale = scale; return _tabIcon = frame;
    }
    private async Task SaveFromMenuAsync(DocumentSession document, bool saveAs)
    {
        if (_busy || !_documents.Contains(document) || !document.Ready) { QueueBusyNotice(); return; }
        _busy = true;
        try
        {
            Activate(document);
            using var gate = new DocumentCloseInputGate(SetInteractionEnabled);
            await document.SaveForCloseAsync(saveAs);
        }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            if (Windows.Contains(this)) DocumentCloseDialog.Notify(_window, "尚未保存", "保存未确认完成，文档已保留。", document.Palette);
        }
        finally
        {
            _busy = false;
            if (Windows.Contains(this)) { if (Active?.Ready == true) Active.View.Focus(); FlushBusyNotice(); }
        }
    }
    private async Task RenameFromMenuAsync(DocumentSession document)
    {
        if (_busy || !_documents.Contains(document) || !document.Ready) return;
        _busy = true;
        try
        {
            using var gate = new DocumentCloseInputGate(SetInteractionEnabled);
            await document.DrainSavesAsync();
            var name = DocumentCloseDialog.Rename(_window, document.State.Name, document.Palette);
            if (name is not null) await document.RenameAsync(name);
        }
        catch (Exception error) when (error is System.IO.IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            DocumentCloseDialog.Notify(_window, "尚未重命名", error.Message, document.Palette);
        }
        finally { _busy = false; if (_window.IsActive) Active?.View.Focus(); }
    }

    private void EndDragPreparation()
    {
        _dragPreparation?.End(); _dragPreparation = null; _dragSnapshot = null;
    }
    private async void OnStripMouseMove(object sender, MouseEventArgs e)
    {
        var document = _dragDocument;
        if (document is null || _busy || e.LeftButton != MouseButtonState.Pressed || !document.Ready) return;
        var position = e.GetPosition(_strip);
        if (Math.Abs(position.X - _dragStart.X) < SystemParameters.MinimumHorizontalDragDistance && Math.Abs(position.Y - _dragStart.Y) < SystemParameters.MinimumVerticalDragDistance) return;
        _dragDocument = null;
        if (_dragCaptureOwned && ReferenceEquals(Mouse.Captured, _window)) Mouse.Capture(null);
        _dragCaptureOwned = false;
        if (!DocumentThemeTokens.Ready(document.Palette)) { EndDragPreparation(); ScheduleDeferredRefresh(); return; }
        var token = new DragToken { Source = this, Session = document,
            HoverTarget = _documents.Count > 1 && new Rect(_strip.RenderSize).Contains(position) ? this : null };
        var normal = _window.WindowState == WindowState.Normal ? new Size(_window.ActualWidth, _window.ActualHeight) : _window.RestoreBounds.Size;
        var size = DocumentDragGeometry.DetachedSize(normal.Width, normal.Height, _window.IsLightweight,
            _mergeSize.Matches(new(normal.Width, normal.Height)));
        var lease = _dragPreparation ?? new DocumentDragLease(document.State.Id);
        var snapshot = _dragSnapshot;
        _dragPreparation = null; _dragSnapshot = null;
        DocumentDragPreview? preview = null;
        Exception? previewFailure = null;
        DocumentBounds lastBounds = default;
        var singleSource = _documents.Count == 1;
        var dragStarted = false;
        Exception? dragError = null;
        using var desktopReader = new DocumentDragDesktop.Reader();
        void Follow(bool release = false)
        {
            if (_dragCancelled || !lease.Active || !Windows.Contains(this) || !_documents.Contains(document) || !_strip.IsEnabled ||
                token.HoverTarget is { } hover && (!Windows.Contains(hover) || !hover._strip.IsEnabled)) { token.Cancelled = true; return; }
            try {
                var desktop = desktopReader.Read(release);
                lastBounds = DocumentDragGeometry.Place(desktop.Pointer.X, desktop.Pointer.Y, _dragGrab.X, _dragGrab.Y, size, desktop.Work, desktop.Scale);
                if (token.HoverTarget is { } target)
                {
                    var point = target._strip.PointFromScreen(new Point(desktop.Pointer.X, desktop.Pointer.Y));
                    if (!target._window.IsVisible || !new Rect(target._strip.RenderSize).Contains(point))
                    { target.ClearInsertion(); token.HoverTarget = null; }
                }
                if (!dragStarted) return;
                var previewBounds = lastBounds;
                if (token.HoverTarget is not null || singleSource || preview?.CaptureFailed == true)
                {
                    var small = DocumentDragGeometry.Place(desktop.Pointer.X, desktop.Pointer.Y,
                        _dragGrab.X, _dragGrab.Y, new DocumentSize(238, 34), desktop.Work, desktop.Scale);
                    previewBounds = small;
                    preview?.Move(small, true);
                }
                else preview?.Move(lastBounds, false);
                if (token.HoverTarget is { } receiver)
                {
                    var local = receiver._strip.PointFromScreen(new Point(desktop.Pointer.X, desktop.Pointer.Y));
                    receiver.ShowInsertion(token, receiver.InsertionSlot(local.X), desktop.Work, desktop.Scale, previewBounds.Top + previewBounds.Height);
                }
            } catch (Exception error) { previewFailure = error; token.Cancelled = true; }
        }
        var data = new DataObject(); data.SetData(DragFormat, token, false);
        QueryContinueDragEventHandler cancel = (_, args) => {
            if (args.EscapePressed || _dragCancelled) token.Cancelled = true;
            else if ((args.KeyStates & DragDropKeyStates.LeftMouseButton) == 0) Follow(true);
            if(token.Cancelled) args.Action = DragAction.Cancel;
            else if ((args.KeyStates & DragDropKeyStates.LeftMouseButton) == 0) { token.Released = true; args.Action = DragAction.Drop; }
            else args.Action = DragAction.Continue;
            args.Handled = true;
        };
        GiveFeedbackEventHandler feedback = (_, args) => { Follow(); args.UseDefaultCursors = false; args.Handled = true; Mouse.SetCursor(token.Cancelled ? Cursors.No : Cursors.SizeAll); };
        var previousCursor = Mouse.OverrideCursor;
        _busy = true; _dragging = true;
        try
        {
            preview = new DocumentDragPreview(document, lease, size, DocumentTabIcon());
            if (!singleSource)
                foreach(var item in _visible) if(item.Document == document) item.Tab.Opacity = .38;
            Follow();
            if(token.Cancelled) throw previewFailure ?? new InvalidOperationException("拖动源已不可用，保留原文档。");
            _strip.GiveFeedback += feedback;
            _strip.QueryContinueDrag += cancel;
            dragStarted = true;
            if (snapshot is not null) _ = preview.ReceiveAsync(snapshot, () => Follow());
            DragDrop.DoDragDrop(_strip, data, DragDropEffects.Move);
            token.Cancelled |= _dragCancelled;
            dragStarted = false; // Late screenshot completion must not follow a released pointer.
            Mouse.OverrideCursor = previousCursor;
            if(previewFailure is not null) throw previewFailure;
            // WebView/native controls may return an OLE effect even though our
            // tab receiver did not accept the document. Only our receipt merges.
            if (DocumentDragGeometry.ShouldDetach(token.Released, token.Cancelled, token.Received, _documents.Contains(document), _documents.Count))
            {
                var originalIndex = _documents.IndexOf(document);
                var target = CreateDetachedWindow(document, size, lastBounds);
                var receiver = Windows.Single(item => item._window == target);
                try
                {
                    Transfer(document, receiver, 0); token.ReceivedBy = receiver;
                    receiver._busy = true; receiver.SetInteractionEnabled(false);
                    try
                    {
                        target.Show();
                        // Keep the same static preview over the live view until
                        // its new viewport has reached a rendered frame.
                        await DocumentDragPreview.WaitForPresentationAsync(document);
                    }
                    finally { receiver._busy = false; receiver.SetInteractionEnabled(true); }
                }
                catch
                {
                    if (receiver._documents.Contains(document)) receiver.Transfer(document, this, originalIndex);
                    token.ReceivedBy = null;
                    if (Windows.Contains(receiver) && receiver._documents.Count == 0) target.Close();
                    throw;
                }
            }
        }
        catch (Exception error) { dragError = error; }
        finally
        {
            lease.End(); preview?.Dispose(); Mouse.OverrideCursor = previousCursor;
            _busy = false; _dragging = false;
            _strip.QueryContinueDrag -= cancel; _strip.GiveFeedback -= feedback;
            foreach(var owner in Windows.ToArray()) owner.ClearInsertion();
            foreach(var item in _visible) item.Tab.Opacity = 1;
            if (Windows.Contains(this)) Refresh();
            // OLE and preview teardown can reactivate the source. Activate only
            // after both have ended; never use Topmost or an owner relationship.
            if (token.ReceivedBy is { } receiver && Windows.Contains(receiver))
            { BringToFront(receiver._window); receiver.Active?.View.Focus(); }
            else if (Windows.Contains(this))
            {
                if (_window.IsActive) Active?.View.Focus();
            }
            // A single-tab source can disappear after a successful merge.
            // Carry its deferred refusal notice to the surviving receiver.
            if (_busyNoticePending && !Windows.Contains(this) && token.ReceivedBy is { } noticeOwner && Windows.Contains(noticeOwner))
            {
                _busyNoticePending = false; noticeOwner.QueueBusyNotice();
            }
            FlushBusyNotice();
        }
        if (dragError is not null && Windows.Contains(this))
            DocumentCloseDialog.Notify(_window, "未能移动标签", "文档已保留在原窗口。请重试。\n" + dragError.Message, document.Palette);
    }
    private void OnDragOver(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DragFormat, false) is not DragToken token || !Windows.Contains(token.Source)) return;
        if (_busy && token.Source != this) { token.Cancelled = true; e.Effects = DragDropEffects.None; e.Handled = true; return; }
        e.Effects = DragDropEffects.Move; e.Handled = true;
        token.HoverTarget = this;
        // Geometry/feedback is updated by the source's single feedback path.
        // This handler only establishes the native target; it draws no line.
    }
    private void ShowInsertion(DragToken token, int index, DocumentBounds work, double scale, double previewBottom)
    {
        if (Active is null || !DocumentThemeTokens.Ready(Active.Palette)) return;
        if (_dropHint is null)
        {
            _dropHint = new DocumentDropHint(Active.Palette);
            if (token.Source != this)
                _window.SetDocumentMergeHighlight(DocumentThemeTokens.Mix(Active.Palette["text"], Active.Palette["header"], .12));
            else
                _strip.Background = new SolidColorBrush((System.Windows.Media.Color)ColorConverter.ConvertFromString(
                    DocumentThemeTokens.Mix(Active.Palette["accentSurface"], Active.Palette["header"], .18)));
        }
        var text = DocumentDragGeometry.DropHint(_documents.Select(item => item.State.Name).ToArray(), index,
            token.Source == this ? _documents.IndexOf(token.Session) : -1);
        var local = _strip.TranslatePoint(new Point(8, _strip.ActualHeight + 8), _window);
        var point = DocumentDragDesktop.WindowPointToScreen(_window, local, scale);
        point.Y = Math.Max(point.Y, previewBottom + 8 * scale);
        _dropHint.Show(text, point, work, scale);
    }
    private void OnDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DragFormat, false) is not DragToken token || token.Cancelled || token.Received || !Windows.Contains(token.Source) || !Windows.Contains(this)) return;
        var index = Math.Clamp(InsertionSlot(e.GetPosition(_strip).X), 0, _documents.Count);
        token.Source.Transfer(token.Session, this, index, merge: true); token.Received = true; token.ReceivedBy = this;
        e.Effects = DragDropEffects.Move; e.Handled = true; ClearInsertion();
    }
    private int InsertionSlot(double x) => DocumentDragGeometry.InsertSlot(x,
        _visible.Select(item => (item.Tab.TranslatePoint(new Point(), _strip).X, item.Tab.ActualWidth)).ToArray(), _firstVisible);
    private void ClearInsertion()
    {
        _strip.Background = Brushes.Transparent;
        _window.SetDocumentMergeHighlight(null);
        _dropHint?.Dispose(); _dropHint = null;
    }
    private (DocumentBounds Before, DocumentBounds After, DocumentSize Size, double Scale)? PrepareMergedWindow()
    {
        if (_window.WindowState != WindowState.Normal || _window.IsDocumentFullscreen) return null;
        using var reader = new DocumentDragDesktop.Reader();
        var desktop = reader.Read();
        var current = new DocumentSize(_window.ActualWidth, _window.ActualHeight);
        var available = new DocumentSize(desktop.Work.Width / desktop.Scale - 16, desktop.Work.Height / desktop.Scale - 16);
        var desired = DocumentDragGeometry.MergedSize(current, _window.DefaultDocumentWindowSize, available,
            new DocumentSize(_window.MinWidth, _window.MinHeight));
        if (desired.Width <= current.Width && desired.Height <= current.Height) return null;
        var before = DocumentDragDesktop.ReadWindowBounds(_window);
        var after = DocumentDragGeometry.Place(before.Left, before.Top, 0, 0, desired, desktop.Work, desktop.Scale);
        return (before, after, desired, desktop.Scale);
    }
    private void Transfer(DocumentSession document, DocumentTabController target, int index, bool merge = false)
    {
        if (!_documents.Contains(document)) return;
        var previousIndex = _documents.IndexOf(document);
        if (target == this)
        {
            var reordered = DocumentDragGeometry.ReorderSlot(previousIndex, index, _documents.Count);
            _documents.Remove(document); _documents.Insert(reordered, document); Activate(document); return;
        }
        var resize = merge ? target.PrepareMergedWindow() : null;
        var originalCore = document.View.CoreWebView2;
        _documents.Remove(document); _host.Children.Remove(document.View);
        try
        {
            target.Attach(document, index);
            if (!ReferenceEquals(originalCore, document.View.CoreWebView2)) throw new InvalidOperationException("Core发生变化，停止迁移。");
            if (resize is { } change)
            {
                DocumentDragDesktop.Place(target._window, change.After, false);
                if (target._window.IsLightweight) target._mergeSize.Remember(change.Size, change.Scale);
            }
            if (target._window.IsVisible) target._window.Activate();
        }
        catch
        {
            target._documents.Remove(document);
            if (document.View.Parent is Panel partial) partial.Children.Remove(document.View);
            Attach(document, previousIndex);
            if (resize is { } change && Windows.Contains(target)) DocumentDragDesktop.Place(target._window, change.Before, false);
            throw;
        }
        if (_documents.Count == 0 && target != this) _window.Close();
        else if (target != this) Activate(_documents[Math.Min(_documents.Count - 1, 0)]);
        else Refresh();
    }
    internal async Task<bool> PrepareWindowCloseAsync()
    {
        var plan = new DocumentClosePlan(); // Never retain discard decisions after cancellation.
        foreach (var document in _documents.ToArray())
        {
            await document.DrainSavesAsync();
            if (!await document.RefreshCloseStateAsync()) return false;
            if (!document.State.Dirty) { plan.Approve(document.State, false); continue; }
            var choice = DocumentCloseDialog.Ask(_window, document.State.Name, document.Palette);
            if (choice == DocumentCloseChoice.Cancel) return false;
            if (choice == DocumentCloseChoice.Save && !await document.SaveForCloseAsync()) return false;
            plan.Approve(document.State, choice == DocumentCloseChoice.Discard);
        }
        return plan.Ready(_documents.Select(document => document.State));
    }
    private async Task CloseOneAsync(DocumentSession document)
    {
        if (_busy) return;
        if (_documents.Count == 1) { _window.Close(); return; }
        _busy = true;
        var previousActive = Active;
        var stripEnabled = _strip.IsEnabled;
        var viewEnabled = document.View.IsEnabled;
        using var inputGate = new DocumentCloseInputGate(enabled => {
            _strip.IsEnabled = enabled && stripEnabled;
            if (_documents.Contains(document)) document.View.IsEnabled = enabled && viewEnabled;
        });
        try
        {
            await document.DrainSavesAsync();
            if (!await document.RefreshCloseStateAsync()) return;
            if (document.State.Dirty)
            {
                var choice = DocumentCloseDialog.Ask(_window, document.State.Name, document.Palette);
                if (choice == DocumentCloseChoice.Cancel || choice == DocumentCloseChoice.Save && !await document.SaveForCloseAsync()) return;
            }
            _documents.Remove(document); _host.Children.Remove(document.View); document.Dispose();
            Activate(previousActive is not null && _documents.Contains(previousActive) ? previousActive : _documents[0]);
        }
        finally { _busy = false; }
    }
    internal void DisposeOwnedDocuments() { foreach (var document in _documents) document.Dispose(); _documents.Clear(); }
}

internal enum DocumentCloseChoice { Save, Discard, Cancel }
