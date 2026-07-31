[CmdletBinding()]
param(
  [string]$Terraform = "terraform",
  [string]$Profile = "CAA900",
  [string]$ProductionBucket = "chenyu-caa900-project"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$application = Resolve-Path (Join-Path $PSScriptRoot "..\application")
$applicationPath = $application.Path
$terraformCommand = $Terraform
if (Test-Path -LiteralPath $Terraform) {
  $terraformCommand = (Resolve-Path -LiteralPath $Terraform).Path
}
$stage = Join-Path $PSScriptRoot "..\.frontend"
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$terraformOutput = & $terraformCommand "-chdir=$applicationPath" output -json
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($terraformOutput -join ""))) {
  throw "Unable to read the DR Terraform outputs."
}
$outputs = $terraformOutput | ConvertFrom-Json
$bucket = $outputs.website_bucket.value
$distribution = $outputs.cloudfront_distribution_id.value
if ([string]::IsNullOrWhiteSpace($bucket) -or [string]::IsNullOrWhiteSpace($distribution)) {
  throw "The DR Terraform outputs do not contain a website bucket and CloudFront distribution."
}

Get-ChildItem $repo -Filter "*.html" -File | Copy-Item -Destination $stage
Copy-Item -LiteralPath (Join-Path $repo "assets") -Destination $stage -Recurse

$config = @"
window.BMAZON_CONFIG = Object.freeze({
    apiBaseUrl: "$($outputs.api_url.value)",
    currency: "CAD",
    taxRate: 0.13,
    freeShippingThreshold: 100,
    standardShipping: 10,
    cognito: {
        region: "us-east-2",
        domain: "$($outputs.cognito_domain.value)",
        userPoolId: "$($outputs.cognito_user_pool_id.value)",
        clientId: "$($outputs.cognito_client_id.value)",
        redirectUri: "$($outputs.website_url.value)/checkout.html",
        logoutUri: "$($outputs.website_url.value)/index.html",
        scopes: "openid email phone"
    }
});
"@
[IO.File]::WriteAllText((Join-Path $stage "assets\js\config.js"), $config, [Text.UTF8Encoding]::new($false))

& aws s3 sync $stage "s3://$bucket/" --delete --profile $Profile --region us-east-2
if ($LASTEXITCODE -ne 0) { throw "DR frontend upload failed." }

# Product images are copied read-only from production into the isolated DR bucket.
& aws s3 sync "s3://$ProductionBucket/assets/img/products/" "s3://$bucket/assets/img/products/" --profile $Profile --source-region us-east-1 --region us-east-2
if ($LASTEXITCODE -ne 0) { throw "DR product-image copy failed." }

& aws cloudfront create-invalidation --distribution-id $distribution --paths "/*" --profile $Profile | Out-Null
if ($LASTEXITCODE -ne 0) { throw "DR CloudFront invalidation failed." }
Write-Output "Published isolated DR frontend to $($outputs.website_url.value)"
