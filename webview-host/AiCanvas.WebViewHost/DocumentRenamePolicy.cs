using System.IO;

namespace AiCanvas.WebViewHost;

internal static class DocumentRenamePolicy
{
    internal static string FileName(string input)
    {
        var name = input.Trim();
        if (name.EndsWith(".excalidraw", StringComparison.OrdinalIgnoreCase)) name = name[..^11];
        if (string.IsNullOrWhiteSpace(name)) throw new IOException("请输入画布名称。");
        if (name.EndsWith('.') || name.EndsWith(' ') || name.Any(c => c < 32 || "<>:\"/\\|?*".Contains(c)))
            throw new IOException("名称不能包含路径或这些字符：\\ / : * ? \" < > |，也不能以点或空格结尾。");
        var stem = name.Split('.')[0].ToUpperInvariant();
        if (stem is "CON" or "PRN" or "AUX" or "NUL" ||
            stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '1' and <= '9')
            throw new IOException("这个名称由系统保留，请换一个名称。");
        if (name.Length + 11 > 255) throw new IOException("名称过长，请缩短后重试。");
        return name + ".excalidraw";
    }

    internal static string RenameFile(string source, string fileName, Func<string, bool> available, Func<string, bool> canWrite)
    {
        source = DocumentPathIdentity.Canonical(source);
        var destination = DocumentPathIdentity.Canonical(Path.Combine(Path.GetDirectoryName(source)!, FileName(fileName)));
        if (source == destination) return source;
        if (!canWrite(source) || !canWrite(destination)) throw new IOException("此位置不在当前可修改的项目目录内。");
        if (!available(destination)) throw new IOException("该名称已被另一张打开的画布使用，原文件未改动。");
        if (!File.Exists(source)) throw new IOException("原文件已移动或不存在，尚未重命名。");
        for (var dir = Path.GetDirectoryName(source); !string.IsNullOrEmpty(dir); dir = Path.GetDirectoryName(dir))
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) throw new IOException("项目路径包含目录链接，尚未重命名。");
        if ((File.GetAttributes(source) & (FileAttributes.ReadOnly | FileAttributes.ReparsePoint)) != 0)
            throw new IOException("原文件只读或是链接，尚未重命名。");
        if (File.Exists(destination) && !source.Equals(destination, StringComparison.OrdinalIgnoreCase))
            throw new IOException("同一目录已存在这个名称，原文件未改动。");
        // The caller holds the document save gate. Same-directory rename does
        // not rewrite the last saved bytes or implicitly save current edits.
        File.Move(source, destination, overwrite: false);
        return destination;
    }
}
