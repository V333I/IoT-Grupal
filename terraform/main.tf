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

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
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

# Security Group de la instancia EC2 (Web + API + SSH)
resource "aws_security_group" "florasense_sg" {
  name        = "${var.project_name}-ec2-sg"
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
    Name    = "${var.project_name}-ec2-sg"
    Project = var.project_name
  }
}

# Security Group privado para Amazon RDS PostgreSQL (solo acepta trafico desde la EC2)
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "Acceso PostgreSQL unicamente desde la instancia EC2 de FloraSense"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "PostgreSQL desde EC2 FloraSense"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.florasense_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-rds-sg"
    Project = var.project_name
  }
}

resource "aws_db_subnet_group" "rds_subnets" {
  name       = "${var.project_name}-rds-subnets"
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name    = "${var.project_name}-rds-subnets"
    Project = var.project_name
  }
}

# Base de datos administrada en la nube: Amazon RDS PostgreSQL
resource "aws_db_instance" "florasense_rds" {
  identifier              = "${var.project_name}-db"
  engine                  = "postgres"
  engine_version          = var.rds_engine_version
  instance_class          = var.rds_instance_class
  allocated_storage       = var.rds_allocated_storage
  storage_type            = "gp2"
  db_name                 = var.postgres_db
  username                = var.postgres_user
  password                = local.pg_pass
  db_subnet_group_name    = aws_db_subnet_group.rds_subnets.name
  vpc_security_group_ids  = [aws_security_group.rds_sg.id]
  publicly_accessible     = false
  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false

  tags = {
    Name    = "${var.project_name}-rds"
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
    database_url   = "postgresql://${var.postgres_user}:${local.pg_pass}@${aws_db_instance.florasense_rds.address}:${aws_db_instance.florasense_rds.port}/${var.postgres_db}?schema=public&sslmode=require&sslaccept=accept_invalid_certs"
    jwt_secret     = local.jwt_sec
    gateway_secret = local.gw_sec
    admin_name     = var.admin_name
    admin_email    = var.admin_email
    admin_pass     = local.adm_pass
  })

  depends_on = [aws_db_instance.florasense_rds]

  tags = {
    Name    = "${var.project_name}-ec2"
    Project = var.project_name
  }
}
