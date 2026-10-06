param(
    [ValidateSet('Register', 'Unregister')][string]$Action = 'Register',
    [string]$AppRoot,
    [string]$PreviousRoot = '',
    [string]$ReportPath
)

# The installation journal is separate from the manual candidate snapshot.
# Targets are derived from this table, never from persisted registry paths.
$script:CanvasInstallerOwnerKey = 'Software\AI Canvas\FileDocument\Installer-v1'
$script:CanvasInstallerOwnerName = 'Ownership'
$script:CanvasInstallerId = '{A824AB0C-29C1-4EF2-9117-EC098BF86169}'

function ConvertTo-CanvasInstallRoot {
    param([string]$Root)
    if ($Root -notmatch '^[A-Za-z]:[\\/]' -or $Root -match '[<>"|?*\x00-\x1f]' -or $Root.Substring(2).Contains(':')) {
        throw 'Installation root must be a complete local path.'
    }
    $result = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if ($result.Length -le 3) { throw 'Installation root cannot be a drive root.' }
    $result
}

function Get-CanvasInstallAssociationTargets {
    param([string]$Root)
    $rootPath = ConvertTo-CanvasInstallRoot $Root
    @(
        [pscustomobject]@{ Id = 'label'; Key = 'Software\Classes\AI.Canvas.Document'; Name = ''; Kind = 1; Data = ('AI Canvas ' + [char]0x9879 + [char]0x76ee) },
        [pscustomobject]@{ Id = 'icon'; Key = 'Software\Classes\AI.Canvas.Document\DefaultIcon'; Name = ''; Kind = 1; Data = ('"{0}\Assets\AI-Canvas-Document-A.ico",0' -f $rootPath) },
        [pscustomobject]@{ Id = 'command'; Key = 'Software\Classes\AI.Canvas.Document\shell\open\command'; Name = ''; Kind = 1; Data = ('"{0}\AiCanvas.WebViewHost.exe" "%1"' -f $rootPath) },
        [pscustomobject]@{ Id = 'openWith'; Key = 'Software\Classes\.excalidraw\OpenWithProgids'; Name = 'AI.Canvas.Document'; Kind = -1; Data = @() },
        [pscustomobject]@{ Id = 'default'; Key = 'Software\Classes\.excalidraw'; Name = ''; Kind = 1; Data = 'AI.Canvas.Document' }
    )
}

function Test-CanvasAssociationValueEqual {
    param($Left, $Right)
    if ([bool]$Left.Exists -ne [bool]$Right.Exists) { return $false }
    if (-not $Left.Exists) { return $true }
    if ([int]$Left.Kind -ne [int]$Right.Kind) { return $false }
    return (($Left.Data | ConvertTo-Json -Compress -Depth 4) -ceq ($Right.Data | ConvertTo-Json -Compress -Depth 4))
}

function Test-CanvasInstallerJournal {
    param($Journal)
    if ($null -eq $Journal -or $Journal.Schema -cne 'ai-canvas-installer-association-v1' -or
        $Journal.Owner -cne $script:CanvasInstallerId -or $Journal.AppRoot -isnot [string] -or
        $Journal.Entries -isnot [array] -or $Journal.Entries.Count -gt 5) { return $false }
    try { $null = ConvertTo-CanvasInstallRoot $Journal.AppRoot } catch { return $false }
    if ($Journal.Phase -and $Journal.Phase -notin @('complete', 'pending')) { return $false }
    if ($Journal.Phase -eq 'pending') {
        try { $null = ConvertTo-CanvasInstallRoot $Journal.PreviousRoot } catch { return $false }
    }
    $targets = @(Get-CanvasInstallAssociationTargets $Journal.AppRoot)
    $seen = @{}
    foreach ($entry in $Journal.Entries) {
        $target = $targets | Where-Object Id -eq $entry.Id
        if ($null -eq $target -or $seen.ContainsKey([string]$entry.Id)) { return $false }
        $seen[[string]$entry.Id] = $true
        $written = [pscustomobject]@{ Exists = $true; Kind = $target.Kind; Data = $target.Data }
        if (-not (Test-CanvasAssociationValueEqual $entry.Written $written)) { return $false }
        if ($entry.Before.Exists -isnot [bool] -or $entry.Before.KeyExisted -isnot [bool]) { return $false }
        # Only an absent value or an originally empty default string can be owned.
        if ($entry.Before.Exists -and ($entry.Id -cne 'default' -or
            $entry.Before.Kind -notin @(1, 2) -or $entry.Before.Data -isnot [string] -or $entry.Before.Data -cne '')) { return $false }
        if ($Journal.Phase -eq 'pending') {
            $previousTarget = Get-CanvasInstallAssociationTargets $Journal.PreviousRoot | Where-Object Id -eq $entry.Id
            $previous = [pscustomobject]@{ Exists = $true; Kind = $previousTarget.Kind; Data = $previousTarget.Data }
            if ($entry.PreviousWritten.Exists -isnot [bool] -or
                (-not (Test-CanvasAssociationValueEqual $entry.PreviousWritten $previous) -and
                 -not (Test-CanvasAssociationValueEqual $entry.PreviousWritten $entry.Before))) { return $false }
        }
    }
    return $true
}

