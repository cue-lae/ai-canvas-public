param(
    [ValidateSet('Register', 'Rollback', 'Check')][string]$Mode = 'Check',
    [string]$ExecutablePath,
    [string]$IconPath,
    [string]$SnapshotPath
)

function Test-CanvasLocalFullPath {
    param([string]$Path)
    return ($Path -match '^[A-Za-z]:[\\/]' -and
        $Path -notmatch '[<>"|?*\x00-\x1f]' -and
        $Path.Substring(2) -notmatch ':')
}

function Get-CanvasAssociationPlan {
    param([string]$Executable, [string]$Icon)
    foreach ($path in @($Executable, $Icon)) {
        if ($path -notmatch '^[A-Za-z]:[\\/]' -or $path -match '["\r\n]' -or $path.StartsWith('\\')) {
            throw 'Use absolute local executable and icon paths.'
        }
    }
    @(
        [pscustomobject]@{ Key = 'Software\Classes\AI.Canvas.Document'; Name = ''; Written = ('AI Canvas ' + [char]0x9879 + [char]0x76ee) },
        [pscustomobject]@{ Key = 'Software\Classes\AI.Canvas.Document\DefaultIcon'; Name = ''; Written = ('"{0}",0' -f $Icon) },
        [pscustomobject]@{ Key = 'Software\Classes\AI.Canvas.Document\shell\open\command'; Name = ''; Written = ('"{0}" "%1"' -f $Executable) },
        [pscustomobject]@{ Key = 'Software\Classes\.excalidraw'; Name = ''; Written = 'AI.Canvas.Document' }
    )
}

function Get-CanvasRegistryValue {
    param([string]$Hive, [string]$Key, [string]$Name)
    $root = if ($Hive -eq 'HKCU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
    $handle = $root.OpenSubKey($Key, $false)
    try {
        $exists = $null -ne $handle -and @($handle.GetValueNames()).Contains($Name)
        [pscustomobject]@{
            KeyExisted = ($null -ne $handle)
            ValueExisted = $exists
            Kind = $(if ($exists) { [int]$handle.GetValueKind($Name) } else { $null })
            Value = $(if ($exists) { $handle.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
        }
    } finally { if ($null -ne $handle) { $handle.Dispose() } }
}

function Get-CanvasAssociationSnapshot {
    param([object[]]$Plan, [scriptblock]$Read = ${function:Get-CanvasRegistryValue})
    $entries = @()
    foreach ($entry in $Plan) {
        foreach ($hive in @('HKCU', 'HKLM')) {
            $before = & $Read $hive $entry.Key $entry.Name
            if ($before.ValueExisted) { throw "Association conflict: $hive\$($entry.Key). No registry writes performed." }
            if ($hive -eq 'HKCU') {
                $entries += [pscustomobject]@{ Key = $entry.Key; Name = $entry.Name; Before = $before; Written = $entry.Written; Kind = 1 }
            }
        }
    }
    $choice = & $Read 'HKCU' 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.excalidraw\UserChoice' 'ProgId'
    if ($choice.ValueExisted) { throw 'UserChoice conflict. No registry writes performed.' }
    [pscustomobject]@{ Schema = 'ai-canvas-file-association-v1'; Entries = $entries }
}

function Restore-CanvasAssociationSnapshot {
    param([object]$Snapshot, [scriptblock]$Read, [scriptblock]$Restore)
    if ($Snapshot.Schema -ne 'ai-canvas-file-association-v1' -or @($Snapshot.Entries).Count -ne 4) { throw 'Invalid association snapshot.' }
    $allowed = @(Get-CanvasAssociationPlan 'C:\candidate\AiCanvas.WebViewHost.exe' 'C:\candidate\AI-Canvas-Document-A.ico')
    $seen = @{}
    foreach ($entry in $Snapshot.Entries) {
        if ($entry.Name -ne '' -or $entry.Key -notin $allowed.Key -or $seen.ContainsKey($entry.Key) -or $entry.Kind -ne 1) { throw 'Unexpected snapshot registry target.' }
        $seen[$entry.Key] = $true
    }
    foreach ($entry in $Snapshot.Entries) {
        $current = & $Read 'HKCU' $entry.Key $entry.Name
        if ($current.ValueExisted -and $current.Kind -eq $entry.Kind -and $current.Value -ceq $entry.Written) {
            & $Restore $entry
            "RESTORED $($entry.Key)"
        } else {
            "PRESERVED_CHANGED $($entry.Key)"
        }
    }
}

function Set-CanvasRegistryEntry {
    param([object]$Entry)
    $current = Get-CanvasRegistryValue 'HKCU' $Entry.Key $Entry.Name
    if ($current.ValueExisted) { throw "Registry target changed after preflight: $($Entry.Key)" }
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Entry.Key)
    try { $key.SetValue($Entry.Name, $Entry.Written, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
}

function Send-CanvasAssociationChange {
    if (-not ('AiCanvas.FileAssociationShell' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AiCanvas {
    public static class FileAssociationShell {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    }
}
'@
    }
    [AiCanvas.FileAssociationShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Restore-CanvasRegistryEntry {
    param([object]$Entry)
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Entry.Key, $true)
    if ($null -eq $key) { return }
    try {
        if ($Entry.Before.ValueExisted) {
            $key.SetValue($Entry.Name, $Entry.Before.Value, [Microsoft.Win32.RegistryValueKind][int]$Entry.Before.Kind)
        } else {
            $key.DeleteValue($Entry.Name, $false)
        }
    } finally { $key.Dispose() }
    # Preserve all subtrees and any unrelated values.
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    if ($Mode -eq 'Rollback') {
        $snapshot = Get-Content -Raw -LiteralPath $SnapshotPath | ConvertFrom-Json
        Restore-CanvasAssociationSnapshot $snapshot ${function:Get-CanvasRegistryValue} ${function:Restore-CanvasRegistryEntry}
        Send-CanvasAssociationChange
    } else {
        foreach ($path in @($ExecutablePath, $IconPath)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Candidate executable/icon must be existing ordinary files.' }
        }
        $plan = @(Get-CanvasAssociationPlan ([IO.Path]::GetFullPath($ExecutablePath)) ([IO.Path]::GetFullPath($IconPath)))
        $snapshot = Get-CanvasAssociationSnapshot $plan
        if ($Mode -eq 'Check') { $snapshot | ConvertTo-Json -Depth 8; exit 0 }
        if (-not (Test-CanvasLocalFullPath $SnapshotPath) -or (Test-Path -LiteralPath $SnapshotPath)) { throw 'Supply a new absolute snapshot file path.' }
        $snapshotJson = $snapshot | ConvertTo-Json -Depth 8
        $stream = [IO.File]::Open($SnapshotPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = [Text.Encoding]::UTF8.GetBytes($snapshotJson); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose() }
        $null = Get-CanvasAssociationSnapshot $plan
        try { foreach ($entry in $snapshot.Entries) { Set-CanvasRegistryEntry $entry } }
        catch {
            Restore-CanvasAssociationSnapshot $snapshot ${function:Get-CanvasRegistryValue} ${function:Restore-CanvasRegistryEntry}
            Send-CanvasAssociationChange
            throw
        }
        Send-CanvasAssociationChange
        'REGISTERED AI.Canvas.Document; snapshot=' + $SnapshotPath
    }
}
