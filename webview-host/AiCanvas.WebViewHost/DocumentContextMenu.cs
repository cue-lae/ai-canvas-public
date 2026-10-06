using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Input;
using System.Windows.Threading;

namespace AiCanvas.WebViewHost;

internal static class DocumentContextMenu
{
    internal static ContextMenu Create(FrameworkElement owner, IReadOnlyDictionary<string, string> palette,
        params (string Label, Action Invoke, bool Enabled)[] commands)
    {
        Brush Token(string key) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(palette[key]));
        var menu = new ContextMenu {
            PlacementTarget = owner, Placement = PlacementMode.MousePoint,
            Background = Token("surface"), BorderBrush = Token("border"), BorderThickness = new Thickness(1),
            Foreground = Token("text"), FontFamily = new FontFamily("Segoe UI"), FontSize = 13,
            Padding = new Thickness(4), MinWidth = 232, OverridesDefaultStyle = true, UseLayoutRounding = true };
        var panel = new FrameworkElementFactory(typeof(Border));
        panel.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
        panel.SetValue(Border.MinWidthProperty, 232d);
        panel.SetValue(Border.MarginProperty, new Thickness(8));
        panel.SetValue(Border.EffectProperty, new DropShadowEffect { BlurRadius = 16, ShadowDepth = 4, Opacity = .18 });
        foreach (var (property, name) in new[] { (Border.BackgroundProperty,"Background"), (Border.BorderBrushProperty,"BorderBrush"),
            (Border.BorderThicknessProperty,"BorderThickness"), (Border.PaddingProperty,"Padding") })
            panel.SetBinding(property, new Binding(name) { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        panel.AppendChild(new FrameworkElementFactory(typeof(ItemsPresenter)));
        menu.Template = new ControlTemplate(typeof(ContextMenu)) { VisualTree = panel };

        var row = new FrameworkElementFactory(typeof(Border));
        row.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
        row.SetBinding(Border.BackgroundProperty, new Binding("Background") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        var label = new FrameworkElementFactory(typeof(ContentPresenter));
        label.SetValue(ContentPresenter.ContentSourceProperty, "Header");
        label.SetValue(ContentPresenter.MarginProperty, new Thickness(12, 0, 12, 0));
        label.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        row.AppendChild(label);
        var style = new Style(typeof(MenuItem));
        style.Setters.Add(new Setter(Control.TemplateProperty, new ControlTemplate(typeof(MenuItem)) { VisualTree = row }));
        style.Setters.Add(new Setter(FrameworkElement.HeightProperty, 32d));
        style.Setters.Add(new Setter(Control.BackgroundProperty, Brushes.Transparent));
        style.Setters.Add(new Setter(Control.ForegroundProperty, Token("text")));
        style.Setters.Add(new Setter(FrameworkElement.FocusVisualStyleProperty, null));
        var highlighted = new Trigger { Property = MenuItem.IsHighlightedProperty, Value = true };
        highlighted.Setters.Add(new Setter(Control.BackgroundProperty, Token("accentSurface")));
        style.Triggers.Add(highlighted);
        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, .45)); style.Triggers.Add(disabled);
        foreach (var command in commands)
        {
            var item = new MenuItem { Header = command.Label, Style = style, IsEnabled = command.Enabled };
            item.Click += (_, e) => {
                menu.IsOpen = false;
                // Complete popup focus restoration before a command can open
                // the native file dialog or a document-close confirmation.
                owner.Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, command.Invoke);
                e.Handled = true;
            };
            menu.Items.Add(item);
        }
        menu.Opened += (_, _) => menu.Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() => {
            if (!menu.IsOpen) return;
            menu.Focus();
            if (menu.Items.OfType<MenuItem>().FirstOrDefault(item => item.IsEnabled) is { } first) Keyboard.Focus(first);
        }));
        menu.PreviewKeyDown += (_, e) => {
            if (e.Key == Key.Escape) { menu.IsOpen = false; e.Handled = true; }
        };
        return menu;
    }
}
