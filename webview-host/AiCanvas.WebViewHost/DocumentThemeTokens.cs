namespace AiCanvas.WebViewHost;

internal static class DocumentThemeTokens
{
    internal static bool Legal(string value) => value.Length == 7 && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit);
    internal static string Mix(string first, string second, double amount)
    {
        if (!Legal(first) || !Legal(second) || amount is < 0 or > 1) throw new ArgumentException("Invalid theme mix");
        return "#" + string.Concat(new[] { 1, 3, 5 }.Select(offset => ((int)Math.Round(
            Convert.ToInt32(first.Substring(offset, 2), 16) * amount + Convert.ToInt32(second.Substring(offset, 2), 16) * (1 - amount))).ToString("X2")));
    }
    internal static bool Ready(IReadOnlyDictionary<string, string> palette) => new[] {
        "surface", "raised", "border", "accent", "danger", "text", "mutedText", "accentSurface", "accentText", "canvas", "header", "icon"
    }.All(key => palette.TryGetValue(key, out var value) && Legal(value));
}
