# Setup Huaca Agent Task Scheduler
# Runs every 6 hours: scrape → guard → generate → mint → list → refresh

$TaskName = "HuacaAgent"
$ScriptPath = "C:\Users\petra\museo-weird-scraper\scripts\agent-run-cron.ps1"
$WorkingDir = "C:\Users\petra\museo-weird-scraper"

# Create the script that runs the agent
$agentScript = @"
Set-Location "$WorkingDir"
node scripts/agent.js --once --limit=1 *> logs/cron-run.log
"@

Set-Content -Path $ScriptPath -Value $agentScript

# Create the scheduled task
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 365)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force -ErrorAction Stop
    Write-Host "Task '$TaskName' registered successfully."
    Write-Host "Script: $ScriptPath"
    Write-Host "Trigger: every 6 hours"
} catch {
    Write-Host "Failed: $_"
    exit 1
}

# Verify
Get-ScheduledTask -TaskName $TaskName | Format-List
