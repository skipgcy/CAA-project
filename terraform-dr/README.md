# Bmazon Disaster Recovery Environment

This directory is intentionally separate from the production Terraform representation. It creates a temporary, isolated recovery environment while leaving the `us-east-1` Bmazon application unchanged.

## Safety boundaries

- Application region: `us-east-2` only.
- Production resources are never imported into either DR state.
- Production DNS records (`ezei.shop`, `www.ezei.shop`, and `api.ezei.shop`) are never managed here.
- Only the isolated records `dr.ezei.shop` and `api.dr.ezei.shop` are created.
- The production `Ecommerce` table is read only by a one-time on-demand AWS Backup job. No scheduled backup selection is attached to it.
- The restored table is named `Ecommerce-DR` and is created by an AWS Backup restore job.
- `bootstrap` and `application` use separate local Terraform states.
- Every created resource uses a `Bmazon-DR` name or DR tags.

## Recovery sequence

1. Apply `bootstrap` to create two temporary backup vaults and the temporary AWS Backup role. It does not change the production table configuration.
2. Run `scripts/backup-copy-restore.ps1` to back up `Ecommerce`, copy the recovery point to `us-east-2`, and restore it as `Ecommerce-DR`.
3. Apply `application` to recreate the website, API, Lambda functions, Cognito, notifications, and supporting services in `us-east-2`.
4. Copy the Stripe test secret without printing it, publish the frontend with the generated DR configuration, and verify the SES sender.
5. Run automated and manual validation and retain the evidence files.

## Destruction sequence

1. Destroy `application` with Terraform.
2. Empty and remove any residual versions from the DR S3 bucket if required.
3. Delete `Ecommerce-DR` after the application stack is gone.
4. Delete the one-time recovery points from both temporary backup vaults.
5. Destroy `bootstrap` with Terraform.
6. Run `scripts/audit-cleanup.ps1`; it must report no DR resources.
7. Re-run production smoke tests against `https://ezei.shop`.

Never run commands from this directory without `-var-file=../dr.tfvars` and profile `CAA900`.
