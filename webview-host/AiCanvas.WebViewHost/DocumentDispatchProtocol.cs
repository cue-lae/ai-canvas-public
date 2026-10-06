using System.Text.Json;

namespace AiCanvas.WebViewHost;

internal sealed record DocumentDispatchRequest(int Version, string RunRoot, string Action, string? Path);
internal enum DocumentDispatchResult { Accepted, Rejected, RejectedWithNotice }
internal static class DocumentDispatchProtocol
{
    internal static string Reply(DocumentDispatchResult result) => result switch
    {
        DocumentDispatchResult.Accepted => "accepted",
        DocumentDispatchResult.RejectedWithNotice => "rejected-notified",
        _ => "rejected"
    };
    internal static DocumentDispatchResult ParseReply(string reply) => reply switch
    {
        "accepted" => DocumentDispatchResult.Accepted,
        "rejected-notified" => DocumentDispatchResult.RejectedWithNotice,
        _ => DocumentDispatchResult.Rejected
    };
    internal static DocumentDispatchRequest Parse(string json, string expectedRoot)
    {
        using var parsed = JsonDocument.Parse(json);
        var root = parsed.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Any(property => property.Name is not ("Version" or "RunRoot" or "Action" or "Path")))
            throw new InvalidOperationException("不支持的本机派发请求。");
        var value = JsonSerializer.Deserialize<DocumentDispatchRequest>(json) ?? throw new InvalidOperationException("派发请求为空。");
        if (value.Version != 1 || !string.Equals(value.RunRoot, expectedRoot, StringComparison.OrdinalIgnoreCase) || value.Action is not ("open" or "activate"))
            throw new InvalidOperationException("派发来源或操作不匹配。");
        if (value.Action == "open") return value with { Path = DocumentPathIdentity.Canonical(value.Path ?? "") };
        if (value.Path is not null) throw new InvalidOperationException("激活请求不能携带路径。");
        return value;
    }
}
