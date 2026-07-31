[CmdletBinding()]
param([string]$Profile = "CAA900")

$ErrorActionPreference = "Stop"
$evidence = Join-Path $PSScriptRoot "..\evidence"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$audit = [ordered]@{}

$identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($identity.Account -ne "563960656220") { throw "Unexpected AWS account $($identity.Account)." }

$audit.DrTables = @((aws dynamodb list-tables --region us-east-2 --profile $Profile --query "TableNames[?contains(@, 'Ecommerce-DR') || contains(@, 'OrderIdempotency-DR')]" --output json | ConvertFrom-Json))
$audit.DrLambdas = @((aws lambda list-functions --region us-east-2 --profile $Profile --query "Functions[?starts_with(FunctionName, 'bmazon-dr-')].FunctionName" --output json | ConvertFrom-Json))
$audit.DrApis = @((aws apigatewayv2 get-apis --region us-east-2 --profile $Profile --query "Items[?starts_with(Name, 'bmazon-dr')].Name" --output json | ConvertFrom-Json))
$audit.DrUserPools = @((aws cognito-idp list-user-pools --max-results 60 --region us-east-2 --profile $Profile --query "UserPools[?starts_with(Name, 'bmazon-dr')].Name" --output json | ConvertFrom-Json))
$audit.DrSecrets = @((aws secretsmanager list-secrets --region us-east-2 --profile $Profile --query "SecretList[?starts_with(Name, 'bmazon-dr')].Name" --output json | ConvertFrom-Json))
$audit.DrTopics = @((aws sns list-topics --region us-east-2 --profile $Profile --query "Topics[?contains(TopicArn, 'bmazon-dr')].TopicArn" --output json | ConvertFrom-Json))
$audit.DrBuckets = @((aws s3api list-buckets --profile $Profile --query "Buckets[?starts_with(Name, 'bmazon-dr-')].Name" --output json | ConvertFrom-Json))
$audit.DrRoles = @((aws iam list-roles --profile $Profile --query "Roles[?starts_with(RoleName, 'bmazon-dr-')].RoleName" --output json | ConvertFrom-Json))
$audit.DrDistributions = @((aws cloudfront list-distributions --profile $Profile --query "DistributionList.Items[?contains(Comment, 'Bmazon disaster recovery') || contains(Comment, 'Bmazon DR')].Id" --output json | ConvertFrom-Json))
$audit.SourceVaults = @((aws backup list-backup-vaults --region us-east-1 --profile $Profile --query "BackupVaultList[?starts_with(BackupVaultName, 'bmazon-dr')].BackupVaultName" --output json | ConvertFrom-Json))
$audit.DestinationVaults = @((aws backup list-backup-vaults --region us-east-2 --profile $Profile --query "BackupVaultList[?starts_with(BackupVaultName, 'bmazon-dr')].BackupVaultName" --output json | ConvertFrom-Json))

$zone = aws route53 list-hosted-zones-by-name --dns-name ezei.shop --profile $Profile --query "HostedZones[?Name=='ezei.shop.']|[0].Id" --output text
$records = aws route53 list-resource-record-sets --hosted-zone-id $zone --profile $Profile --query "ResourceRecordSets[?Name=='dr.ezei.shop.' || Name=='api.dr.ezei.shop.'].{Name:Name,Type:Type}" --output json | ConvertFrom-Json
$audit.DrDnsRecords = @($records)

$path = Join-Path $evidence "cleanup-audit.json"
$audit | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $path
$count = 0
foreach ($entry in $audit.GetEnumerator()) { $count += @($entry.Value).Count }

if ($count -gt 0) {
  $audit | ConvertTo-Json -Depth 8
  throw "DR cleanup audit found $count residual resources. See $path"
}

Write-Output "DR cleanup audit passed: no Bmazon DR resources remain."
Write-Output "Evidence: $path"
