# Agent Hooks Windows Installer
# This script sets up the hooks for your CLI agents.

$RepoBase = "https://raw.githubusercontent.com/Double77x/agent-hooks/main"
$HookRoot = Join-Path $HOME ".ai-hooks"
$LogDir = Join-Path $HookRoot "logs"

# Helper: Interactive Menu
function Show-Menu {
    param([string]$Title, [string[]]$Options)
    $Selection = 0; $Running = $true
    Write-Host "`n$Title" -ForegroundColor Yellow
    Write-Host "(Use Up/Down arrows to select, Enter to confirm)" -ForegroundColor Gray
    foreach ($Opt in $Options) { Write-Host "" }
    $EndLine = [Console]::CursorTop; $StartLine = $EndLine - $Options.Count
    try { [Console]::CursorVisible = $false } catch {}
    while ($Running) {
        for ($i = 0; $i -lt $Options.Count; $i++) {
            try {
                [Console]::SetCursorPosition(0, $StartLine + $i)
                if ($i -eq $Selection) { Write-Host "  > $($Options[$i])  " -ForegroundColor Cyan -BackgroundColor DarkGray }
                else { Write-Host "    $($Options[$i])  " -ForegroundColor Gray -BackgroundColor Black }
            } catch {
                [Console]::CursorVisible = $true
                Write-Host "`nSelection failed. Falling back to manual input." -ForegroundColor Red
                for ($j = 0; $j -lt $Options.Count; $j++) { Write-Host "  $($j + 1)) $($Options[$j])" }
                $UserInput = Read-Host "`nEnter number (1-$($Options.Count))"
                return $Options[[int]$UserInput - 1]
            }
        }
        $Key = [Console]::ReadKey($true)
        if ($Key.Key -eq "UpArrow") { $Selection = if ($Selection -eq 0) { $Options.Count - 1 } else { $Selection - 1 } }
        elseif ($Key.Key -eq "DownArrow") { $Selection = if ($Selection -eq $Options.Count - 1) { 0 } else { $Selection + 1 } }
        elseif ($Key.Key -eq "Enter") { $Running = $false }
    }
    try { [Console]::CursorVisible = $true } catch {}
    [Console]::SetCursorPosition(0, $EndLine); Write-Host ""
    return $Options[$Selection]
}

