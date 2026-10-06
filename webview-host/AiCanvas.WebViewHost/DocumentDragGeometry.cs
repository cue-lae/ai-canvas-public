namespace AiCanvas.WebViewHost;

internal readonly record struct DocumentSize(double Width, double Height);
internal readonly record struct DocumentBounds(double Left, double Top, double Width, double Height);
internal static class DocumentDragGeometry
{
    internal static DocumentSize MergedSize(DocumentSize current, DocumentSize defaults, DocumentSize available, DocumentSize minimum) =>
        new(Math.Max(current.Width, Math.Min(defaults.Width, Math.Max(minimum.Width, available.Width))),
            Math.Max(current.Height, Math.Min(defaults.Height, Math.Max(minimum.Height, available.Height))));
    internal static DocumentSize DetachedSize(double normalWidth, double normalHeight, bool lightweight, bool mergeExpanded = false)
    {
        if (lightweight && mergeExpanded) return new(960, 600);
        if (lightweight) return new(Math.Max(normalWidth, 900), Math.Max(normalHeight, 600));
        return new(Math.Clamp(normalWidth * .75, 900, 1280), Math.Clamp(normalHeight * .75, 600, 800));
    }
    internal static DocumentBounds Place(double x, double y, double grabX, double grabY, DocumentSize size, DocumentBounds work, double scale)
    {
        if (!double.IsFinite(scale) || scale <= 0) throw new ArgumentOutOfRangeException(nameof(scale));
        var width = size.Width * scale; var height = size.Height * scale; var margin = 8 * scale;
        return new(Math.Clamp(x - grabX * scale, work.Left + margin, Math.Max(work.Left + margin, work.Left + work.Width - width - margin)),
            Math.Clamp(y - grabY * scale, work.Top + margin, Math.Max(work.Top + margin, work.Top + work.Height - height - margin)), width, height);
    }
    internal static int InsertSlot(double x, IReadOnlyList<(double Left, double Width)> tabs, int first)
    {
        for (var i = 0; i < tabs.Count; i++) if (x < tabs[i].Left + tabs[i].Width / 2) return first + i;
        return first + tabs.Count;
    }
    internal static int ReorderSlot(int oldIndex, int slot, int count) => Math.Clamp(slot > oldIndex ? slot - 1 : slot, 0, Math.Max(0, count - 1));
    internal static bool ShouldDetach(bool released, bool cancelled, bool received, bool sourceExists, int sourceCount) =>
        released && !cancelled && !received && sourceExists && sourceCount > 1;
    internal static string DropHint(IReadOnlyList<string> names, int slot, int sourceIndex)
    {
        var sameWindow = sourceIndex >= 0 && sourceIndex < names.Count;
        var index = sameWindow ? ReorderSlot(sourceIndex, slot, names.Count) : Math.Clamp(slot, 0, names.Count);
        if (sameWindow && index == sourceIndex) return "位置不变";
        var remaining = names.Where((_, position) => !sameWindow || position != sourceIndex).ToArray();
        var action = sameWindow ? "调整顺序" : "合并";
        if (remaining.Length == 0) return action + "到此窗口";
        return index < remaining.Length ? $"{action} · 放在「{remaining[index]}」之前" : $"{action} · 放在「{remaining[^1]}」之后";
    }
}
// Transient provenance only. Actual window bounds remain the geometry source.
internal sealed class DocumentMergeSizeState
{
    private DocumentSize? _expanded;
    private double _scale = 1;
    internal bool Remembered => _expanded is not null;
    internal void Remember(DocumentSize size, double scale = 1) { _expanded = size; _scale = scale; }
    internal bool Matches(DocumentSize current) => _expanded is { } size &&
        Math.Abs(size.Width - current.Width) <= 1 && Math.Abs(size.Height - current.Height) <= 1;
    internal void Observe(DocumentSize current, bool normal, double scale = 1)
    {
        if (!normal || _expanded is null) return;
        if (Math.Abs(scale - _scale) > .001) Remember(current, scale);
        else if (!Matches(current)) _expanded = null;
    }
}
internal sealed class DocumentDragLease(string documentId)
{
    internal string Id { get; } = Guid.NewGuid().ToString("N");
    internal bool Active { get; private set; } = true;
    internal bool Accept(string document, string drag) => Active && document == documentId && drag == Id;
    internal void End() => Active = false;
}
