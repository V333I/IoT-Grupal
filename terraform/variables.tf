variable "aws_region" {
  description = "Region de AWS donde desplegar (AWS Academy suele usar us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefijo para nombrar EC2, RDS y Security Groups en AWS"
  type        = string
  default     = "florasense-iot-grupal"
}

variable "instance_type" {
  description = "Tipo de instancia EC2 (t3.small recomendado para Docker + Next + Nest)"
  type        = string
  default     = "t3.small"
}

variable "ebs_volume_gb" {
  description = "Tamano del disco raiz EBS de EC2 en GiB (20 GiB evita errores de espacio en Docker)"
  type        = number
  default     = 20
}

variable "rds_engine_version" {
  description = "Version mayor de PostgreSQL en Amazon RDS"
  type        = string
  default     = "16"
}

variable "rds_instance_class" {
  description = "Clase de instancia Amazon RDS (db.t3.micro compatible con Free Tier y AWS Academy)"
  type        = string
  default     = "db.t3.micro"
}

variable "rds_allocated_storage" {
  description = "Almacenamiento en GiB para Amazon RDS PostgreSQL"
  type        = number
  default     = 20
}

variable "allowed_ssh_cidr" {
  description = "CIDR permitido para SSH puerto 22 (restringe a TU_IP/32 en produccion)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "existing_key_name" {
  description = "Nombre de un Key Pair ya existente en EC2 (ej. vockey en AWS Academy)"
  type        = string
  default     = "vockey"
}

variable "ssh_public_key" {
  description = "Opcional: clave publica SSH propia (si se define, crea un aws_key_pair nuevo)"
  type        = string
  default     = ""
}

variable "repo_url" {
  description = "URL del repositorio Git a clonar automaticamente en la EC2"
  type        = string
  default     = "https://github.com/V333I/IoT-Grupal.git"
}

variable "postgres_user" {
  type    = string
  default = "postgres"
}

variable "postgres_db" {
  type    = string
  default = "smart_irrigation"
}

variable "postgres_password" {
  description = "Opcional: clave maestra de Amazon RDS (si queda vacia, Terraform genera una aleatoria)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "jwt_secret" {
  description = "Opcional: secreto JWT (si queda vacio, Terraform genera uno aleatorio)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "gateway_secret" {
  description = "Opcional: secreto compartido RPi5 <-> AWS (si queda vacio, se autogenera)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "admin_name" {
  type    = string
  default = "Administrador IoT"
}

variable "admin_email" {
  type    = string
  default = "admin@florasense.local"
}

variable "admin_password" {
  description = "Opcional: clave inicial admin web (si queda vacia, se autogenera)"
  type        = string
  sensitive   = true
  default     = ""
}
