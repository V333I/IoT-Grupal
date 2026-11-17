terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "random_password" "postgres" {
  length  = 24
  special = false
}

resource "random_password" "jwt" {
  length  = 40
  special = false
}

resource "random_password" "gateway" {
  length  = 36
  special = false
}

resource "random_password" "admin" {
  length  = 16
  special = false
}

locals {
  pg_pass     = var.postgres_password != "" ? var.postgres_password : random_password.postgres.result
  jwt_sec     = var.jwt_secret != "" ? var.jwt_secret : random_password.jwt.result
  gw_sec      = var.gateway_secret != "" ? var.gateway_secret : random_password.gateway.result
  adm_pass    = var.admin_password != "" ? var.admin_password : random_password.admin.result
  use_keypair = var.ssh_public_key != ""
}

resource "aws_key_pair" "deployer" {
  count      = local.use_keypair ? 1 : 0
  key_name   = "${var.project_name}-deployer-key"
  public_key = var.ssh_public_key
}

resource "aws_security_group" "florasense_sg" {
  name        = "${var.project_name}-sg"
  description = "Puertos HTTP/API/SSH para FloraSense IoT Grupal"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  ingress {
    description = "Frontend Web Next.js"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Backend API NestJS + Sync cifrado RPi5"
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Trafico saliente"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}

resource "aws_instance" "florasense_ec2" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  vpc_security_group_ids      = [aws_security_group.florasense_sg.id]
  associate_public_ip_address = true
  key_name                    = local.use_keypair ? aws_key_pair.deployer[0].key_name : (var.existing_key_name != "" ? var.existing_key_name : null)
  user_data_replace_on_change = true

  root_block_device {
    volume_size           = var.ebs_volume_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url       = var.repo_url
    postgres_user  = var.postgres_user
    postgres_pass  = local.pg_pass
    postgres_db    = var.postgres_db
    jwt_secret     = local.jwt_sec
    gateway_secret = local.gw_sec
    admin_name     = var.admin_name
    admin_email    = var.admin_email
    admin_pass     = local.adm_pass
  })

  tags = {
    Name    = "${var.project_name}-ec2"
    Project = var.project_name
  }
}
