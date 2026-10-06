namespace AiCanvas.WebViewHost;

internal sealed record DocumentSaveReceipt(string DocumentId, string RequestId, long Revision, string Status, string? FileName = null);

// Acknowledgement metadata only. Canvas, selection and undo history stay in
// the one living WebView belonging to this identity.
internal sealed class DocumentSessionState
{
    private readonly Dictionary<string, long> _pendingSaves = new(StringComparer.Ordinal);
    internal DocumentSessionState(string? filePath = null)
    {
        Id = Guid.NewGuid().ToString("N");
        FilePath = filePath;
        RecoveryId = filePath is null ? Id : StableRecoveryId(filePath);
    }
    internal string Id { get; }
    internal string RecoveryId { get; private set; }
    private static string StableRecoveryId(string path) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(path).ToUpperInvariant())))[..32].ToLowerInvariant();
    internal string? FilePath { get; private set; }
    private string _draftName = "未命名.excalidraw";
    internal string Name => FilePath is null ? _draftName : System.IO.Path.GetFileName(FilePath);
    internal void Renamed(string fileName, string? confirmedPath)
    {
        _draftName = fileName;
        if (confirmedPath is not null)
        {
            FilePath = confirmedPath;
            RecoveryId = StableRecoveryId(confirmedPath);
        }
        // Naming is file metadata, not an acknowledgement of unsaved content.
        Changed?.Invoke();
    }
    internal long Revision { get; private set; }
    internal long SavedRevision { get; private set; }
    internal bool Dirty { get; private set; }
    internal event Action? Changed;

    internal bool Observe(string documentId, long revision, bool dirty)
    {
        if (documentId != Id || revision < Revision || revision < 0) return false;
        if (revision == Revision && dirty == Dirty) return true;
        Revision = revision; Dirty = dirty;
        Changed?.Invoke();
        return true;
    }

    internal bool BeginSave(string requestId, long revision)
    {
        if (string.IsNullOrWhiteSpace(requestId) || revision < 0 || revision > Revision || _pendingSaves.ContainsKey(requestId)) return false;
        _pendingSaves.Add(requestId, revision);
        return true;
    }

    internal bool CompleteSave(DocumentSaveReceipt receipt, string? confirmedPath)
    {
        if (receipt.DocumentId != Id || !_pendingSaves.TryGetValue(receipt.RequestId, out var revision) || receipt.Revision != revision) return false;
        _pendingSaves.Remove(receipt.RequestId);
        if (receipt.Status != "saved" || confirmedPath is null) return false;
        if (revision >= SavedRevision)
        {
            SavedRevision = revision; FilePath = confirmedPath;
            RecoveryId = StableRecoveryId(confirmedPath);
            if (revision == Revision) Dirty = false;
            Changed?.Invoke();
        }
        return revision == Revision && !Dirty;
    }
}

internal sealed class DocumentClosePlan
{
    private readonly Dictionary<string, (long Revision, bool Discard)> _approved = new(StringComparer.Ordinal);
    internal void Approve(DocumentSessionState document, bool discard) => _approved[document.Id] = (document.Revision, discard);
    internal bool Ready(IEnumerable<DocumentSessionState> documents) => documents.All(document =>
        _approved.TryGetValue(document.Id, out var item) && item.Revision == document.Revision && (item.Discard || !document.Dirty));
}
