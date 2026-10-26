param([ValidateSet('preflight', 'normal', 'blocked')][string]$Mode = 'preflight', [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$NodePath, [string]$Configuration)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
throw 'OWNER_CAPTURE_REVIEW_HOLD: no compilation/helper/native execution; previous closure remains unresolved'
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$env:TEMP = $outputPath
$env:TMP = $outputPath
$nativeInvoked = $false
$result = $null
try {
    $source = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'WindowsJobOwner.cs'))
    Add-Type -TypeDefinition $source -Language CSharp
    if ($Mode -eq 'preflight') { $result = [FirstMateJobCapability]::Preflight() }
    else { $nativeInvoked = $true; $result = [FirstMateJobCapability]::Run($NodePath, (Join-Path $PSScriptRoot 'root.mjs'), $Configuration, $outputPath, $Mode) }
    $json = $result | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText((Join-Path $outputPath 'native-receipt.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output $json
    if (($Mode -eq 'preflight' -and -not $result.available) -or ($Mode -ne 'preflight' -and $null -ne $result.error)) { exit 2 }
} catch {
    $recordingFailure = $_.Exception.ToString()
    $recordingFailureTruncated = $recordingFailure.Length -gt 4096
    if ($recordingFailureTruncated) { $recordingFailure = $recordingFailure.Substring(0, 4096) }
    $targetCreated = if ($nativeInvoked) { $null } else { $false }
    $originalFailure = if ($null -ne $result -and $result.ContainsKey('error')) { $result.error } else { $null }
    $json = @{ available = $false; targetCreated = $targetCreated; originalFailure = $originalFailure; recordingFailure = $recordingFailure; recordingFailureTruncated = $recordingFailureTruncated; nativeResult = $result } | ConvertTo-Json -Depth 18
    try { [System.IO.File]::WriteAllText((Join-Path $outputPath 'native-refusal.json'), $json, (New-Object System.Text.UTF8Encoding($false))) }
    catch { Write-Warning 'Fallback receipt file failed; native result remains on the separate output channel' }
    Write-Output $json
    Write-Error $_ -ErrorAction Continue
    exit 2
}
