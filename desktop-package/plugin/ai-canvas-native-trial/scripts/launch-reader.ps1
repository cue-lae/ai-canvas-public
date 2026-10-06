$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

function Get-RegisteredCanvasRoots {
    $paths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $hive.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\{A824AB0C-29C1-4EF2-9117-EC098BF86169}_is1', $false)
            if ($null -eq $key) { continue }
            try {
                foreach ($name in @('InstallLocation', 'Inno Setup: App Path')) {
                    $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                    if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) { $paths.Add($value) }
                }
            } finally { $key.Dispose() }
        } finally { $hive.Dispose() }
    }
    return $paths.ToArray()
}

function Resolve-CanvasRoot([string[]]$Candidates) {
    $roots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in $Candidates) {
        if ($candidate -notmatch '^[A-Za-z]:[\\/]') { throw 'Registered Canvas path is not an absolute local path.' }
        $full = [IO.Path]::GetFullPath($candidate).TrimEnd('\', '/')
        if ($full.Length -le 3) { throw 'Registered Canvas path is not an application directory.' }
        [void]$roots.Add($full)
    }
    if ($roots.Count -ne 1) { throw 'Expected exactly one registered AI Canvas installation. No fallback was used.' }
    $root = @($roots)[0]
    foreach ($relative in @('', 'installed-package.json', 'AiCanvas.WebViewHost.exe', 'dist/index.html', 'runtime/node.exe', 'scripts/package-entry.mjs')) {
        $path = if ($relative) { Join-Path $root $relative } else { $root }
        if (-not (Test-Path -LiteralPath $path)) { throw 'The registered Canvas installation is incomplete.' }
        if ($relative -and -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'A required Canvas file is not a regular file.' }
        $current = [IO.Path]::GetFullPath($path)
        while ($current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked installation paths are not accepted.' }
            $parent = [IO.Path]::GetDirectoryName($current)
            if ($parent -eq $current) { break }
            $current = $parent
        }
    }
    $identityPath = Join-Path $root 'installed-package.json'
    if ((Get-Item -LiteralPath $identityPath).Length -gt 65536) { throw 'Canvas installation identity is invalid.' }
    $identity = [IO.File]::ReadAllText($identityPath) | ConvertFrom-Json
    if ($identity.id -cne 'ai-canvas-desktop-test' -or $identity.port -ne 43129) { throw 'Canvas package identity does not match the installed application.' }
    return $root
}

function Invoke-CanvasReader([string]$Root) {
    # Forward raw streams concurrently; explicitly close child input on parent EOF.
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
public static class CanvasTrialPipe {
    private static async Task Forward(Stream source, Stream destination) {
        var bytes = new byte[16384];
        int count;
        while ((count = await source.ReadAsync(bytes, 0, bytes.Length)) != 0) {
            await destination.WriteAsync(bytes, 0, count);
            await destination.FlushAsync();
        }
    }
    public static int Run(string root) {
        var start = new ProcessStartInfo(Path.Combine(root, "AiCanvas.WebViewHost.exe"), "--mcp") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        Console.Error.WriteLine("AI_CANVAS_NATIVE_TRIAL: starting registered installed reader: " + start.FileName);
        using (var child = Process.Start(start)) {
            var input = Task.Run(async () => {
                try { await Forward(Console.OpenStandardInput(), child.StandardInput.BaseStream); }
                catch (IOException) { }
                catch (ObjectDisposedException) { }
                finally { try { child.StandardInput.Close(); } catch (IOException) { } catch (ObjectDisposedException) { } }
            });
            var output = Forward(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
            var errors = Forward(child.StandardError.BaseStream, Console.OpenStandardError());
            child.WaitForExit();
            Task.WhenAll(output, errors).GetAwaiter().GetResult();
            return child.ExitCode;
        }
    }
}
'@
    return [CanvasTrialPipe]::Run($Root)
}

try {
    $root = Resolve-CanvasRoot -Candidates @(Get-RegisteredCanvasRoots)
    $result = Invoke-CanvasReader -Root $root
    exit $result
} catch {
    [Console]::Error.WriteLine('AI_CANVAS_NATIVE_TRIAL: ' + $_.Exception.Message)
    exit 1
}
