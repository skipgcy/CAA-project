[CmdletBinding()]
param(
  [string]$Profile = "CAA900",
  [string]$SecretId = "bmazon-dr/stripe",
  [ValidatePattern('^https://api\.dr\.ezei\.shop/stripe/webhook$')]
  [string]$ExpectedEndpointUrl = "https://api.dr.ezei.shop/stripe/webhook"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne "563960656220") { throw "Unexpected AWS account." }

$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $raw = aws secretsmanager get-secret-value --secret-id $SecretId --region us-east-2 --profile $Profile --query SecretString --output text 2>$null
  $secretLookupExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($secretLookupExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
  Write-Output "No populated DR Stripe secret was found; no Stripe endpoint cleanup is required."
  exit 0
}
$secret = $raw | ConvertFrom-Json
$raw = $null
$stripeKey = $secret.STRIPE_SECRET_KEY
$endpointId = $secret.STRIPE_WEBHOOK_ENDPOINT_ID
$secret = $null
if (-not $stripeKey -or -not $endpointId) {
  Write-Output "No tracked DR Stripe webhook endpoint was found."
  exit 0
}

$headers = @{ Authorization = "Bearer $stripeKey" }
try {
  $endpoint = Invoke-RestMethod -Method Get -Uri "https://api.stripe.com/v1/webhook_endpoints/$endpointId" -Headers $headers
  if ($endpoint.url -ne $ExpectedEndpointUrl) {
    throw "Refusing to delete Stripe endpoint $endpointId because its URL is not the DR URL."
  }
  Invoke-RestMethod -Method Delete -Uri "https://api.stripe.com/v1/webhook_endpoints/$endpointId" -Headers $headers | Out-Null
  Write-Output "Deleted the isolated Stripe webhook endpoint $endpointId."
} catch {
  $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { $null }
  if ($status -eq 404) {
    Write-Output "The tracked DR Stripe webhook endpoint is already absent."
  } else {
    throw
  }
} finally {
  $stripeKey = $null
  $headers = $null
  $endpoint = $null
}
