[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("DESTROY-BMAZON-DR-US-EAST-2")]
  [string]$Confirmation,
  [string]$Terraform = "terraform",
  [string]$Profile = "CAA900"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$application = Join-Path $root "application"
$bootstrap = Join-Path $root "bootstrap"
$variables = Join-Path $root "dr.tfvars"
if (-not (Test-Path $variables)) { throw "Missing isolated DR variable file: $variables" }
$terraformCommand = $Terraform
if (Test-Path -LiteralPath $Terraform) { $terraformCommand = (Resolve-Path -LiteralPath $Terraform).Path }

$identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($identity.Account -ne "563960656220") { throw "Unexpected AWS account $($identity.Account)." }

& (Join-Path $PSScriptRoot "remove-stripe-webhook.ps1") -Profile $Profile
if ($LASTEXITCODE -ne 0) { throw "DR Stripe webhook cleanup failed." }

Write-Output "Destroying Terraform-managed DR application resources only."
& $terraformCommand "-chdir=$application" destroy "-var-file=$variables" -auto-approve
if ($LASTEXITCODE -ne 0) { throw "Application destroy failed. Database and backup cleanup was not started." }

$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $table = aws dynamodb describe-table --table-name Ecommerce-DR --region us-east-2 --profile $Profile --output json 2>$null
  $tableExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($tableExitCode -eq 0) {
  aws dynamodb delete-table --table-name Ecommerce-DR --region us-east-2 --profile $Profile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to delete restored DR table." }
  aws dynamodb wait table-not-exists --table-name Ecommerce-DR --region us-east-2 --profile $Profile
}

function Remove-RecoveryPoints([string]$Vault, [string]$Region) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $points = aws backup list-recovery-points-by-backup-vault --backup-vault-name $Vault --region $Region --profile $Profile --query "RecoveryPoints[].RecoveryPointArn" --output text 2>$null
    $pointsExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($pointsExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($points)) { return }
  foreach ($arn in ($points -split "\s+")) {
    if (-not [string]::IsNullOrWhiteSpace($arn)) {
      aws backup delete-recovery-point --backup-vault-name $Vault --recovery-point-arn $arn --region $Region --profile $Profile
      if ($LASTEXITCODE -ne 0) { throw "Failed to delete recovery point $arn" }
    }
  }
}

Remove-RecoveryPoints "bmazon-dr-us-east-2-vault" "us-east-2"
Remove-RecoveryPoints "bmazon-dr-source-vault" "us-east-1"

Write-Output "Destroying Terraform-managed temporary backup configuration."
& $terraformCommand "-chdir=$bootstrap" destroy "-var-file=$variables" -auto-approve
if ($LASTEXITCODE -ne 0) { throw "Backup bootstrap destroy failed." }

& (Join-Path $PSScriptRoot "audit-cleanup.ps1") -Profile $Profile
if ($LASTEXITCODE -ne 0) { throw "Final cleanup audit failed." }

Write-Output "The isolated Bmazon DR environment has been fully removed."
