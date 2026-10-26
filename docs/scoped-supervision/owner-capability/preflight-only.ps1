# PREPARED ONLY: independent review and separate native-execution dispatch are required.
param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourcePath = Join-Path $PSScriptRoot 'WindowsJobOwner.cs'
$expectedSourceHash = 'b4e4fb25035b1c1313aae6afe5f9dbf905cb2fa631976249151c8b56e9370f4d'
$sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $sourceHash = [BitConverter]::ToString($hasher.ComputeHash($sourceBytes)).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
if ($sourceHash -ne $expectedSourceHash) { throw 'Preflight source differs from reviewed bytes' }
$sourceText = [System.Text.Encoding]::UTF8.GetString($sourceBytes)
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) { throw 'Preflight output already exists; no retry or overwrite' }
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$reservation = [System.IO.File]::Open((Join-Path $outputPath 'attempt.reserved'), [System.IO.FileMode]::CreateNew)
$reservation.Dispose()
. (Join-Path $PSScriptRoot 'preflight-receipt.ps1')
$receipt = Invoke-PreflightReceipt -Call {
    Add-Type -TypeDefinition $sourceText -Language CSharp -ErrorAction Stop
    [FirstMateJobCapability]::Preflight()
} -WriteReceipt {
    param($value)
    $json = $value | ConvertTo-Json -Depth 16 -ErrorAction Stop
    $stream = [System.IO.File]::Open((Join-Path $outputPath 'preflight.json'), [System.IO.FileMode]::CreateNew)
    try { $bytes = [System.Text.Encoding]::UTF8.GetBytes($json); $stream.Write($bytes, 0, $bytes.Length) }
    finally { $stream.Dispose() }
}
Write-Output ($receipt | ConvertTo-Json -Depth 16)
if (-not $receipt.available) { exit 2 }
