using System.Text;
using System.IO;

namespace AiCanvas.WebViewHost;

internal sealed class DocumentOpenRequest
{
    private bool _delivered;

    private DocumentOpenRequest(string path, string content)
    {
        RequestId = Guid.NewGuid().ToString("N");
        FileName = Path.GetFileName(path);
        FilePath = path;
        Content = content;
    }

    internal string RequestId { get; }
    internal string FileName { get; }
    internal string FilePath { get; }
    private string Content { get; }
    internal bool Delivered => _delivered;

    internal static bool TryCreate(
        IReadOnlyList<string> arguments,
        out DocumentOpenRequest? request,
        out string? error)
    {
        request = null;
        error = null;
        if (arguments.Count == 0) return true;
        if (arguments.Count != 1)
        {
            error = "一次只能打开一个 AI Canvas 项目文件。";
            return false;
        }

        var argument = arguments[0];
        if (string.IsNullOrWhiteSpace(argument) || argument.StartsWith('-') ||
            !Path.IsPathFullyQualified(argument) || argument.StartsWith("\\\\", StringComparison.Ordinal) ||
            argument.Length < 3 || argument[1] != ':' || argument[2] is not ('\\' or '/') || argument[2..].Contains(':'))
        {
            error = "请使用本地 .excalidraw 项目的完整文件路径。";
            return false;
        }

        string path;
        try { path = Path.GetFullPath(argument); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            error = "项目文件路径无效。";
            return false;
        }
        if (!Path.GetExtension(path).Equals(".excalidraw", StringComparison.OrdinalIgnoreCase))
        {
            error = "仅支持打开 .excalidraw 项目文件。";
            return false;
        }

        try
        {
            if (!File.Exists(path) || (File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
                new DriveInfo(Path.GetPathRoot(path)!).DriveType == DriveType.Network)
            {
                error = "项目文件不存在或不是普通文件。";
                return false;
            }
            request = new DocumentOpenRequest(path, File.ReadAllText(path, new UTF8Encoding(false, true)));
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            error = "无法读取项目文件。";
            return false;
        }
    }

    internal bool TryTakeDelivery(string requestId, out DocumentOpenDelivery? delivery)
    {
        delivery = null;
        if (_delivered || !string.Equals(RequestId, requestId, StringComparison.Ordinal)) return false;
        _delivered = true;
        delivery = new DocumentOpenDelivery(RequestId, FileName, Content);
        return true;
    }
}

internal sealed record DocumentOpenDelivery(string RequestId, string FileName, string Content);
