[CmdletBinding()]
param(
  [string]$Profile = "CAA900",
  [string]$SourceSecretId = "arn:aws:secretsmanager:us-east-1:563960656220:secret:bmazon/stripe-VUvhq2",
  [string]$DestinationSecretId = "bmazon-dr/stripe"
)

$ErrorActionPreference = "Stop"
# AWS CLI on Windows cannot safely receive JSON containing quotes and spaces as
# a normal command-line argument. Use a short-lived parameter file so the
# secret is never expanded into the process command line or console output.
$secret = aws secretsmanager get-secret-value --secret-id $SourceSecretId --region us-east-1 --profile $Profile --query SecretString --output text
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($secret)) { throw "Unable to read the source Stripe test secret." }

try {
  $sourceSecret = $secret | ConvertFrom-Json
  $stripeKey = $sourceSecret.STRIPE_SECRET_KEY
  if (-not $stripeKey) { $stripeKey = $sourceSecret.secretKey }
} catch {
  $stripeKey = $secret
}
$secret = $null
$sourceSecret = $null
if ([string]::IsNullOrWhiteSpace($stripeKey)) { throw "The source secret does not contain a Stripe API key." }

# Preserve a DR endpoint signing secret if one has already been configured.
# A production endpoint's signing secret must never be copied to the DR endpoint.
$drWebhookSecret = ""
$previousErrorActionPreference = $ErrorActionPreference
try {
  # A newly created Secrets Manager secret has no AWSCURRENT version yet.
  # Treat that expected lookup failure as "no existing DR webhook secret".
  $ErrorActionPreference = "Continue"
  $existing = aws secretsmanager get-secret-value --secret-id $DestinationSecretId --region us-east-2 --profile $Profile --query SecretString --output text 2>$null
  $existingExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($existingExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing)) {
  try {
    $existingSecret = $existing | ConvertFrom-Json
    $drWebhookSecret = $existingSecret.STRIPE_WEBHOOK_SECRET
    if (-not $drWebhookSecret) { $drWebhookSecret = $existingSecret.webhookSecret }
  } catch {
    $drWebhookSecret = ""
  }
}
$existing = $null
$existingSecret = $null
$payload = [ordered]@{
  STRIPE_SECRET_KEY     = $stripeKey
  STRIPE_WEBHOOK_SECRET = $drWebhookSecret
} | ConvertTo-Json -Compress
$stripeKey = $null
$drWebhookSecret = $null

$secretFile = Join-Path ([IO.Path]::GetTempPath()) ("bmazon-dr-secret-{0}.json" -f [guid]::NewGuid().ToString("N"))
try {
  [IO.File]::WriteAllText($secretFile, $payload, [Text.UTF8Encoding]::new($false))
  $payload = $null
  aws secretsmanager put-secret-value --secret-id $DestinationSecretId --secret-string "file://$secretFile" --region us-east-2 --profile $Profile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to populate the isolated DR Stripe secret." }
}
finally {
  $secret = $null
  $payload = $null
  if (Test-Path -LiteralPath $secretFile) {
    Remove-Item -LiteralPath $secretFile -Force
  }
}
Write-Output "The DR Stripe secret was populated without exposing its value."
