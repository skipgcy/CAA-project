terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "aws" {
  region = var.primary_region
  default_tags { tags = local.dr_tags }
}

provider "aws" {
  alias  = "primary"
  region = var.primary_region
  default_tags { tags = local.dr_tags }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags { tags = local.dr_tags }
}

locals {
  dr_tags = {
    Project     = "CAA900-Bmazon"
    Environment = "DR"
    Temporary   = "true"
    ManagedBy   = "Terraform-DR"
  }
}