# Helper: Build Hook Command
function Get-HookCmd {
    param([string]$Path, [string]$AgentKey)
    # No space before && is critical for env var precision in Windows cmd
    return "cmd /c `"set AI_AGENT_TYPE=$AgentKey&&node $Path`""
}

# Helper: Write UTF-8 without BOM (compatible with PS 5.1 and PS 7+)
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

# Helper: Merge Hooks into JSON
function Register-Hooks-Json {
    param([string]$FilePath, [string]$AgentKey, [string]$BinDir)
    if (!(Test-Path $FilePath)) { return $false }
    $PrePath = Join-Path $BinDir "hooks\pre-tool-use"
    $PostPath = Join-Path $BinDir "hooks\post-tool-use"

    $NewPreHooks = @(
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "block-dangerous-commands.js") $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "protect-secrets.js") $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "pkg-manager-enforcement.js") $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "require-plan.js") $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "diff-hygiene.js") $AgentKey }
    )

    Write-Host "Registering hooks in $FilePath..." -ForegroundColor Gray
    Copy-Item $FilePath "$FilePath.bak" -Force

    try {
        $Raw = Get-Content $FilePath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($Raw)) { $Raw = "{}" }
        $Json = $Raw | ConvertFrom-Json

        if ($null -eq $Json.hooks) {
            $Json | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([PSCustomObject]@{ PreToolUse = @(); PostToolUse = @() }) -Force
        }
        $Target = $Json.hooks

        # Clean up any legacy or existing hook entries of ours to prevent duplicates or residue
        $OurHooksRegex = "block-dangerous-commands|protect-secrets|pkg-manager-enforcement|require-plan|diff-hygiene|context-injection|definition-of-done"
        if ($null -ne $Target.PreToolUse) {
            $Target.PreToolUse = @($Target.PreToolUse | Where-Object {
                if ($_.hooks) {
                    !($_.hooks | Where-Object { $_.command -match $OurHooksRegex })
                } else {
                    !($_.command -match $OurHooksRegex)
                }
            })
        } else {
            $Target | Add-Member -MemberType NoteProperty -Name "PreToolUse" -Value @() -Force
        }

        if ($null -ne $Target.PostToolUse) {
            $Target.PostToolUse = @($Target.PostToolUse | Where-Object {
                if ($_.hooks) {
                    !($_.hooks | Where-Object { $_.command -match "auto-fix" })
                } else {
                    !($_.command -match "auto-fix")
                }
            })
        } else {
            $Target | Add-Member -MemberType NoteProperty -Name "PostToolUse" -Value @() -Force
        }

        # Add the hooks using the correct nested structure
        $Target.PreToolUse += @{ matcher = "Bash|run_command|shell|terminal|run_shell_command|Write|Edit|replace|write_file|read_file"; hooks = $NewPreHooks }
        $Target.PreToolUse += @{ matcher = "thought|plan|strategy|update_topic|explore"; hooks = @( @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "context-injection.js") $AgentKey } ) }
        $Target.PreToolUse += @{ matcher = "finish|done|complete_task|submit"; hooks = @( @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "definition-of-done.js") $AgentKey } ) }
        $Target.PostToolUse += @{ matcher = "Bash|run_command|shell|Write|Edit|replace|write_file|edit_file"; hooks = @( @{ type = "command"; command = Get-HookCmd (Join-Path $PostPath "auto-fix.js") $AgentKey } ) }

        # Bug 2 fix: ConvertTo-Json Unicode-escapes & as \u0026; single-quoted regex avoids PS re-interpolation.
        $OutputJson = $Json | ConvertTo-Json -Depth 10
        $OutputJson = $OutputJson -replace '\\u0026', '&'
        $OutputJson = $OutputJson -replace '\s+&&', '&&'

        # Bug 3 fix: write UTF-8 without BOM so Node JSON.parse never sees the BOM byte.
        Write-Utf8NoBom $FilePath $OutputJson

        Write-Host "Successfully registered hooks." -ForegroundColor Green
        return $true
    } catch { Write-Error "Failed to update $FilePath. Error: $($_.Exception.Message)"; return $false }
}

# Helper: Enable Hooks in Codex TOML
function Enable-Codex-Hooks {
    param([string]$TomlPath, [string]$AgentKey, [string]$BinDir)
    if (!(Test-Path $TomlPath)) { return $false }
    Write-Host "Enabling hooks in $TomlPath..." -ForegroundColor Gray
    Copy-Item $TomlPath "$TomlPath.bak" -Force

    $Content = Get-Content $TomlPath -Raw -Encoding UTF8
    $HooksJsonPath = Join-Path (Split-Path $TomlPath) "hooks.json"

    # Ensure [features] section exists with hooks = true
    if ($Content -notmatch "\[features\]") {
        $Content += "`n`n[features]`nhooks = true"
    } elseif ($Content -notmatch 'hooks\s*=\s*true') {
        $Content = $Content -replace "\[features\]", "[features]`nhooks = true"
    }

    # Remove any invalid legacy root-level string hooks pointer if present
    if ($Content -match 'hooks\s*=\s*"[^"]*"') {
        $Content = $Content -replace '(?m)^hooks\s*=.*`r?`n', ''
    }

    Write-Utf8NoBom $TomlPath $Content
    # Create empty hooks.json (UTF-8 no-BOM) if it doesn't exist yet
    if (!(Test-Path $HooksJsonPath)) { Write-Utf8NoBom $HooksJsonPath "{}" }
    return $HooksJsonPath
}