function Test-CanvasInstallerEntryOwned {
    param($Current, $Entry, $Journal)
    if (Test-CanvasAssociationValueEqual $Current $Entry.Written) { return $true }
    return ($Journal.Phase -eq 'pending' -and (Test-CanvasAssociationValueEqual $Current $Entry.PreviousWritten))
}

# Read/Write and owner callbacks are injectable for registry-free tests.
function Invoke-CanvasInstallerAssociation {
    param([string]$Operation, [string]$Root, [string]$OldRoot,
          [scriptblock]$Read, [scriptblock]$Write, [scriptblock]$ReadOwner, [scriptblock]$WriteOwner)
    $rootPath = ConvertTo-CanvasInstallRoot $Root
    $targets = @(Get-CanvasInstallAssociationTargets $rootPath)
    $ownerValue = & $ReadOwner
    $journal = $null
    if ($ownerValue.Exists) {
        try { $journal = $ownerValue.Data | ConvertFrom-Json } catch { }
        if ($ownerValue.Kind -ne 1 -or -not (Test-CanvasInstallerJournal $journal)) {
            return 'SKIPPED ownership record is missing or invalid; registry values preserved.'
        }
        $sameRoot = $journal.AppRoot -ieq $rootPath
        $pendingOldRoot = $journal.Phase -eq 'pending' -and $journal.PreviousRoot -ieq $rootPath
        $knownOldRoot = $OldRoot -and $journal.AppRoot -ieq (ConvertTo-CanvasInstallRoot $OldRoot)
        if ($journal.Phase -eq 'pending' -and $Operation -eq 'Register' -and -not $sameRoot) {
            return 'SKIPPED finish the persisted pending destination before another path change.'
        }
        if (-not $sameRoot -and -not ($Operation -eq 'Unregister' -and $pendingOldRoot) -and
            ($Operation -eq 'Unregister' -or -not $knownOldRoot)) {
            return 'SKIPPED association belongs to another installation root.'
        }
    }
    if ($Operation -eq 'Unregister') {
        if ($null -eq $journal) { return 'SKIPPED no installer-owned association.' }
        $messages = @()
        foreach ($entry in $journal.Entries) {
            $target = $targets | Where-Object Id -eq $entry.Id
            $current = & $Read 'HKCU' $target.Key $target.Name
            if (Test-CanvasInstallerEntryOwned $current $entry $journal) {
                & $Write $target $entry.Before
                $messages += "RESTORED $($entry.Id)"
            } else { $messages += "PRESERVED_CHANGED $($entry.Id)" }
        }
        # A journal changed by another actor is never deleted.
        if (Test-CanvasAssociationValueEqual (& $ReadOwner) $ownerValue) { & $WriteOwner $null }
        return ($messages -join '; ')
    }
    if ($Operation -ne 'Register') { throw 'Unsupported association operation.' }
    $owned = @{}
    if ($journal) { foreach ($entry in $journal.Entries) { $owned[$entry.Id] = $entry } }
    foreach ($target in $targets | Where-Object { $_.Id -in @('label', 'icon', 'command') }) {
        $current = & $Read 'HKCU' $target.Key $target.Name
        $machine = & $Read 'HKLM' $target.Key $target.Name
        if ($machine.Exists -or $machine.Occupied -or ($owned.ContainsKey($target.Id) -and -not (Test-CanvasInstallerEntryOwned $current $owned[$target.Id] $journal)) -or
            (-not $owned.ContainsKey($target.Id) -and ($current.Exists -or $current.Occupied))) {
            return 'SKIPPED dedicated Canvas ProgID is not owned or has changed.'
        }
    }
    $choice = & $Read 'HKCU' 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.excalidraw\UserChoice' 'ProgId'
    $userDefault = & $Read 'HKCU' 'Software\Classes\.excalidraw' ''
    $machineDefault = & $Read 'HKLM' 'Software\Classes\.excalidraw' ''
    $ownedDefaultMatches = $owned.ContainsKey('default') -and (Test-CanvasInstallerEntryOwned $userDefault $owned['default'] $journal)
    $thirdPartyDefault = ($choice.Exists -and $choice.Data -ne '') -or
        ($machineDefault.Exists -and $machineDefault.Data -ne '') -or
        ($userDefault.Exists -and $userDefault.Data -ne '' -and -not $ownedDefaultMatches)
    $changes = @()
    $entries = @()
    $transitionRoot = if ($journal -and $journal.Phase -eq 'pending') { $journal.PreviousRoot }
        elseif ($journal) { $journal.AppRoot } else { $rootPath }
    foreach ($target in $targets) {
        $current = & $Read 'HKCU' $target.Key $target.Name
        $entry = $owned[$target.Id]
        if ($target.Id -eq 'default' -and $thirdPartyDefault -and $null -eq $entry) { continue }
        if ($null -ne $entry -and -not (Test-CanvasInstallerEntryOwned $current $entry $journal)) {
            $prior = if ($journal.Phase -eq 'pending') { $entry.PreviousWritten } else { $entry.Written }
            $entries += [pscustomobject]@{ Id = $entry.Id; Before = $entry.Before; Written = $entry.Written; PreviousWritten = $prior }
            continue
        }
        if ($null -eq $entry -and $current.Exists -and
            -not ($target.Id -eq 'default' -and $current.Kind -in @(1, 2) -and $current.Data -ceq '')) { continue }
        $before = if ($entry) { $entry.Before } else { $current }
        $written = [pscustomobject]@{ Exists = $true; Kind = $target.Kind; Data = $target.Data }
        $prior = if ($entry -and $journal.Phase -eq 'pending') { $entry.PreviousWritten }
            elseif ($entry) { $entry.Written } else { $current }
        $entries += [pscustomobject]@{ Id = $target.Id; Before = $before; Written = $written; PreviousWritten = $prior }
        if (-not (Test-CanvasAssociationValueEqual $current $written)) {
            $changes += [pscustomobject]@{ Target = $target; Before = $current; After = $written }
        }
    }
    $nextJournal = [pscustomobject]@{
        Schema = 'ai-canvas-installer-association-v1'; Owner = $script:CanvasInstallerId
        Phase = 'pending'; AppRoot = $rootPath; PreviousRoot = $transitionRoot; Entries = @($entries)
    }
    $completeJournal = [pscustomobject]@{
        Schema = 'ai-canvas-installer-association-v1'; Owner = $script:CanvasInstallerId
        Phase = 'complete'; AppRoot = $rootPath; Entries = @($entries | ForEach-Object {
            [pscustomobject]@{ Id = $_.Id; Before = $_.Before; Written = $_.Written }
        })
    }
    if (-not (Test-CanvasInstallerJournal $nextJournal)) { throw 'Unsafe journal plan.' }
    if (-not (Test-CanvasAssociationValueEqual (& $ReadOwner) $ownerValue)) { throw 'Association journal changed during preflight.' }
    foreach ($change in $changes) {
        if (-not (Test-CanvasAssociationValueEqual (& $Read 'HKCU' $change.Target.Key $change.Target.Name) $change.Before)) { throw 'Association target changed during preflight.' }
    }
    # Durable transition retains both validated old/new writes. Recovery does
    # not depend on catch/finally running after a process interruption.
    $nextOwnerData = $nextJournal | ConvertTo-Json -Compress -Depth 8
    $completeOwnerData = $completeJournal | ConvertTo-Json -Compress -Depth 8
    if ($changes.Count -eq 0 -and $ownerValue.Exists -and $ownerValue.Data -ceq $completeOwnerData) {
        return 'REGISTERED installer-owned Canvas association unchanged.'
    }
    if (-not $ownerValue.Exists -or $ownerValue.Data -cne $nextOwnerData) { & $WriteOwner $nextOwnerData }
    foreach ($change in $changes) {
        if (-not (Test-CanvasAssociationValueEqual (& $Read 'HKCU' $change.Target.Key $change.Target.Name) $change.Before)) {
            throw 'Association target changed before its write; remaining values preserved.'
        }
        & $Write $change.Target $change.After
    }
    $persisted = & $ReadOwner
    if (-not $persisted.Exists -or $persisted.Kind -ne 1 -or $persisted.Data -cne $nextOwnerData) { throw 'Transition ownership changed; journal preserved.' }
    & $WriteOwner $completeOwnerData
    if ($thirdPartyDefault) { 'REGISTERED open-with; third-party default preserved.' }
    else { 'REGISTERED installer-owned Canvas association.' }
}

