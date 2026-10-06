using System.IO;
namespace AiCanvas.WebViewHost;
internal static class DocumentPathIdentity
{
    internal static string Canonical(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length < 3 || !char.IsLetter(value[0]) || value[1] != ':' ||
            value[2] is not ('\\' or '/') || value[2..].Contains(':')) throw new IOException("仅接受本地完整项目路径。");
        var path = Path.GetFullPath(value);
        if (!Path.GetExtension(path).Equals(".excalidraw", StringComparison.OrdinalIgnoreCase)) throw new IOException("仅支持 .excalidraw 项目。");
        return path;
    }
}
