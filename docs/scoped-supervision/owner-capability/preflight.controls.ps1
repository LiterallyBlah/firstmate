# Static source checks and pure in-memory callback controls. Never imports native C#.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$checks = New-Object 'System.Collections.Generic.List[string]'
$failure = $null
function Assert-PreflightControl([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw $Name }
    $checks.Add($Name)
}
try {
    $native = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'WindowsJobOwner.cs'))
    $preflightPattern = '(?s)    public static Dictionary<string, object> Preflight\(\) \{.*?\n    \}(?=\n    static string Quote)'
    $preflight = [regex]::Match($native, $preflightPattern).Value
    Assert-PreflightControl ($preflight.Contains('if (!PreflightSetupAllowed)') -and $native.Contains('static readonly bool PreflightSetupAllowed = true;')) 'setup permission is independent of held process execution'
    Assert-PreflightControl ($native.Contains('static readonly bool CaptureReviewAccepted = false;') -and $native.Contains('Run(string node, string entry, string config, string directory, string scenario) {') -and ([regex]::Matches($native, 'if \(!CaptureReviewAccepted\)').Count -eq 1)) 'Run retains its false native gate'
    Assert-PreflightControl ($preflight.Contains('owner.Acquire();') -and -not ($preflight -match 'CreateProcessW\(|\.Run\(|ResumeThread\(|PrepareStandardHandles\(|Terminate\(')) 'Preflight calls only setup and disposal paths'
    Assert-PreflightControl ($preflight.Contains('owner.Step("preflight attributes"') -and $preflight.Contains('owner.Step("preflight job close"') -and $preflight.Contains('"originalFailure", error') -and $preflight.Contains('4096')) 'original error is bounded and cleanup steps are independent'
    Assert-PreflightControl ($preflight.Contains('(uint)empty["active"] != 0') -and $preflight.Contains('(uint)empty["listed"] != 0') -and $preflight.Contains('(uint)empty["total"] != 0')) 'setup requires complete zero active, listed and total membership'

    # Exact base snapshots are provided by the source-bound local verification packet.
    $baseDirectory = Join-Path (Get-Location).Path '.local/preflight-prepare/baseline'
    $baseNative = [System.IO.File]::ReadAllText((Join-Path $baseDirectory 'WindowsJobOwner.cs'))
    $maskedCurrent = [regex]::Replace($native, $preflightPattern, '<preflight>') -replace '(?m)^    static readonly bool PreflightSetupAllowed = true;[^\r\n]*\r?\n', ''
    $maskedBase = [regex]::Replace($baseNative, $preflightPattern, '<preflight>')
    Assert-PreflightControl ($maskedCurrent -ceq $maskedBase) 'all native bytes outside Preflight and its separate permission remain unchanged'
    foreach ($wrapper in @('run.mjs', 'invoke.ps1')) {
        Assert-PreflightControl ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $wrapper) -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath (Join-Path $baseDirectory $wrapper) -Algorithm SHA256).Hash) ('legacy held wrapper unchanged: ' + $wrapper)
    }
    $runnerPath = Join-Path $PSScriptRoot 'preflight-only.ps1'
    $tokens = $null; $parseErrors = $null
    $runnerAst = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
    Assert-PreflightControl ($parseErrors.Count -eq 0) 'preflight-only runner parses without executing'
    $nativeCalls = @($runnerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Expression.Extent.Text -eq '[FirstMateJobCapability]' }, $true))
    Assert-PreflightControl ($nativeCalls.Count -eq 1 -and $nativeCalls[0].Member.Value -eq 'Preflight' -and ($null -eq $nativeCalls[0].Arguments -or @($nativeCalls[0].Arguments).Count -eq 0)) 'runner has exactly one literal no-argument Preflight call'
    $runner = [System.IO.File]::ReadAllText($runnerPath)
    $sourceHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'WindowsJobOwner.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-PreflightControl ($runner.Contains($sourceHash) -and $runner.Contains('ComputeHash($sourceBytes)') -and $runner.Contains('GetString($sourceBytes)') -and $runner.Contains('Add-Type -TypeDefinition $sourceText') -and $runner.IndexOf('if ($sourceHash -ne $expectedSourceHash)') -lt $runner.IndexOf('Add-Type') -and $runner.IndexOf('attempt.reserved') -lt $runner.IndexOf('Add-Type') -and $runner.Contains('[System.IO.FileMode]::CreateNew')) 'runner hashes the exact compiled bytes and reserves fresh output before compilation'
    Assert-PreflightControl (-not ($runner -match '::Run\(|Start-Process|CreateProcess|GetField|SetValue|BindingFlags|NodePath|Configuration|ValidateSet')) 'runner has no target mode, process factory or field-mutation bypass'
    . (Join-Path $PSScriptRoot 'preflight-receipt.ps1')

    $state = @{ calls = 0; writes = 0 }
    $original = @{ available = $true; targetCreated = $false; originalFailure = $null; cleanup = @{ attributesReleased = $true; jobClosed = $true } }
    $result = Invoke-PreflightReceipt -Call { $state.calls++; return $original } -WriteReceipt { param($value) $state.writes++; return 'sink output is ignored' }
    Assert-PreflightControl ($state.calls -eq 1 -and $state.writes -eq 1 -and $result.available -and [object]::ReferenceEquals($original, $result.nativeResult)) 'positive receipt calls once, writes once and preserves actual result'
    $state = @{ calls = 0 }
    $original = @{ available = $false; targetCreated = $false; originalFailure = 'setup failed'; cleanup = @{ attributesReleased = $false; jobClosed = $false } }
    $result = Invoke-PreflightReceipt -Call { $state.calls++; return $original } -WriteReceipt { throw 'sink failed' }
    Assert-PreflightControl ($state.calls -eq 1 -and -not $result.available -and $result.nativeResult.originalFailure -eq 'setup failed' -and $result.recordingError.message.Contains('sink failed') -and $null -eq $result.invocationError -and -not $result.nativeResult.cleanup.jobClosed) 'sink failure preserves original setup and cleanup failure without retry'
    $original = @{ available = $false; targetCreated = $false; originalFailure = $null; cleanup = @{ attributesReleased = $true; jobClosed = $false } }
    $result = Invoke-PreflightReceipt -Call { return $original } -WriteReceipt { }
    Assert-PreflightControl (-not $result.available -and $null -eq $result.nativeResult.originalFailure -and -not $result.nativeResult.cleanup.jobClosed -and $null -eq $result.invocationError -and $null -eq $result.recordingError) 'cleanup-only refusal stays separate from setup and recording errors'
    $state = @{ calls = 0 }
    $result = Invoke-PreflightReceipt -Call { $state.calls++; throw ('invoke-' + ('x' * 5000)) } -WriteReceipt { throw ('sink-' + ('y' * 5000)) }
    Assert-PreflightControl ($state.calls -eq 1 -and -not $result.available -and $null -eq $result.targetCreated -and $null -eq $result.nativeResult -and $result.invocationError.truncated -and $result.invocationError.message.Length -eq 4096 -and $result.recordingError.truncated -and $result.recordingError.message.Length -eq 4096) 'invocation and recording errors remain separate and bounded, with unknown target status'
    foreach ($simulated in @($null, 'not a native receipt', @{ available = $true }, @{ available = $true; targetCreated = $true })) {
        $result = Invoke-PreflightReceipt -Call { return $simulated } -WriteReceipt { }
        Assert-PreflightControl (-not $result.available) ('malformed or target-creating result refuses admission: ' + [string]$simulated)
    }
    $original = @{ available = $true; targetCreated = $false; originalFailure = $null }
    $first = Invoke-PreflightReceipt -Call { return $original } -WriteReceipt { throw 'first sink failed' }
    $second = Invoke-PreflightReceipt -Call { return $original } -WriteReceipt { }
    Assert-PreflightControl (-not $first.available -and $second.available -and $null -eq $second.recordingError -and $null -eq $second.invocationError) 'each receipt has fresh failure state'
} catch { $failure = $_.Exception.Message }
[ordered]@{ format = 'firstmate.preflight-prepare/controls/1'; passed = $checks.Count; failed = $(if ($null -eq $failure) { 0 } else { 1 }); checks = @($checks); failure = $failure; nativeExecuted = $false; targetCreated = $false; compilation = $false } | ConvertTo-Json -Depth 5
if ($null -ne $failure) { exit 1 }
