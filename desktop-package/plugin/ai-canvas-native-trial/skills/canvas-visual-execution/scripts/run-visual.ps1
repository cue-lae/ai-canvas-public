param([Parameter(Mandatory=$true)][ValidateSet('mask','info','composite','tint','material')][string]$Action,[Parameter(ValueFromRemainingArguments=$true)][string[]]$ToolArgs)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'locate-canvas.ps1')
$root=Resolve-CanvasRoot -Candidates @(Get-RegisteredCanvasRoots)
if($Action -eq 'mask') { & (Join-Path $root 'runtime/node.exe') (Join-Path $PSScriptRoot 'make-mask.mjs') @ToolArgs }
else { & (Join-Path $root 'AiCanvas.ImageTools.exe') $Action @ToolArgs }
exit $LASTEXITCODE
