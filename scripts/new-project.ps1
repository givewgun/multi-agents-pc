<#
.SYNOPSIS
  Copy the Claude+Gemini team setup into another project folder.
.EXAMPLE
  .\scripts\new-project.ps1 C:\Users\gunka\workspace\my-app
#>
param([Parameter(Mandatory)][string]$Target)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $Target | Out-Null

$items = @(
    'AGENTS.md', 'CLAUDE.md',
    'scripts\ask-gemini.ps1', 'scripts\ask-claude.ps1',
    'handoffs\TEMPLATE.md',
    '.claude\skills\gemini\SKILL.md',
    '.agents\rules\claude-bridge.md'
)
foreach ($i in $items) {
    $dest = Join-Path $Target $i
    if (Test-Path $dest) { Write-Output "skip (exists): $i"; continue }
    New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
    Copy-Item (Join-Path $src $i) $dest
    Write-Output "added: $i"
}
foreach ($d in 'handoffs\inbox', 'handoffs\done') { New-Item -ItemType Directory -Force (Join-Path $Target $d) | Out-Null }

$gi = Join-Path $Target '.gitignore'
if (-not ((Test-Path $gi) -and (Select-String -Quiet -SimpleMatch 'handoffs/log/' $gi))) {
    Add-Content $gi "`nhandoffs/log/"
    Write-Output "updated: .gitignore"
}
Write-Output "Done. Edit $Target\AGENTS.md with project-specific rules."
