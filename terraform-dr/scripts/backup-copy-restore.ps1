[CmdletBinding()]
param(
  [string]$Profile = "CAA900",
  [string]$PrimaryRegion = "us-east-1",
  [string]$DrRegion = "us-east-2",
  [string]$ProductionTableArn = "arn:aws:dynamodb:us-east-1:563960656220:table/Ecommerce",
  [string]$ProductionTableName = "Ecommerce",
  [string]$RestoredTableName = "Ecommerce-DR",
  [string]$SourceVault = "bmazon-dr-source-vault",
  [string]$DestinationVault = "bmazon-dr-us-east-2-vault",
  [string]$BackupRoleArn = "arn:aws:iam::563960656220:role/bmazon-dr-aws-backup-role",
  [int]$RetentionDays = 7
)

$ErrorActionPreference = "Stop"
if ($PrimaryRegion -ne "us-east-1" -or $DrRegion -ne "us-east-2") { throw "Safety check failed: approved regions are us-east-1 -> us-east-2." }
if ($ProductionTableArn -ne "arn:aws:dynamodb:us-east-1:563960656220:table/Ecommerce") { throw "Safety check failed: unexpected source table ARN." }
if ($RestoredTableName -ne "Ecommerce-DR") { throw "Safety check failed: unexpected restore table name." }

$evidence = Join-Path $PSScriptRoot "..\evidence"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $evidence "database-recovery-$stamp.log"

function Write-Evidence([string]$Message) {
  $line = "[$(Get-Date -Format o)] $Message"
  $line | Tee-Object -FilePath $log -Append
}

function Invoke-AwsJson([string[]]$Arguments) {
  $raw = & aws @Arguments --profile $Profile --output json 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($raw -join "`n") }
  ($raw -join "`n") | ConvertFrom-Json
}

function Wait-BackupJob([string]$JobId) {
  do {
    Start-Sleep -Seconds 15
    $job = Invoke-AwsJson @("backup", "describe-backup-job", "--backup-job-id", $JobId, "--region", $PrimaryRegion)
    Write-Evidence "Backup job $JobId state: $($job.State)"
    if ($job.State -in @("FAILED", "ABORTED", "EXPIRED")) { throw "Backup job failed: $($job.StatusMessage)" }
  } while ($job.State -ne "COMPLETED")
  $job
}

function Wait-CopyJob([string]$JobId) {
  do {
    Start-Sleep -Seconds 15
    $job = Invoke-AwsJson @("backup", "describe-copy-job", "--copy-job-id", $JobId, "--region", $PrimaryRegion)
    Write-Evidence "Copy job $JobId state: $($job.CopyJob.State)"
    if ($job.CopyJob.State -in @("FAILED", "PARTIAL")) { throw "Copy job failed: $($job.CopyJob.StatusMessage)" }
  } while ($job.CopyJob.State -ne "COMPLETED")
  $job.CopyJob
}

function Wait-RestoreJob([string]$JobId) {
  do {
    Start-Sleep -Seconds 15
    $job = Invoke-AwsJson @("backup", "describe-restore-job", "--restore-job-id", $JobId, "--region", $DrRegion)
    Write-Evidence "Restore job $JobId state: $($job.Status)"
    if ($job.Status -in @("FAILED", "ABORTED")) { throw "Restore job failed: $($job.StatusMessage)" }
  } while ($job.Status -ne "COMPLETED")
  $job
}

Write-Evidence "Starting isolated Bmazon database recovery exercise."
$identity = Invoke-AwsJson @("sts", "get-caller-identity")
if ($identity.Account -ne "563960656220") { throw "Safety check failed: unexpected AWS account $($identity.Account)." }
Write-Evidence "AWS account verified: $($identity.Account)"

$sourceBefore = Invoke-AwsJson @("dynamodb", "describe-table", "--table-name", $ProductionTableName, "--region", $PrimaryRegion)
Write-Evidence "Production source before backup: status=$($sourceBefore.Table.TableStatus), items=$($sourceBefore.Table.ItemCount), bytes=$($sourceBefore.Table.TableSizeBytes)"

