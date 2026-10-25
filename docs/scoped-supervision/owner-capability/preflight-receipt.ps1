# Pure receipt boundary; tests pass only synthetic callbacks and never load native code.
function Invoke-PreflightReceipt {
    param([Parameter(Mandatory = $true)][scriptblock]$Call, [Parameter(Mandatory = $true)][scriptblock]$WriteReceipt)
    $nativeResult = $null; $invocationError = $null
    try { $nativeResult = & $Call }
    catch {
        $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
        $invocationError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
    }
    $receipt = [ordered]@{
        format = 'firstmate.owner-preflight/1'
        available = $null -eq $invocationError -and $nativeResult -is [System.Collections.IDictionary] -and $nativeResult['available'] -eq $true -and $nativeResult['targetCreated'] -eq $false
        targetCreated = $(if ($nativeResult -is [System.Collections.IDictionary] -and $nativeResult['targetCreated'] -is [bool]) { $nativeResult['targetCreated'] } else { $null })
        nativeResult = $nativeResult
        invocationError = $invocationError
        recordingError = $null
    }
    try { $null = & $WriteReceipt $receipt }
    catch {
        $message = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
        $receipt.recordingError = @{ message = $message.Substring(0, [Math]::Min(4096, $message.Length)); truncated = $message.Length -gt 4096 }
        $receipt.available = $false
    }
    return $receipt
}
