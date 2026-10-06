using System.IO;

namespace AiCanvas.WebViewHost;

internal static class HostPaths
{
    public static string ResolveDistRoot(string? configuredRoot, string baseDirectory)
    {
        if (InstalledPackagePolicy.Enabled)
            return Path.Combine(InstalledPackagePolicy.ResolveRoot(baseDirectory), "dist");
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(configuredRoot))
        {
            candidates.Add(Path.GetFullPath(configuredRoot));
        }

        var current = new DirectoryInfo(Path.GetFullPath(baseDirectory));
        for (var depth = 0; depth < 6 && current is not null; depth++, current = current.Parent)
        {
            candidates.Add(Path.Combine(current.FullName, "dist"));
        }

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException(
            "AI Canvas production build was not found. Set AI_CANVAS_DIST_ROOT to a directory containing index.html.");
    }
}
