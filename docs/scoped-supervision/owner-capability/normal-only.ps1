# Prepared normal-only helper. Review and a separate one-normal execution dispatch are required.
param([Parameter(Mandatory = $true)][string]$OutputDirectory, [Parameter(Mandatory = $true)][string]$NodePath, [Parameter(Mandatory = $true)][string]$Configuration)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container) -or [System.IO.Path]::GetFullPath($Configuration) -ne (Join-Path $outputPath 'configuration.json')) { throw 'Fresh normal configuration required' }
$config = [System.IO.File]::ReadAllText($Configuration) | ConvertFrom-Json
if ($config.scenario -cne 'normal' -or $config.directory -cne $outputPath -or $config.nodePath -cne $NodePath -or $config.childEntry -cne (Join-Path $PSScriptRoot 'child.mjs')) { throw 'Only the fixed normal fixture is permitted' }
$source = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'WindowsJobOwner.cs'))
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $sourceHash = [BitConverter]::ToString($sha.ComputeHash($source)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
if ($sourceHash -ne '5bd7b5045b7c6b2bd7ecd5bd3b0491a7291b989459c73af8114ed7d4ac8d6e24') { throw 'Normal native source differs from reviewed bytes' }
if ($config.caseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or $config.nonce -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or $config.caseId -ceq $config.nonce) { throw 'Distinct fixed-length case identities required' }
$reservation = [System.IO.File]::Open((Join-Path $outputPath 'native.reserved'), [System.IO.FileMode]::CreateNew)
$reservation.Dispose()
$nativeResult = $null; $invocationError = $null; $recordingError = $null
try {
    Add-Type -TypeDefinition ([System.Text.Encoding]::UTF8.GetString($source)) -Language CSharp -ErrorAction Stop
    $nativeResult = [FirstMateJobCapability]::QualifyNormal($NodePath, (Join-Path $PSScriptRoot 'root.mjs'), $Configuration, $outputPath)
} catch {
    $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    $invocationError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
}
$receipt = [ordered]@{ format = 'firstmate.owner-normal/1'; scenario = 'normal'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    nativeResult = $nativeResult; invocationError = $invocationError; recordingError = $null }
$descriptor = [ordered]@{ name = 'normal-helper.json'; bytes = $null; sha256 = $null; complete = $false }
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Compress -Depth 24 -ErrorAction Stop))
    if ($bytes.Length -gt 2097152) { throw 'Detailed receipt exceeds 2097152-byte file cap' }
    $descriptor.bytes = $bytes.Length
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $descriptor.sha256 = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    $file = [System.IO.File]::Open((Join-Path $outputPath 'normal-helper.json'), [System.IO.FileMode]::CreateNew)
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
$frame = [ordered]@{ format = 'firstmate.owner-normal-final/1'; scenario = 'normal'; caseId = $config.caseId; nonce = $config.nonce; sourceSha256 = $sourceHash;
    file = $descriptor; invocationError = (FinalError $invocationError); recordingError = (FinalError $recordingError); originalFailure = $original }
$frameBytes = [System.Text.Encoding]::UTF8.GetBytes(($frame | ConvertTo-Json -Compress -Depth 8 -ErrorAction Stop) + "`n")
if ($frameBytes.Length -gt 32768) { throw 'Final frame exceeds 32768-byte cap' }
$stdout = [Console]::OpenStandardOutput()
try { $stdout.Write($frameBytes, 0, $frameBytes.Length); $stdout.Flush() } finally { $stdout.Dispose() }
if ($null -ne $invocationError -or $null -ne $recordingError -or $null -eq $nativeResult -or $null -ne $nativeResult['error']) { exit 2 }
