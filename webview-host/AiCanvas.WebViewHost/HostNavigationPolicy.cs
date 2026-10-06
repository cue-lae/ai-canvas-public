namespace AiCanvas.WebViewHost;

internal static class HostNavigationPolicy
{
    public const string AppHost = "appassets.local";

    public static bool IsAllowed(Uri? uri)
    {
        return uri is not null
            && uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && uri.Host.Equals(AppHost, StringComparison.OrdinalIgnoreCase);
    }
}
