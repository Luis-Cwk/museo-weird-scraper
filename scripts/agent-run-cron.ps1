Set-Location "C:\Users\petra\museo-weird-scraper"
$log = "logs/cron-run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log"
node scripts/agent.js --once --limit=1 *> $log
