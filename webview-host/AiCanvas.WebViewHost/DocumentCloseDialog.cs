using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;

namespace AiCanvas.WebViewHost;

internal static class DocumentCloseDialog
{
    private static Brush Token(IReadOnlyDictionary<string, string> palette, string key) =>
        new SolidColorBrush((Color)ColorConverter.ConvertFromString(palette[key]));
    private static Button Button(string title, IReadOnlyDictionary<string, string> palette, bool primary = false, bool low = false)
    {
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        foreach (var property in new[] { Border.BackgroundProperty, Border.BorderBrushProperty, Border.BorderThicknessProperty })
            border.SetBinding(property, new Binding(property.Name) { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        content.SetBinding(ContentPresenter.MarginProperty, new Binding("Padding") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        border.AppendChild(content);
        var button = new Button { Content = title, FontSize = 12, Padding = new Thickness(13,8,13,8),
            Background = Token(palette, primary ? "accent" : "surface"),
            Foreground = Token(palette, primary ? "raised" : low ? "mutedText" : "text"),
            BorderBrush = Token(palette, "border"), BorderThickness = new Thickness(primary || low ? 0 : 1),
            Template = new ControlTemplate(typeof(Button)) { VisualTree = border } };
        button.MouseEnter += (_, _) => button.Background = Token(palette, primary ? "accent" : "header");
        button.MouseLeave += (_, _) => button.Background = Token(palette, primary ? "accent" : "surface");
        return button;
    }
    private static Window Window(Window owner, string title, StackPanel panel, IReadOnlyDictionary<string, string> palette)
    {
        KeyboardNavigation.SetTabNavigation(panel, KeyboardNavigationMode.Cycle);
        return new Window { Owner = owner, Title = title, Tag = palette, Width = Math.Min(440, Math.Max(320, owner.ActualWidth - 32)),
            SizeToContent = SizeToContent.Height, WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
            ShowInTaskbar = false, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new Border { CornerRadius = new CornerRadius(14), Background = Token(palette, "surface"),
                BorderBrush = Token(palette, "border"), BorderThickness = new Thickness(1), Child = panel } };
    }
    private static TextBlock Text(string text, IReadOnlyDictionary<string, string> palette, bool title = false) => new()
    {
        Text = text, FontSize = title ? 17 : 13, FontWeight = title ? FontWeights.SemiBold : FontWeights.Normal,
        Foreground = Token(palette, title ? "text" : "mutedText"), TextWrapping = TextWrapping.Wrap
    };
    internal static DocumentCloseChoice Ask(Window owner, string name, IReadOnlyDictionary<string, string> palette)
    {
        if (!DocumentThemeTokens.Ready(palette)) return DocumentCloseChoice.Cancel;
        var answer = DocumentCloseChoice.Cancel;
        var panel = new StackPanel { Margin = new Thickness(24) };
        panel.Children.Add(Text("保存对画布的修改？", palette, true));
        panel.Children.Add(new TextBlock { Text = name, FontSize = 13, TextWrapping = TextWrapping.Wrap,
            Foreground = Token(palette,"text"), Margin = new Thickness(0,12,0,4) });
        var description = Text("关闭前是否保存当前修改？",palette); description.Margin = new Thickness(0,0,0,20); panel.Children.Add(description);
        var buttons = new Grid();
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        buttons.ColumnDefinitions.Add(new ColumnDefinition());
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var discard = Button("不保存并关闭",palette,low:true);
        var cancel = Button("取消",palette); cancel.Margin = new Thickness(0,0,8,0); cancel.IsCancel = true;
        var save = Button("保存并关闭",palette,primary:true);
        buttons.Children.Add(discard); Grid.SetColumn(cancel,2);buttons.Children.Add(cancel);Grid.SetColumn(save,3);buttons.Children.Add(save);
        panel.Children.Add(buttons);
        var dialog = Window(owner,"关闭文档",panel,palette);
        discard.Click += (_,_) => { answer = DocumentCloseChoice.Discard; dialog.Close(); };
        cancel.Click += (_,_) => dialog.Close();
        save.Click += (_,_) => { answer = DocumentCloseChoice.Save; dialog.Close(); };
        dialog.ContentRendered += (_,_) => cancel.Focus();
        dialog.PreviewKeyDown += (_,e) => { if(e.Key == Key.Escape) { answer=DocumentCloseChoice.Cancel; dialog.Close();e.Handled=true; } };
        dialog.ShowDialog();return answer;
    }
    internal static string? Rename(Window owner, string name, IReadOnlyDictionary<string, string> palette)
    {
        if (!DocumentThemeTokens.Ready(palette)) return null;
        string? result = null;
        var panel = new StackPanel { Margin = new Thickness(24) };
        panel.Children.Add(Text("重命名画布", palette, true));
        var hint = Text("修改名称，保留 .excalidraw 文件格式。", palette); hint.Margin = new Thickness(0, 10, 0, 12); panel.Children.Add(hint);
        var input = new TextBox { Text = System.IO.Path.GetFileNameWithoutExtension(name), FontSize = 13, Padding = new Thickness(10, 8, 10, 8),
            Background = Brushes.Transparent, Foreground = Token(palette, "text"), BorderThickness = new Thickness(0) };
        System.Windows.Automation.AutomationProperties.SetName(input, "画布名称");
        panel.Children.Add(new Border { CornerRadius = new CornerRadius(7), BorderThickness = new Thickness(1), BorderBrush = Token(palette, "border"), Background = Token(palette, "raised"), Child = input });
        var error = Text("", palette); error.Foreground = Token(palette, "danger"); error.Margin = new Thickness(0, 8, 0, 12); panel.Children.Add(error);
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancel = Button("取消", palette); cancel.IsCancel = true; cancel.Margin = new Thickness(0, 0, 8, 0);
        var accept = Button("重命名", palette, primary: true); accept.IsDefault = true;
        row.Children.Add(cancel); row.Children.Add(accept); panel.Children.Add(row);
        var dialog = Window(owner, "重命名画布", panel, palette);
        cancel.Click += (_, _) => dialog.Close();
        accept.Click += (_, _) => {
            try { result = DocumentRenamePolicy.FileName(input.Text); dialog.Close(); }
            catch (System.IO.IOException invalid) { error.Text = invalid.Message; input.Focus(); }
        };
        dialog.ContentRendered += (_, _) => { input.Focus(); input.SelectAll(); };
        dialog.PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { dialog.Close(); e.Handled = true; } };
        dialog.ShowDialog(); return result;
    }
    internal static void Notify(Window owner, string title, string message, IReadOnlyDictionary<string,string> palette)
    {
        if (!DocumentThemeTokens.Ready(palette)) return;
        var previousFocus = Keyboard.FocusedElement;
        // Keep a busy notice above the current close decision, using that
        // document's palette. It never answers or dismisses the close decision.
        var modal = owner.OwnedWindows.Cast<Window>().LastOrDefault(window => window.IsVisible);
        if (modal is not null)
        {
            owner = modal;
            if (modal.Tag is IReadOnlyDictionary<string,string> modalPalette && DocumentThemeTokens.Ready(modalPalette)) palette=modalPalette;
        }
        var panel = new StackPanel { Margin = new Thickness(24) };panel.Children.Add(Text(title,palette,true));
        var text = Text(message,palette);text.Margin=new Thickness(0,12,0,20);panel.Children.Add(text);
        var ok = Button("知道了",palette,primary:true);ok.HorizontalAlignment=HorizontalAlignment.Right;ok.IsCancel=true;panel.Children.Add(ok);
        var dialog = Window(owner,title,panel,palette);ok.Click+=(_,_)=>dialog.Close();dialog.ContentRendered+=(_,_)=>ok.Focus();
        dialog.PreviewKeyDown+=(_,e)=>{if(e.Key==Key.Escape){dialog.Close();e.Handled=true;}};
        dialog.ShowDialog();
        if (owner.IsVisible && owner.IsEnabled)
        {
            owner.Activate();
            if (previousFocus is DependencyObject element && System.Windows.Window.GetWindow(element) == owner)
                Keyboard.Focus(previousFocus);
        }
    }
}
