$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\installer-file-association.ps1')
$script:Checks = 0
function Assert($Value, [string]$Name) {
    if (-not $Value) { throw "FAIL $Name" }
    $script:Checks++; "PASS $Name"
}
function New-Model {
    $state = @{ Values = @{}; Owner = $null; Writes = [Collections.Generic.List[string]]::new()
        WriteCount = 0; OwnerCount = 0; FailWriteAt = 0; FailOwnerAt = 0; FailAfterWrite = $false }
    $reader = {
        param($hive, $key, $name)
        $id = $hive + '|' + $key + '|' + $name
        if ($state.Values.ContainsKey($id)) { return $state.Values[$id] }
        [pscustomobject]@{ KeyExisted = $false; Exists = $false; Kind = $null; Data = $null }
    }.GetNewClosure()
    $writer = {
        param($target, $value)
        $state.WriteCount++
        if ($state.WriteCount -eq $state.FailWriteAt -and -not $state.FailAfterWrite) { throw 'Injected Classes interruption before write.' }
        $id = 'HKCU|' + $target.Key + '|' + $target.Name
        $state.Writes.Add($target.Id)
        $state.Values[$id] = [pscustomobject]@{ KeyExisted = $true; Exists = [bool]$value.Exists; Kind = $value.Kind; Data = $value.Data }
        if ($state.WriteCount -eq $state.FailWriteAt -and $state.FailAfterWrite) { throw 'Injected Classes interruption after write.' }
    }.GetNewClosure()
    $readOwner = {
        [pscustomobject]@{ Exists = ($null -ne $state.Owner); Kind = 1; Data = $state.Owner }
    }.GetNewClosure()
    $writeOwner = {
        param($json)
        $state.OwnerCount++
        if ($state.OwnerCount -eq $state.FailOwnerAt -and -not $state.FailAfterWrite) { throw 'Injected owner interruption before write.' }
        $state.Owner = $json; $state.Writes.Add('owner')
        if ($state.OwnerCount -eq $state.FailOwnerAt -and $state.FailAfterWrite) { throw 'Injected owner interruption after write.' }
    }.GetNewClosure()
    [pscustomobject]@{ State = $state; Read = $reader; Write = $writer; ReadOwner = $readOwner; WriteOwner = $writeOwner }
}
function Run($Model, [string]$Operation = 'Register', [string]$Root = 'C:\Apps\AI Canvas', [string]$OldRoot = '') {
    Invoke-CanvasInstallerAssociation $Operation $Root $OldRoot $Model.Read $Model.Write $Model.ReadOwner $Model.WriteOwner
}
function Put($Model, [string]$Hive, [string]$Key, [string]$Name, $Data, [int]$Kind = 1) {
    $Model.State.Values[$Hive+'|'+$Key+'|'+$Name] = [pscustomobject]@{ KeyExisted = $true; Exists = $true; Kind = $Kind; Data = $Data }
}
function Read-Id($Model, [string]$Id, [string]$Root = 'C:\Apps\AI Canvas') {
    $target = Get-CanvasInstallAssociationTargets $Root | Where-Object Id -eq $Id
    & $Model.Read 'HKCU' $target.Key $target.Name
}

$m = New-Model
$result = Run $m
Assert ($result -match '^REGISTERED' -and (Read-Id $m 'default').Data -eq 'AI.Canvas.Document') 'fresh install claims only idle default'
Assert ((Read-Id $m 'command').Data -eq '"C:\Apps\AI Canvas\AiCanvas.WebViewHost.exe" "%1"') 'command quotes application and document paths'
Assert ((Read-Id $m 'openWith').Kind -eq -1) 'open-with uses REG_NONE'
Assert ($m.State.Writes[0] -eq 'owner') 'original values and ownership saved before Classes writes'
$m.State.Writes.Clear(); $null = Run $m
Assert ($m.State.Writes.Count -eq 0) 'same-root upgrade is a zero-write idempotent operation'
$null = Run $m 'Unregister'
Assert (-not (Read-Id $m 'command').Exists -and -not (Read-Id $m 'default').Exists -and $null -eq $m.State.Owner) 'uninstall restores absent values and releases ownership'
$m.State.Writes.Clear(); $null = Run $m 'Unregister'
Assert ($m.State.Writes.Count -eq 0) 'repeated uninstall performs no writes'
$null = Run $m
Assert ((Read-Id $m 'command').Exists) 'reinstall succeeds after value-only cleanup leaves empty keys'

