# Fixed new mailbox case. Native units and phase start remain unchanged; execution separately held.
param([Parameter(Mandatory = $true)][string]$OutputDirectory,[Parameter(Mandatory = $true)][string]$NodePath,[Parameter(Mandatory = $true)][string]$Configuration)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$outputPath=[IO.Path]::GetFullPath($OutputDirectory)
$expected=[IO.Path]::GetFullPath((Join-Path $repo '.local/s02-product-qualification/mailbox-actual-1'))
if($outputPath -cne $expected -or [IO.Path]::GetFullPath($Configuration) -cne (Join-Path $outputPath 'configuration.json')){throw 'Only the fixed mailbox case is supported'}
$config=[IO.File]::ReadAllText($Configuration)|ConvertFrom-Json
if($config.format -cne 'firstmate.s02-mailbox-runtime/1' -or $config.caseId -cne 'b807adc9-87fb-46a2-8c1a-c88208531ec3' -or $config.nonce -cne '4ddd694a-f73f-4f03-8b02-2fb839eedde5' -or $config.scenario -cne 'normal' -or $config.directory -cne $outputPath -or $config.nodePath -cne $NodePath -or $config.nodeVersion -cne 'v24.18.0' -or $config.rootEntry -cne (Join-Path $PSScriptRoot 'root.mjs') -or $config.childEntry -cne (Join-Path $PSScriptRoot 'child.mjs')){throw 'Fixed mailbox runtime identity mismatch'}
$dispatchPath=$expected+'.dispatch.json'
if(-not (Test-Path -LiteralPath $dispatchPath -PathType Leaf)){throw 'S02_MAILBOX_DISPATCH_HOLD'}
$dispatch=[IO.File]::ReadAllText($dispatchPath)|ConvertFrom-Json
$names=@($dispatch.PSObject.Properties.Name|Sort-Object)-join ','
if($names -cne 'caseId,controllerSha256,executeOneMailbox,format,nonce,pinsSha256' -or $dispatch.format -cne 'firstmate.s02-mailbox-dispatch/1' -or $dispatch.executeOneMailbox -ne $true -or $dispatch.caseId -cne $config.caseId -or $dispatch.nonce -cne $config.nonce -or $dispatch.controllerSha256 -cne $config.controllerSha256 -or $dispatch.pinsSha256 -cne $config.pinsSha256){throw 'Mailbox dispatch mismatch'}
function Hash([string]$path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
$pinsPath=Join-Path $PSScriptRoot 'source-pins.json'
if((Hash $pinsPath) -cne $dispatch.pinsSha256 -or (Hash (Join-Path $PSScriptRoot 'controller.mjs')) -cne $dispatch.controllerSha256){throw 'Mailbox controller/source manifest changed'}
$controllerText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'controller.mjs'))
$declared=[Text.RegularExpressions.Regex]::Match($controllerText,"const PINS_SHA='([a-f0-9]{64})'")
if(-not $declared.Success -or $declared.Groups[1].Value -cne $dispatch.pinsSha256 -or $NodePath -cne 'C:\Program Files\nodejs\node.exe' -or $config.repositoryRoot -cne $repo){throw 'Fixed controller manifest/image/repository mismatch'}
$pins=[IO.File]::ReadAllText($pinsPath)|ConvertFrom-Json
if($pins.format -cne 'firstmate.s02-mailbox-sources/1' -or $pins.baseHead -cne 'aa8db567714b38542ee6ef18a2f9f31e8cbcc5b0'){throw 'Mailbox source schema mismatch'}
foreach($pin in $pins.files.PSObject.Properties){$path=[IO.Path]::GetFullPath((Join-Path $repo $pin.Name));if(-not $path.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Hash $path) -cne $pin.Value){throw 'Mailbox source pin/containment mismatch'}}
if((Hash $NodePath) -cne '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de' -or (Hash 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe') -cne '60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f'){throw 'Mailbox executable image mismatch'}
if((Hash (Join-Path $outputPath 'selection.json')) -cne $config.selectionSha256){throw 'Mailbox selected source changed'}
$ownerSource=Join-Path $repo 'docs/scoped-supervision/owner-capability'
$source=[IO.File]::ReadAllBytes((Join-Path $ownerSource 'WindowsJobOwner.cs'))
$secondSource=[IO.File]::ReadAllBytes((Join-Path $ownerSource 'WindowsRootGate.cs'))
$thirdSource=[IO.File]::ReadAllBytes((Join-Path $ownerSource 'WindowsMemberNormal.cs'))
$sha=[Security.Cryptography.SHA256]::Create()
try{$sourceHash=[BitConverter]::ToString($sha.ComputeHash([byte[]]($source+[byte]0+$secondSource+[byte]0+$thirdSource))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
if($sourceHash -cne 'a61098b3bb597af66232592bf0e2e2caa1db25c0a42f5aee66529e8983ce339b' -or $pins.nativeSourceSha256 -cne $sourceHash){throw 'Native capture source changed'}
$reservation=[IO.File]::Open((Join-Path $outputPath 'native.reserved'),[IO.FileMode]::CreateNew)
$reservation.Dispose()
$nativeResult = $null; $invocationError = $null; $recordingError = $null
try {
    Add-Type -Path @((Join-Path $ownerSource 'WindowsJobOwner.cs'), (Join-Path $ownerSource 'WindowsRootGate.cs'), (Join-Path $ownerSource 'WindowsMemberNormal.cs')) -ReferencedAssemblies @('System.dll','System.Core.dll','System.Web.Extensions.dll') -ErrorAction Stop
    $nativeResult = [FirstMateJobCapability]::QualifyMemberNormalV4($NodePath, (Join-Path $PSScriptRoot 'root.mjs'), $Configuration, $outputPath, $config.caseId, $config.nonce, $config.nodeVersion)
} catch {
    $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    $invocationError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
}
$receipt = [ordered]@{ format = 'firstmate.member-normal/1'; scenario = 'normal'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    nativeResult = $nativeResult; invocationError = $invocationError; recordingError = $null }
$descriptor = [ordered]@{ name = 'member-normal-helper.json'; bytes = $null; sha256 = $null; complete = $false }
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Compress -Depth 24 -ErrorAction Stop))
    if ($bytes.Length -gt 2097152) { throw 'Detailed receipt exceeds 2097152-byte file cap' }
    $descriptor.bytes = $bytes.Length
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $descriptor.sha256 = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    $file = [System.IO.File]::Open((Join-Path $outputPath 'member-normal-helper.json'), [System.IO.FileMode]::CreateNew)
    try { $file.Write($bytes, 0, $bytes.Length) } finally { $file.Dispose() }
    $descriptor.complete = $true # only after successful file disposal
} catch {
    $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    $recordingError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
    $receipt.recordingError = $recordingError
}
function FinalError($errorValue) {
    if ($null -eq $errorValue) { return $null }
    $message = [string]$errorValue.message
    return @{ message = $message.Substring(0, [Math]::Min(256, $message.Length)); truncated = $errorValue.truncated -or $message.Length -gt 256 }
}
$original = @{ state = 'unavailable'; value = $null; truncated = $null }
if ($null -ne $nativeResult) {
    $original.value = $nativeResult['originalFailure']; $original.truncated = $nativeResult['originalFailureTruncated']
    $original.state = if ($null -eq $original.value) { 'none-recorded' } else { 'recorded' }
    if ($null -ne $original.value -and ([string]$original.value).Length -gt 4096) { $original.value = ([string]$original.value).Substring(0, 4096); $original.truncated = $true }
}
$frame = [ordered]@{ format = 'firstmate.member-normal-final/1'; scenario = 'normal'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    file = $descriptor; invocationError = (FinalError $invocationError); recordingError = (FinalError $recordingError); originalFailure = $original }
$frameBytes = [System.Text.Encoding]::UTF8.GetBytes(($frame | ConvertTo-Json -Compress -Depth 8 -ErrorAction Stop) + "`n")
if ($frameBytes.Length -gt 32768) { throw 'Final frame exceeds 32768-byte cap' }
$stdout = [Console]::OpenStandardOutput()
try { $stdout.Write($frameBytes, 0, $frameBytes.Length); $stdout.Flush() } finally { $stdout.Dispose() }
if ($null -ne $invocationError -or $null -ne $recordingError -or $null -eq $nativeResult -or $null -ne $nativeResult['error']) { exit 2 }