function Test-CanvasInstallerKeyContents {
    param([Microsoft.Win32.RegistryKey]$Key)
    if ($Key.ValueCount -gt 0) { return $true }
    foreach ($name in $Key.GetSubKeyNames()) {
        $child = $Key.OpenSubKey($name, $false)
        try { if ($child -and (Test-CanvasInstallerKeyContents $child)) { return $true } }
        finally { if ($child) { $child.Dispose() } }
    }
    return $false
}

function Read-CanvasInstallerRegistry {
    param([string]$Hive, [string]$Key, [string]$Name)
    $root = if ($Hive -eq 'HKCU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
    $handle = $root.OpenSubKey($Key, $false)
    try {
        $exists = $null -ne $handle -and @($handle.GetValueNames()).Contains($Name)
        [pscustomobject]@{ KeyExisted = ($null -ne $handle); Exists = $exists
            Occupied = $(if ($handle -and $Key -eq 'Software\Classes\AI.Canvas.Document') { Test-CanvasInstallerKeyContents $handle } else { $exists })
            Kind = $(if ($exists) { [int]$handle.GetValueKind($Name) } else { $null })
            Data = $(if ($exists) { $handle.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }) }
    } finally { if ($handle) { $handle.Dispose() } }
}

function Write-CanvasInstallerRegistry {
    param($Target, $State)
    $handle = if ($State.Exists) { [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Target.Key) }
              else { [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Target.Key, $true) }
    if ($null -eq $handle) { return }
    try {
        if (-not $State.Exists) { $handle.DeleteValue($Target.Name, $false) }
        elseif ($State.Kind -eq -1) { $handle.SetValue($Target.Name, [byte[]]@($State.Data), [Microsoft.Win32.RegistryValueKind]::None) }
        else { $handle.SetValue($Target.Name, $State.Data, [Microsoft.Win32.RegistryValueKind][int]$State.Kind) }
    } finally { $handle.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        $rootPath = ConvertTo-CanvasInstallRoot $AppRoot
        foreach ($name in @('installed-package.json', 'AiCanvas.WebViewHost.exe', 'Assets\AI-Canvas-Document-A.ico')) {
            $file = Join-Path $rootPath $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation identity/components unavailable.' }
        }
        $identity = Get-Content -Raw -LiteralPath (Join-Path $rootPath 'installed-package.json') | ConvertFrom-Json
        if ($identity.id -cne 'ai-canvas-desktop-test' -or $identity.port -ne 43129) { throw 'Installation identity mismatch.' }
        $reader = ${function:Read-CanvasInstallerRegistry}
        $writer = ${function:Write-CanvasInstallerRegistry}
        $readOwner = { Read-CanvasInstallerRegistry 'HKCU' $script:CanvasInstallerOwnerKey $script:CanvasInstallerOwnerName }
        $writeOwner = {
            param($json)
            $target = [pscustomobject]@{ Key = $script:CanvasInstallerOwnerKey; Name = $script:CanvasInstallerOwnerName }
            Write-CanvasInstallerRegistry $target ([pscustomobject]@{ Exists = ($null -ne $json); Kind = 1; Data = $json })
        }
        $result = Invoke-CanvasInstallerAssociation $Action $rootPath $PreviousRoot $reader $writer $readOwner $writeOwner
        if ($ReportPath) { [IO.File]::WriteAllText($ReportPath, $result, [Text.Encoding]::UTF8) }
        $result
        exit 0
    } catch {
        if ($ReportPath) { [IO.File]::WriteAllText($ReportPath, 'SKIPPED ' + $_.Exception.Message, [Text.Encoding]::UTF8) }
        Write-Error $_
        exit 1
    }
}