# # Helper: Register hooks for AGY — writes to ~/.gemini/hooks.json using the correct
# JSONHookSpec schema: a named map of hook-sets, not a bare { PreToolUse: [] } object.
# AGY reads ~/.gemini/hooks.json natively; no settings.json pointer is needed.
function Register-AGY-Hooks {
    param([string]$SettingsPath, [string]$AgentKey, [string]$BinDir)
    $PrePath  = Join-Path $BinDir "hooks\pre-tool-use"
    $PostPath = Join-Path $BinDir "hooks\post-tool-use"

    # AGY's actual tool names differ from Claude's. Use the real names as the matcher.
    $AgentToolMatcher     = "run_command|write_file|replace_file_content|multi_replace_file_content|write_to_file"
    $AgentPostToolMatcher = "run_command|write_file|replace_file_content|multi_replace_file_content|write_to_file"

    $NewPreHooks = @(
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "block-dangerous-commands.js") $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "protect-secrets.js")          $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "pkg-manager-enforcement.js")  $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "require-plan.js")             $AgentKey }
        @{ type = "command"; command = Get-HookCmd (Join-Path $PrePath "diff-hygiene.js")             $AgentKey }
    )

    # AGY reads ~/.gemini/hooks.json directly — no pointer in settings.json required.
    $GeminiDir    = Join-Path $HOME ".gemini"
    $HooksJsonPath = Join-Path $GeminiDir "hooks.json"

    Write-Host "Configuring AGY hooks at $HooksJsonPath..." -ForegroundColor Gray
    if (Test-Path $HooksJsonPath) { Copy-Item $HooksJsonPath "$HooksJsonPath.bak" -Force }

    try {
        $Raw = if (Test-Path $HooksJsonPath) { [System.IO.File]::ReadAllText($HooksJsonPath) } else { "{}" }
        if ([string]::IsNullOrWhiteSpace($Raw)) { $Raw = "{}" }
        $Json = $Raw | ConvertFrom-Json

        # Check dedup: look for an existing "ai-hooks" set with our block-dangerous hook
        $SetName     = "ai-hooks"
        $ExistingSet = $Json.PSObject.Properties[$SetName]
        $AlreadySet  = $ExistingSet -and (
            $ExistingSet.Value.PreToolUse | Where-Object {
                $_.hooks | Where-Object { $_.command -like "*block-dangerous-commands*" }
            }
        )

        if ($AlreadySet) {
            Write-Host "AGY hooks already registered." -ForegroundColor Yellow
            return $true
        }

        # Build the JSONHookSpec: a named map { "hook-set-name": { PreToolUse: [], PostToolUse: [] } }
        $HookSet = [PSCustomObject]@{
            PreToolUse = @(
                @{ matcher = $AgentToolMatcher; hooks = $NewPreHooks }
            )
            PostToolUse = @(
                @{
                    matcher = $AgentPostToolMatcher
                    hooks   = @( @{ type = "command"; command = Get-HookCmd (Join-Path $PostPath "auto-fix.js") $AgentKey } )
                }
            )
        }

        # Merge into existing spec (preserves any other named hook-sets)
        if ($Json.PSObject.Properties.Name -contains $SetName) {
            $Json.$SetName = $HookSet
        } else {
            $Json | Add-Member -MemberType NoteProperty -Name $SetName -Value $HookSet -Force
        }

        $OutputJson = $Json | ConvertTo-Json -Depth 10
        $OutputJson = $OutputJson -replace '\\u0026', '&'
        $OutputJson = $OutputJson -replace '\s+&&', '&&'
        Write-Utf8NoBom $HooksJsonPath $OutputJson

        Write-Host "Successfully registered AGY hooks." -ForegroundColor Green
        return $true
    } catch {
        Write-Error "Failed to write AGY hooks.json: $($_.Exception.Message)"
        return $false
    }
}

Clear-Host
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "         AGENT HOOKS INSTALLER            " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Configuration Wizard
Write-Host "`n[1/6] Configuration Wizard" -ForegroundColor Gray
$Agent = Show-Menu "Select Target Agent:" @("Claude", "Codex", "AGY")
$NodeMgr = Show-Menu "Select Project Node.js Manager:" @("pnpm", "npm", "yarn", "bun")
$PyMgr = Show-Menu "Select Project Python Manager:" @("uv", "pip", "poetry")
$AgentKey = $Agent.ToLower()
$BinDir = Join-Path $HookRoot "bin/$AgentKey"

