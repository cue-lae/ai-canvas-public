$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\file-association.ps1')
$plan = @(Get-CanvasAssociationPlan 'C:\中文 空格\AiCanvas.WebViewHost.exe' 'C:\中文 空格\AI-Canvas-Document-A.ico')
if ($plan[-2].Written -ne '"C:\中文 空格\AiCanvas.WebViewHost.exe" "%1"') { throw 'Quoted launch command mismatch.' }
$absent = { param($hive, $key, $name) [pscustomobject]@{ KeyExisted = $false; ValueExisted = $false; Kind = $null; Value = $null } }
$snapshot = Get-CanvasAssociationSnapshot $plan $absent
if ($snapshot.Entries.Count -ne 4 -or $snapshot.Entries[0].Before.KeyExisted) { throw 'Missing original existence snapshot.' }
$checks = 2
foreach ($conflict in @('HKCU', 'HKLM', 'UserChoice')) {
    $reader = {
        param($hive, $key, $name)
        $exists = ($conflict -eq $hive -and $key -eq 'Software\Classes\.excalidraw') -or ($conflict -eq 'UserChoice' -and $key.EndsWith('UserChoice'))
        [pscustomobject]@{ KeyExisted = $true; ValueExisted = $exists; Kind = 1; Value = 'Other.App' }
    }.GetNewClosure()
    $rejected = $false
    try { $null = Get-CanvasAssociationSnapshot $plan $reader } catch { $rejected = $true }
    if (-not $rejected) { throw "Did not reject $conflict conflict." }
    $checks++
}
$restored = [Collections.Generic.List[string]]::new()
$restore = { param($entry) $restored.Add($entry.Key) }.GetNewClosure()
$reader = {
    param($hive, $key, $name)
    $entry = $snapshot.Entries | Where-Object Key -eq $key
    [pscustomobject]@{ KeyExisted = $true; ValueExisted = $true; Kind = 1; Value = $entry.Written }
}.GetNewClosure()
$null = Restore-CanvasAssociationSnapshot $snapshot $reader $restore
if ($restored.Count -ne 4) { throw 'Owned values were not restored.' }; $checks++
$restored.Clear()
$changed = { param($hive, $key, $name) [pscustomobject]@{ KeyExisted = $true; ValueExisted = $true; Kind = 1; Value = 'Changed.By.Other' } }
$null = Restore-CanvasAssociationSnapshot $snapshot $changed $restore
if ($restored.Count -ne 0) { throw 'Later registry changes were overwritten.' }; $checks++
"file-association.test.ps1: $checks checks passed; injected memory only, no registry writes."
