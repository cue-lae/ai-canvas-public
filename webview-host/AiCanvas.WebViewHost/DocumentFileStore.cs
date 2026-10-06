using System.IO;
using System.Text;
using Microsoft.Win32;

namespace AiCanvas.WebViewHost;

internal static class DocumentFileStore
{
    internal static string CanonicalPath(string value)
    {
        return DocumentPathIdentity.Canonical(value);
    }

    internal static async Task<string?> SaveAsync(DocumentSessionState state, string content, System.Windows.Window owner,
        Func<string, bool> available, bool saveAs = false)
    {
        var path = saveAs ? null : state.FilePath;
        if (path is null)
        {
            var dialog = new SaveFileDialog { Title = (saveAs ? "另存 " : "保存 ") + state.Name, FileName = state.Name,
                Filter = "AI Canvas 项目|*.excalidraw", DefaultExt = ".excalidraw", AddExtension = true,
                InitialDirectory = DocumentRunScope.Isolated ? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..")) : null };
            if (dialog.ShowDialog(owner) != true) return null;
            path = dialog.FileName;
        }
        path = CanonicalPath(path);
        if (!DocumentRunScope.CanWrite(path)) throw new IOException("隔离候选仅允许保存到本轮测试目录；原样本与用户文件未改。");
        if (!available(path)) throw new IOException("保存位置已由另一份打开文档占用；未覆盖。");
        var directory = Path.GetDirectoryName(path)!;
        if (!Directory.Exists(directory)) throw new IOException("保存目录不存在。");
        for (var entry = directory; !string.IsNullOrEmpty(entry); entry = Path.GetDirectoryName(entry))
            if ((File.GetAttributes(entry) & FileAttributes.ReparsePoint) != 0) throw new IOException("保存路径包含目录链接，未覆盖。");
        if (File.Exists(path) && (File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.ReadOnly)) != 0)
            throw new IOException("文件只读或是链接，未覆盖。");
        var temporary = Path.Combine(directory, ".ai-canvas-save-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous))
            {
                await stream.WriteAsync(new UTF8Encoding(false).GetBytes(content));
                await stream.FlushAsync(); stream.Flush(true);
            }
            if (!available(path)) throw new IOException("另一份文档已占用保存位置，未覆盖。");
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
            return path;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
