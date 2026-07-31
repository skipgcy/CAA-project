[CmdletBinding()]
param(
  [string]$Profile = "CAA900",
  [string]$SecretId = "bmazon-dr/stripe",
  [ValidatePattern('^https://api\.dr\.ezei\.shop/stripe/webhook$')]
  [string]$EndpointUrl = "https://api.dr.ezei.shop/stripe/webhook"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne "563960656220") {
  throw "Unexpected AWS account."
}

$raw = aws secretsmanager get-secret-value --secret-id $SecretId --region us-east-2 --profile $Profile --query SecretString --output text
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
  throw "The DR Stripe secret has not been populated."
}
$current = $raw | ConvertFrom-Json
$raw = $null
$stripeKey = $current.STRIPE_SECRET_KEY
if (-not $stripeKey) { $stripeKey = $current.secretKey }
if ([string]::IsNullOrWhiteSpace($stripeKey)) { throw "The DR Stripe API key is missing." }

$existingEndpointId = $current.STRIPE_WEBHOOK_ENDPOINT_ID
if ($existingEndpointId) {
  Write-Output "A DR Stripe webhook endpoint is already recorded as $existingEndpointId."
  $stripeKey = $null
  $current = $null
  exit 0
}

$headers = @{
  Authorization     = "Bearer $stripeKey"
  "Idempotency-Key" = "bmazon-dr-us-east-2-webhook"
}
$body = @{
  url                = $EndpointUrl
  "enabled_events[]" = "checkout.session.completed"
  description        = "Temporary Bmazon DR endpoint in us-east-2"
}
$endpoint = Invoke-RestMethod -Method Post -Uri "https://api.stripe.com/v1/webhook_endpoints" -Headers $headers -ContentType "application/x-www-form-urlencoded" -Body $body
if (-not $endpoint.id -or -not $endpoint.secret -or $endpoint.url -ne $EndpointUrl) {
  throw "Stripe did not return the expected DR webhook endpoint."
}

$payload = [ordered]@{
  STRIPE_SECRET_KEY          = $stripeKey
  STRIPE_WEBHOOK_SECRET      = $endpoint.secret
  STRIPE_WEBHOOK_ENDPOINT_ID = $endpoint.id
} | ConvertTo-Json -Compress
$endpointSecret = $endpoint.secret
$endpointId = $endpoint.id
$endpoint = $null
$current = $null

$secretFile = Join-Path ([IO.Path]::GetTempPath()) ("bmazon-dr-stripe-{0}.json" -f [guid]::NewGuid().ToString("N"))
try {
  [IO.File]::WriteAllText($secretFile, $payload, [Text.UTF8Encoding]::new($false))
  $payload = $null
  $endpointSecret = $null
  aws secretsmanager put-secret-value --secret-id $SecretId --secret-string "file://$secretFile" --region us-east-2 --profile $Profile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to save the DR webhook credentials." }
} catch {
  # Avoid leaving an untracked Stripe endpoint if AWS persistence fails.
  try {
    Invoke-RestMethod -Method Delete -Uri "https://api.stripe.com/v1/webhook_endpoints/$endpointId" -Headers $headers | Out-Null
  } catch {
    Write-Warning "The DR endpoint was created but automatic rollback failed. Endpoint ID: $endpointId"
  }
  throw
} finally {
  $payload = $null
  $endpointSecret = $null
  $stripeKey = $null
  $headers = $null
  if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force }
}

Write-Output "Configured the isolated Stripe test webhook $endpointId for $EndpointUrl."
