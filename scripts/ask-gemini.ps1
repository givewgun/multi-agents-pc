<#
.SYNOPSIS
  One-shot call to Gemini via Antigravity CLI (agy) in headless mode.

.EXAMPLE
  .\scripts\ask-gemini.ps1 -Prompt "Summarize src/ architecture in 10 bullets"
  .\scripts\ask-gemini.ps1 -PromptFile handoffs\inbox\task.md -Edit -Model gemini-3.8-flash-medium
  .\scripts\ask-gemini.ps1 -Prompt "Now add tests" -Continue <conversation_id>
#>
param(
    [string]$Prompt,
    [string]$PromptFile,
    [string]$Model,                       # e.g. gemini-3.8-flash-medium; list with: agy models
    [ValidateSet('low','medium','high','xhigh','max')][string]$Effort,
    [switch]$Edit,                        # allow file edits (accept-edits); default is read-only plan mode
    [string]$Continue,                    # conversation_id from a previous call
    [string]$Timeout = '15m',
    [string]$WorkDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$Json                         # print full JSON envelope instead of .response
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$agy = (Get-Command agy -ErrorAction SilentlyContinue).Source
if (-not $agy) { $agy = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe' }
if (-not (Test-Path $agy)) { throw "agy not found. Install: irm https://antigravity.google/cli/install.ps1 | iex  (then run 'agy' once to sign in)" }

if ($PromptFile) { $Prompt = Get-Content -Raw -Encoding UTF8 $PromptFile }
if (-not $Prompt) { throw 'Give -Prompt or -PromptFile' }

$logDir = Join-Path $WorkDir 'handoffs\log'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# PowerShell 5.1 mangles embedded quotes in native args, and Windows caps command lines,
# so long or quoted prompts go through a file the agent reads itself.
if ($Prompt.Length -gt 6000 -or $Prompt.Contains('"')) {
    $pf = Join-Path $logDir "prompt-$stamp.md"
    Set-Content -Path $pf -Value $Prompt -Encoding UTF8
    $Prompt = "Read the file $pf and follow the instructions in it exactly. Reply with your final answer only."
}

$a = @('-p', $Prompt, '--output-format', 'json', '--print-timeout', $Timeout)
$a += @('--mode', $(if ($Edit) { 'accept-edits' } else { 'plan' }))
if ($Model)    { $a += @('--model', $Model) }
if ($Effort)   { $a += @('--effort', $Effort) }
if ($Continue) { $a += @('--conversation', $Continue) }

Push-Location $WorkDir
try {
    $errFile = Join-Path $logDir "gemini-$stamp.stderr.txt"
    $raw = & $agy @a 2> $errFile | Out-String
} finally { Pop-Location }

Set-Content -Path (Join-Path $logDir "gemini-$stamp.json") -Value $raw -Encoding UTF8

try { $r = $raw | ConvertFrom-Json } catch {
    Write-Output $raw
    Write-Error "agy returned non-JSON output; stderr in $errFile"
    exit 1
}

if ($Json) { Write-Output $raw; exit 0 }
if ($r.status -ne 'SUCCESS') { Write-Error "Gemini status=$($r.status) error=$($r.error) (stderr: $errFile)" }
Write-Output $r.response
Write-Output ""
Write-Output "[gemini conversation_id=$($r.conversation_id) status=$($r.status) turns=$($r.num_turns) secs=$($r.duration_seconds)]"