foreach ($hive in @('HKCU','HKLM')) {
    $m = New-Model
    Put $m $hive 'Software\Classes\.excalidraw' '' 'Other.App'
    $result = Run $m
    Assert ($result -match 'third-party default preserved' -and (Read-Id $m 'command').Exists -and -not $m.State.Writes.Contains('default')) "$hive third-party default survives while Canvas open-with is registered"
    $null = Run $m 'Unregister'
    $value = & $m.Read $hive 'Software\Classes\.excalidraw' ''
    Assert ($value.Data -eq 'Other.App') "$hive foreign default survives uninstall"
}
$m = New-Model
Put $m 'HKCU' 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.excalidraw\UserChoice' 'ProgId' 'Other.App'
$null = Run $m
Assert ((Read-Id $m 'command').Exists -and -not $m.State.Writes.Contains('default')) 'UserChoice is preserved and suppresses default takeover'

foreach ($hive in @('HKCU', 'HKLM')) {
    $m = New-Model
    Put $m $hive 'Software\Classes\AI.Canvas.Document' '' 'AI Canvas Project'
    $result = Run $m
    Assert ($result -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) "$hive same-name ProgID without install ownership is not adopted"
}
$m = New-Model
$m.State.Values['HKCU|Software\Classes\AI.Canvas.Document|'] = [pscustomobject]@{
    KeyExisted = $true; Exists = $false; Occupied = $true; Kind = $null; Data = $null
}
Assert ((Run $m) -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'foreign ProgID subtree is a conflict even without a display name'
$m = New-Model
$m.State.Owner = '{"Schema":"unknown","Entries":[]}'
Assert ((Run $m) -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'unknown journal cannot authorize registry writes'

$m = New-Model; $null = Run $m
$m.State.Writes.Clear(); $result = Run $m 'Register' 'D:\New Apps\AI Canvas' 'C:\Apps\AI Canvas'
Assert ($result -match '^REGISTERED' -and (Read-Id $m 'command' 'D:\New Apps\AI Canvas').Data -eq '"D:\New Apps\AI Canvas\AiCanvas.WebViewHost.exe" "%1"') 'known previous installation can update its owned paths'
$journal = $m.State.Owner | ConvertFrom-Json
Assert (-not ($journal.Entries | Where-Object Id -eq 'command').Before.Exists) 'path update retains original pre-install value'
$m.State.Writes.Clear(); $result = Run $m 'Register' 'E:\Unknown\AI Canvas'
Assert ($result -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'unexplained root change cannot claim existing ownership'
$null = Run $m 'Unregister' 'D:\New Apps\AI Canvas'
Assert (-not (Read-Id $m 'command').Exists) 'uninstall at new owned root restores original absence'

$m = New-Model; $null = Run $m
$journal = $m.State.Owner | ConvertFrom-Json
$journal.Entries[0] | Add-Member -NotePropertyName Key -NotePropertyValue 'Software\Unrelated'
$m.State.Owner = $journal | ConvertTo-Json -Depth 8 -Compress
$null = Run $m 'Unregister'
Assert (-not $m.State.Values.ContainsKey('HKCU|Software\Unrelated|')) 'persisted path fields are ignored; only fixed targets can be touched'
$m = New-Model; $null = Run $m
$journal = $m.State.Owner | ConvertFrom-Json
$journal.Entries[0].Id = 'unrelated'
$m.State.Owner = $journal | ConvertTo-Json -Depth 8 -Compress
$m.State.Writes.Clear()
Assert ((Run $m 'Unregister') -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'unknown persisted target IDs reject the entire journal'

$m = New-Model; $null = Run $m
Put $m 'HKCU' 'Software\Classes\.excalidraw' '' 'Changed.By.User'
Put $m 'HKCU' 'Software\Classes\.excalidraw\OpenWithProgids' 'Other.App' @() -1
$null = Run $m; $null = Run $m 'Unregister'
Assert ((Read-Id $m 'default').Data -eq 'Changed.By.User') 'user changed default is never reclaimed or removed'
Assert ((& $m.Read 'HKCU' 'Software\Classes\.excalidraw\OpenWithProgids' 'Other.App').Exists) 'other open-with value survives unregister'
$m = New-Model; $null = Run $m
Put $m 'HKCU' 'Software\Classes\AI.Canvas.Document\shell\open\command' '' '"C:\Other.exe" "%1"'
$m.State.Writes.Clear(); $result = Run $m
Assert ($result -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'modified owned command blocks optional update without affecting installation'
$null = Run $m 'Unregister'
Assert ((Read-Id $m 'command').Data -eq '"C:\Other.exe" "%1"') 'uninstall preserves a later modified command'

$m = New-Model
Put $m 'HKCU' 'Software\Classes\.excalidraw' '' '' 2
$null = Run $m; $null = Run $m 'Unregister'
Assert ((Read-Id $m 'default').Exists -and (Read-Id $m 'default').Kind -eq 2 -and (Read-Id $m 'default').Data -ceq '') 'original empty expanded string is restored with its original registry type'

$ui = Get-Content -Raw (Join-Path $PSScriptRoot '..\installer-ui.iss')
foreach ($event in @('CurStepChanged','CurUninstallStepChanged','NextButtonClick')) {
    Assert (([regex]::Matches($ui, '(?m)^(procedure|function) '+$event+'\(')).Count -eq 1) "$event remains a single existing callback"
}
Assert ($ui.Contains("ApplyCanvasFileAssociation('Register')") -and $ui.Contains("ApplyCanvasFileAssociation('Unregister')") -and
    $ui.Contains("RunPluginAction") -and $ui.Contains("CheckInstallTarget")) 'new association hooks preserve old plugin and install gates'
$helper = Get-Content -Raw (Join-Path $PSScriptRoot '..\installer-file-association.iss')
Assert ($helper -notmatch '(?m)^(procedure|function) (CurStepChanged|CurUninstallStepChanged|NextButtonClick)\(') 'association include exposes helpers without duplicate lifecycle callbacks'

# Faults escape the implementation: no in-memory catch/compensation runs.
# Each recovery invocation rebuilds its ownership solely from persisted JSON.
foreach ($upgrade in @($false, $true)) {
    $positions = if ($upgrade) { @(1,2) } else { @(1,3,5) }
    foreach ($position in $positions) {
        foreach ($after in @($false, $true)) {
            foreach ($recovery in @('Register','Unregister')) {
                $m = New-Model
                if ($upgrade) { $null = Run $m }
                $root = if ($upgrade) { 'D:\New Apps\AI Canvas' } else { 'C:\Apps\AI Canvas' }
                $old = if ($upgrade) { 'C:\Apps\AI Canvas' } else { '' }
                $m.State.WriteCount = 0; $m.State.OwnerCount = 0
                $m.State.FailWriteAt = $position; $m.State.FailAfterWrite = $after
                $failed = $false
                try { $null = Run $m 'Register' $root $old } catch { $failed = $true }
                Assert $failed "Classes fault upgrade=$upgrade position=$position after=$after escaped without compensation"
                $pending = $m.State.Owner | ConvertFrom-Json
                Assert ($pending.Phase -eq 'pending' -and (Test-CanvasInstallerJournal $pending)) 'interruption leaves a valid durable old/new transition'
                $m.State.FailWriteAt = 0
                $null = Run $m $recovery $root $old
                if ($recovery -eq 'Register') {
                    Assert ((Read-Id $m 'command' $root).Data -eq ('"{0}\AiCanvas.WebViewHost.exe" "%1"' -f $root) -and
                        ($m.State.Owner | ConvertFrom-Json).Phase -eq 'complete') 'retry completes the destination and retires old ownership'
                    $null = Run $m 'Unregister' $root
                }
                Assert (@('label','icon','command','openWith','default' | Where-Object { (Read-Id $m $_ $root).Exists }).Count -eq 0 -and
                    $null -eq $m.State.Owner) 'unregister after interruption removes all known old/new writes'
            }
        }
    }
    foreach ($ownerPosition in @(1,2)) {
        foreach ($after in @($false,$true)) {
            foreach ($recovery in @('Register','Unregister')) {
                $m = New-Model
                if ($upgrade) { $null = Run $m }
                $root = if ($upgrade) { 'D:\New Apps\AI Canvas' } else { 'C:\Apps\AI Canvas' }
                $old = if ($upgrade) { 'C:\Apps\AI Canvas' } else { '' }
                $m.State.WriteCount = 0; $m.State.OwnerCount = 0
                $m.State.FailOwnerAt = $ownerPosition; $m.State.FailAfterWrite = $after
                $failed = $false
                try { $null = Run $m 'Register' $root $old } catch { $failed = $true }
                Assert $failed "owner fault upgrade=$upgrade position=$ownerPosition after=$after escaped"
                $m.State.FailOwnerAt = 0
                # Before the transition was persisted, the original installation
                # remains owner; otherwise both roots are recorded durably.
                $recoveryRoot = $root
                if ($recovery -eq 'Unregister' -and $upgrade -and $ownerPosition -eq 1 -and -not $after) { $recoveryRoot = $old }
                $null = Run $m $recovery $recoveryRoot $old
                if ($recovery -eq 'Register') {
                    Assert (($m.State.Owner | ConvertFrom-Json).Phase -eq 'complete') 'owner write fault is recoverable by a fresh registration call'
                    $null = Run $m 'Unregister' $root
                }
                Assert (-not (Read-Id $m 'command' $root).Exists -and -not (Read-Id $m 'icon' $root).Exists -and $null -eq $m.State.Owner) 'owner failure leaves no old-path orphan after owned uninstall'
            }
        }
    }
}
$m = New-Model; $null = Run $m
$m.State.WriteCount = 0; $m.State.FailWriteAt = 2
try { $null = Run $m 'Register' 'D:\New Apps\AI Canvas' 'C:\Apps\AI Canvas' } catch { }
Put $m 'HKCU' 'Software\Classes\AI.Canvas.Document\shell\open\command' '' '"C:\Foreign.exe" "%1"'
Put $m 'HKCU' 'Software\Classes\.excalidraw' '' 'Foreign.Default'
$m.State.FailWriteAt = 0; $m.State.Writes.Clear()
Assert ((Run $m 'Register' 'D:\New Apps\AI Canvas') -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'pending retry preserves a later foreign command instead of reclaiming it'
$null = Run $m 'Unregister' 'D:\New Apps\AI Canvas'
Assert ((Read-Id $m 'command').Data -eq '"C:\Foreign.exe" "%1"' -and (Read-Id $m 'default').Data -eq 'Foreign.Default') 'pending uninstall preserves later foreign command and default'
$m = New-Model; $null = Run $m
$m.State.WriteCount = 0; $m.State.FailWriteAt = 2
try { $null = Run $m 'Register' 'D:\New Apps\AI Canvas' 'C:\Apps\AI Canvas' } catch { }
$journal = $m.State.Owner | ConvertFrom-Json
$journal.Entries[2].PreviousWritten.Data = '"C:\Foreign.exe" "%1"'
$m.State.Owner = $journal | ConvertTo-Json -Compress -Depth 8
$m.State.FailWriteAt = 0; $m.State.Writes.Clear()
Assert ((Run $m 'Unregister' 'D:\New Apps\AI Canvas') -match '^SKIPPED' -and $m.State.Writes.Count -eq 0) 'arbitrary previous ownership data cannot authorize recovery'
"Installer association tests: $script:Checks checks passed; injected memory only, no registry or installed files touched."
