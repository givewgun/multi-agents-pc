<#
.SYNOPSIS
  One-shot call to Claude Code in headless mode. For Gemini/Antigravity to get a review or hard-reasoning help.
  Uses the Claude subscription — call sparingly (reviews, hard bugs, architecture), not for grunt work.

.EXAMPLE
  .\scripts\ask-claude.ps1 -Prompt "Review the uncommitted diff for bugs. Findings only."
  .\scripts\ask-claude.ps1 -PromptFile handoffs\inbox\task.md -Model opus
#>
param(
    [string]$Prompt,
    [string]$PromptFile,
    [ValidateSet('haiku','sonnet','opus')][string]$Model = 'sonnet',
    [switch]$Edit,                        # allow file edits (acceptEdits); default is read-only plan mode
    [string]$Continue,                    # session_id from a previous call
    [int]$MaxTurns = 30,
    [string]$WorkDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if ($PromptFile) { $Prompt = Get-Content -Raw -Encoding UTF8 $PromptFile }
if (-not $Prompt) { throw 'Give -Prompt or -PromptFile' }

$logDir = Join-Path $WorkDir 'handoffs\log'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# Same quoting/length workaround as ask-gemini.ps1.
if ($Prompt.Length -gt 6000 -or $Prompt.Contains('"')) {
    $pf = Join-Path $logDir "prompt-$stamp.md"
    Set-Content -Path $pf -Value $Prompt -Encoding UTF8
    $Prompt = "Read the file $pf and follow the instructions in it exactly. Reply with your final answer only."
}

$a = @('-p', $Prompt, '--output-format', 'json', '--model', $Model, '--max-turns', $MaxTurns)
$a += @('--permission-mode', $(if ($Edit) { 'acceptEdits' } else { 'plan' }))
if ($Continue) { $a += @('--resume', $Continue) }

Push-Location $WorkDir
try {
    $errFile = Join-Path $logDir "claude-$stamp.stderr.txt"
    $raw = & claude @a 2> $errFile | Out-String
} finally { Pop-Location }

Set-Content -Path (Join-Path $logDir "claude-$stamp.json") -Value $raw -Encoding UTF8

try { $r = $raw | ConvertFrom-Json } catch {
    Write-Output $raw
    Write-Error "claude returned non-JSON output; stderr in $errFile"
    exit 1
}

if ($Json) { Write-Output $raw; exit 0 }
if ($r.is_error) { Write-Error "Claude error: $($r.result) (stderr: $errFile). If auth failed, run 'claude' in a terminal and /login once." }
Write-Output $r.result
Write-Output ""
Write-Output "[claude session_id=$($r.session_id) turns=$($r.num_turns) cost_usd_equiv=$($r.total_cost_usd)]"
