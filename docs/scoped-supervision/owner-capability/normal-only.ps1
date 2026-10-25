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
if ($sourceHash -ne '6d8042a92ef0b2800cff498fa3964d9f04b80b670fa70f4910ced1f2863ff2ef') { throw 'Normal native source differs from reviewed bytes' }
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
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Depth 24 -ErrorAction Stop))
    $file = [System.IO.File]::Open((Join-Path $outputPath 'normal-helper.json'), [System.IO.FileMode]::CreateNew)
    try { $file.Write($bytes, 0, $bytes.Length) } finally { $file.Dispose() }
} catch {
    $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
    $recordingError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
    $receipt.recordingError = $recordingError
}
Write-Output ($receipt | ConvertTo-Json -Depth 24)
if ($null -ne $invocationError -or $null -ne $recordingError -or $null -eq $nativeResult -or $null -ne $nativeResult['error']) { exit 2 }
