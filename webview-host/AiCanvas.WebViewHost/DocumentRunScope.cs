using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace AiCanvas.WebViewHost;

internal static class DocumentRunScope
{
#if CANVAS_MULTI_DOCUMENT_CANDIDATE
    internal static bool Isolated => true;
#else
    internal static bool Isolated => false;
#endif
    internal static string DataRoot => Isolated
        ? Path.Combine(AppContext.BaseDirectory, "candidate-data")
        : InstalledPackagePolicy.Enabled ? InstalledPackagePolicy.DataRoot
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI Canvas");
    // Keep the existing profile available, with document-scoped database keys.
    // The legacy current key remains readable only through an explicit request.
    internal static string Profile(string documentId) => Path.Combine(DataRoot, "WebView2");
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    internal static string Channel => "AI.Canvas.Documents." + (Isolated ? "Candidate." : "Product.") +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            Path.GetFullPath(AppContext.BaseDirectory).ToUpperInvariant() + "|" + WindowsIdentity.GetCurrent().User?.Value)))[..32];
    internal static bool CanWrite(string path)
    {
        if (!Isolated) return true;
        var candidate = new DirectoryInfo(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..")));
        if (!candidate.Name.StartsWith("candidate-", StringComparison.OrdinalIgnoreCase) || candidate.Parent is null) return false;
        var testRoot = candidate.Parent.FullName;
        return Path.GetFullPath(path).StartsWith(testRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }
}
