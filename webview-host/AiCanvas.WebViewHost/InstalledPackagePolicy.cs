using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace AiCanvas.WebViewHost;

internal static class InstalledPackagePolicy
{
#if CANVAS_INSTALLED_PACKAGE
    public static bool Enabled => true;
#else
    public static bool Enabled => false;
#endif
    public const int Port = 43129;
    public const string PackageId = "ai-canvas-desktop-test";
    public const string WindowMutex = "Local\\AI.Canvas.DesktopTest.Window";
    public static string DataRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI Canvas Test");
    public static string CapabilityFile => Path.Combine(DataRoot, "bridge", "capability.json");
    public static string ControlFile => Path.Combine(DataRoot, "bridge", "control.json");

    public static string ResolveRoot(string baseDirectory)
    {
        var root = Path.GetFullPath(baseDirectory);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "installed-package.json")));
        if (manifest.RootElement.GetProperty("id").GetString() != PackageId ||
            manifest.RootElement.GetProperty("port").GetInt32() != Port)
            throw new IOException("安装包身份不匹配，请重新安装配套版本。");
        foreach (var file in new[] { "dist/index.html", "runtime/node.exe", "scripts/package-entry.mjs" })
            if (!File.Exists(Path.Combine(root, file)))
                throw new FileNotFoundException("安装包组件缺失，请重新安装：" + file);
        return root;
    }

    public static void Configure(ProcessStartInfo start)
    {
        foreach (var key in start.Environment.Keys.ToArray())
            if (key.StartsWith("AI_CANVAS_", StringComparison.OrdinalIgnoreCase) ||
                key.Equals("NODE_OPTIONS", StringComparison.OrdinalIgnoreCase) ||
                key.Equals("NODE_PATH", StringComparison.OrdinalIgnoreCase)) start.Environment.Remove(key);
        start.Environment["AI_CANVAS_BRIDGE_PORT"] = Port.ToString();
        start.Environment["AI_CANVAS_BRIDGE_CAPABILITY_FILE"] = CapabilityFile;
        start.Environment["AI_CANVAS_BRIDGE_CONTROL_FILE"] = ControlFile;
        start.Environment["AI_CANVAS_ALLOWED_ORIGINS"] = "https://appassets.local";
    }

    public static bool OwnsSession(string sessionId, string? capabilityFile = null)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(capabilityFile ?? CapabilityFile));
            var capability = document.RootElement;
            return capability.GetProperty("version").GetInt32() == 1 &&
                capability.GetProperty("sessionId").GetString() == sessionId &&
                capability.GetProperty("baseUrl").GetString() == $"http://127.0.0.1:{Port}";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or KeyNotFoundException)
        { return false; }
    }
}