# 2. Create Directories
Write-Host "`n[2/6] Initialising workspace..." -ForegroundColor Gray
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# 3. Deploy Hooks
Write-Host "`n[3/6] Deploying hooks..." -ForegroundColor Gray
$Hooks = @("hooks/pre-tool-use/block-dangerous-commands.js", "hooks/pre-tool-use/protect-secrets.js", "hooks/pre-tool-use/pkg-manager-enforcement.js", "hooks/pre-tool-use/require-plan.js", "hooks/pre-tool-use/definition-of-done.js", "hooks/pre-tool-use/tool-filter.js", "hooks/pre-tool-use/diff-hygiene.js", "hooks/pre-tool-use/context-injection.js", "hooks/post-tool-use/auto-fix.js")
if (Test-Path "dist") { Copy-Item -Path "dist\*" -Destination $BinDir -Recurse -Force }
else {
    foreach ($Hook in $Hooks) {
        $Dest = Join-Path $BinDir $Hook
        $DestDir = Split-Path $Dest -Parent
        if (!(Test-Path $DestDir)) { New-Item -ItemType Directory -Path $DestDir -Force | Out-Null }
        $Url = "$RepoBase/dist/$($Hook.Replace('\', '/'))"
        Write-Host "  -> Fetching $Hook" -ForegroundColor Gray
        Invoke-RestMethod -Uri $Url -OutFile $Dest
    }
}

# 4. Environment Setup
Write-Host "`n[4/6] Setting environment variables..." -ForegroundColor Gray
[Environment]::SetEnvironmentVariable("AI_ALLOWED_NODE_MANAGER", $NodeMgr, "User")
[Environment]::SetEnvironmentVariable("AI_ALLOWED_PYTHON_MANAGER", $PyMgr, "User")
[Environment]::SetEnvironmentVariable("AI_HOOK_MODE", "deny", "User")
[Environment]::SetEnvironmentVariable("AI_SAFETY_LEVEL", "high", "User")

# 5. Automated Integration
Write-Host "`n[5/6] Automated Integration" -ForegroundColor Gray
$IntegrationSuccess = $false

if ($Agent -eq "Claude") {
    $TargetPaths = @((Join-Path $env:APPDATA "Claude/settings.json"), (Join-Path $HOME ".claude/settings.json")) | Where-Object { Test-Path $_ }
    foreach ($Path in $TargetPaths) { if ((Read-Host "Integrate hooks into Claude settings at '$Path'? (y/n)") -eq 'y') { if (Register-Hooks-Json $Path $AgentKey $BinDir) { $IntegrationSuccess = $true } } }
} elseif ($Agent -eq "AGY") {
    # Register-AGY-Hooks always writes to ~/.gemini/hooks.json — no settings path needed.
    if ((Read-Host "Register hooks into AGY (~/.gemini/hooks.json)? (y/n)") -eq 'y') {
        if (Register-AGY-Hooks $null $AgentKey $BinDir) { $IntegrationSuccess = $true }
    }
} elseif ($Agent -eq "Codex") {
    $TargetPaths = @((Join-Path $HOME ".codex/config.toml")) | Where-Object { Test-Path $_ }
    foreach ($Path in $TargetPaths) {
        if ((Read-Host "Enable hooks and integrate into Codex at '$Path'? (y/n)") -eq 'y') {
            $HooksJson = Enable-Codex-Hooks $Path $AgentKey $BinDir
            if ($HooksJson) { if (Register-Hooks-Json $HooksJson $AgentKey $BinDir) { $IntegrationSuccess = $true } }
        }
    }
}

if ($Agent -eq "AGY" -or $Agent -eq "Codex") {
    if ((Read-Host "Add '$AgentKey-secure' alias to your PowerShell Profile? (y/n)") -eq 'y') {
        $AliasCmd = "`nfunction $AgentKey-secure { `$env:AI_AGENT_TYPE='$AgentKey'; $AgentKey --hooks-path '$BinDir' @args }`n"
        if (!(Test-Path $PROFILE)) { New-Item -Type File -Path $PROFILE -Force | Out-Null }
        Add-Content -Path $PROFILE -Value $AliasCmd
        Write-Host "Alias '$AgentKey-secure' added to `$PROFILE." -ForegroundColor Green
        $IntegrationSuccess = $true
    }
}

# 6. Final Output
Write-Host "`n[6/6] Finalising installation..." -ForegroundColor Gray
Write-Host "`nInstallation Successful!" -ForegroundColor Green
if (!$IntegrationSuccess) { Write-Host "Launch with: `$env:AI_AGENT_TYPE='$AgentKey'; $AgentKey --hooks-path '$BinDir'" -ForegroundColor Cyan }
else { Write-Host "Hooks registered. Run '$AgentKey inspect' or '/hooks' to verify." -ForegroundColor Cyan }
Write-Host "`nNOTE: Restart your terminal for changes to take effect." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Read-Host "Installation Complete. Press Enter to exit"
