# Prepared ROOT-ONLY gate helper. Named dispatch file and separate reviewed execution required.
param([Parameter(Mandatory = $true)][string]$OutputDirectory, [Parameter(Mandatory = $true)][string]$NodePath, [Parameter(Mandatory = $true)][string]$Configuration)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$expectedOutput = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.local/owner-root-gate/root-gate-1'))
if ($outputPath -cne $expectedOutput) { throw 'Only the frozen root-gate reservation is permitted' }
if (-not (Test-Path -LiteralPath $outputPath -PathType Container) -or [System.IO.Path]::GetFullPath($Configuration) -ne (Join-Path $outputPath 'configuration.json')) { throw 'Fresh root-gate configuration required' }
$config = [System.IO.File]::ReadAllText($Configuration) | ConvertFrom-Json
if ($config.scenario -cne 'root-gate' -or $config.directory -cne $outputPath -or $config.nodePath -cne $NodePath -or $config.childEntry -cne (Join-Path $PSScriptRoot 'child.mjs')) { throw 'Only the fixed root-gate fixture is permitted' }
# A dispatch file is an ordinary local behavioral guard, not authenticated IPC.
$dispatchPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.local/owner-root-gate/root-gate-1.dispatch.json'))
if (-not (Test-Path -LiteralPath $dispatchPath -PathType Leaf)) { throw 'ROOT_GATE_DISPATCH_HOLD' }
$dispatch = [IO.File]::ReadAllText($dispatchPath) | ConvertFrom-Json
if ($dispatch.format -cne 'firstmate.root-gate-dispatch/1' -or $dispatch.scenario -cne 'root-gate' -or $dispatch.executeOneRootOnlyGate -ne $true -or $dispatch.caseId -cne $config.caseId -or $dispatch.nonce -cne $config.nonce) { throw 'Root-gate dispatch mismatch' }
$allowed = @('WindowsJobOwner.cs','WindowsRootGate.cs','root-gate-only.ps1','root-gate.mjs','root-gate-capture.mjs','phase-capture.mjs','capture.mjs','diagnostic-capture.mjs','child.mjs')
$actualNames = @($dispatch.sourcePins.PSObject.Properties.Name | Sort-Object) -join ','
$expectedNames = @($allowed | Sort-Object) -join ','
if ($actualNames -cne $expectedNames) { throw 'Root-gate source list mismatch' }
foreach ($name in $allowed) { if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $dispatch.sourcePins.$name) { throw 'Root-gate source pin mismatch' } }
if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'root-gate-controller.mjs') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $dispatch.controllerSha256) { throw 'Root-gate controller changed' }
$source = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'WindowsJobOwner.cs'))
$secondSource = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'WindowsRootGate.cs'))
$sha = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = [BitConverter]::ToString($sha.ComputeHash([byte[]]($source + [byte]0 + $secondSource))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
if ($sourceHash -cne $dispatch.nativeSourceSha256 -or $config.caseId -cne '49ab7fc0-aa4c-41b7-acae-bdb9d13489d7' -or $config.nonce -cne '1aff3330-6969-452c-b24f-f118b1158ed3' -or $config.rootEntry -cne (Join-Path $PSScriptRoot 'root-gate.mjs')) { throw 'Frozen root-gate identity/source mismatch' }
$reservation = [System.IO.File]::Open((Join-Path $outputPath 'native.reserved'), [System.IO.FileMode]::CreateNew)
$reservation.Dispose()
$nativeResult = $null; $invocationError = $null; $recordingError = $null
try {
    Add-Type -Path @((Join-Path $PSScriptRoot 'WindowsJobOwner.cs'), (Join-Path $PSScriptRoot 'WindowsRootGate.cs')) -ErrorAction Stop
    $nativeResult = [FirstMateJobCapability]::QualifyRootGate($NodePath, (Join-Path $PSScriptRoot 'root-gate.mjs'), $Configuration, $outputPath)
} catch {
    $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    $invocationError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
}
$receipt = [ordered]@{ format = 'firstmate.root-gate/1'; scenario = 'root-gate'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    nativeResult = $nativeResult; invocationError = $invocationError; recordingError = $null }
$descriptor = [ordered]@{ name = 'root-gate-helper.json'; bytes = $null; sha256 = $null; complete = $false }
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Compress -Depth 24 -ErrorAction Stop))
    if ($bytes.Length -gt 2097152) { throw 'Detailed receipt exceeds 2097152-byte file cap' }
    $descriptor.bytes = $bytes.Length
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $descriptor.sha256 = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    $file = [System.IO.File]::Open((Join-Path $outputPath 'root-gate-helper.json'), [System.IO.FileMode]::CreateNew)
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
$frame = [ordered]@{ format = 'firstmate.root-gate-final/1'; scenario = 'root-gate'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    file = $descriptor; invocationError = (FinalError $invocationError); recordingError = (FinalError $recordingError); originalFailure = $original }
$frameBytes = [System.Text.Encoding]::UTF8.GetBytes(($frame | ConvertTo-Json -Compress -Depth 8 -ErrorAction Stop) + "`n")
if ($frameBytes.Length -gt 32768) { throw 'Final frame exceeds 32768-byte cap' }
$stdout = [Console]::OpenStandardOutput()
try { $stdout.Write($frameBytes, 0, $frameBytes.Length); $stdout.Flush() } finally { $stdout.Dispose() }
if ($null -ne $invocationError -or $null -ne $recordingError -or $null -eq $nativeResult -or $null -ne $nativeResult['error']) { exit 2 }
