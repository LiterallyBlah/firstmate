param([ValidateSet('preflight', 'normal', 'blocked')][string]$Mode = 'preflight', [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$NodePath, [string]$Configuration)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$env:TEMP = $outputPath
$env:TMP = $outputPath
$nativeInvoked = $false
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
    $targetCreated = if ($nativeInvoked) { $null } else { $false }
    $json = @{ available = $false; targetCreated = $targetCreated; error = $_.Exception.ToString() } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText((Join-Path $outputPath 'native-refusal.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Error $_ -ErrorAction Continue
    exit 2
}