$existing = & aws dynamodb describe-table --table-name $RestoredTableName --region $DrRegion --profile $Profile --output json 2>$null
if ($LASTEXITCODE -eq 0) { throw "Safety check failed: $RestoredTableName already exists in $DrRegion." }

$destinationVault = Invoke-AwsJson @("backup", "describe-backup-vault", "--backup-vault-name", $DestinationVault, "--region", $DrRegion)
$destinationVaultArn = $destinationVault.BackupVaultArn

$backupToken = "bmazon-dr-backup-$stamp"
$backup = Invoke-AwsJson @(
  "backup", "start-backup-job",
  "--backup-vault-name", $SourceVault,
  "--resource-arn", $ProductionTableArn,
  "--iam-role-arn", $BackupRoleArn,
  "--idempotency-token", $backupToken,
  "--start-window-minutes", "60",
  "--complete-window-minutes", "180",
  "--lifecycle", "DeleteAfterDays=$RetentionDays",
  "--recovery-point-tags", "Project=CAA900-Bmazon,Environment=DR,Temporary=true",
  "--region", $PrimaryRegion
)
Write-Evidence "Backup job started: $($backup.BackupJobId)"
$completedBackup = Wait-BackupJob $backup.BackupJobId
Write-Evidence "Source recovery point: $($completedBackup.RecoveryPointArn)"

$copy = Invoke-AwsJson @(
  "backup", "start-copy-job",
  "--recovery-point-arn", $completedBackup.RecoveryPointArn,
  "--source-backup-vault-name", $SourceVault,
  "--destination-backup-vault-arn", $destinationVaultArn,
  "--iam-role-arn", $BackupRoleArn,
  "--idempotency-token", "bmazon-dr-copy-$stamp",
  "--lifecycle", "DeleteAfterDays=$RetentionDays",
  "--region", $PrimaryRegion
)
Write-Evidence "Cross-Region copy job started: $($copy.CopyJobId)"
$completedCopy = Wait-CopyJob $copy.CopyJobId
Write-Evidence "Destination recovery point: $($completedCopy.DestinationRecoveryPointArn)"

$restore = Invoke-AwsJson @(
  "backup", "start-restore-job",
  "--recovery-point-arn", $completedCopy.DestinationRecoveryPointArn,
  "--iam-role-arn", $BackupRoleArn,
  "--metadata", "targetTableName=$RestoredTableName,encryptionType=Default",
  "--idempotency-token", "bmazon-dr-restore-$stamp",
  "--resource-type", "DynamoDB",
  "--region", $DrRegion
)
Write-Evidence "Restore job started: $($restore.RestoreJobId)"
$completedRestore = Wait-RestoreJob $restore.RestoreJobId

$restored = Invoke-AwsJson @("dynamodb", "describe-table", "--table-name", $RestoredTableName, "--region", $DrRegion)
$sourceAfter = Invoke-AwsJson @("dynamodb", "describe-table", "--table-name", $ProductionTableName, "--region", $PrimaryRegion)
Write-Evidence "Restored table: arn=$($restored.Table.TableArn), status=$($restored.Table.TableStatus), items=$($restored.Table.ItemCount), bytes=$($restored.Table.TableSizeBytes)"
Write-Evidence "Production source after recovery: status=$($sourceAfter.Table.TableStatus), items=$($sourceAfter.Table.ItemCount), bytes=$($sourceAfter.Table.TableSizeBytes)"
Write-Evidence "Database recovery completed successfully. Production table configuration and data were not modified."

[pscustomobject]@{
  BackupJobId             = $backup.BackupJobId
  CopyJobId               = $copy.CopyJobId
  RestoreJobId            = $restore.RestoreJobId
  SourceRecoveryPoint     = $completedBackup.RecoveryPointArn
  DestinationRecoveryPoint = $completedCopy.DestinationRecoveryPointArn
  RestoredTableArn        = $restored.Table.TableArn
  EvidenceLog             = $log
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $evidence "database-recovery-result.json")

Write-Output "Database recovery evidence: $log"
