output "source_backup_vault" { value = aws_backup_vault.source.name }
output "destination_backup_vault" { value = aws_backup_vault.destination.name }
output "destination_backup_vault_arn" { value = aws_backup_vault.destination.arn }
output "backup_role_arn" { value = aws_iam_role.backup.arn }
