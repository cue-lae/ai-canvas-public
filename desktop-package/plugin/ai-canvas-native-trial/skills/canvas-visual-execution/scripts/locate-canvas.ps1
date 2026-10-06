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

