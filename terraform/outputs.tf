output "ec2_public_ip" {
  description = "IP publica de la instancia EC2 creada"
  value       = aws_instance.florasense_ec2.public_ip
}

output "rds_endpoint" {
  description = "Endpoint privado de Amazon RDS PostgreSQL en la nube"
  value       = aws_db_instance.florasense_rds.endpoint
}

output "rds_database_name" {
  description = "Nombre de la base de datos en RDS"
  value       = aws_db_instance.florasense_rds.db_name
}

output "web_url" {
  description = "URL del dashboard web FloraSense"
  value       = "http://${aws_instance.florasense_ec2.public_ip}:3000"
}

output "api_gateway_status_url" {
  description = "Endpoint para verificar el estado de API + Gateway RPi5"
  value       = "http://${aws_instance.florasense_ec2.public_ip}:3001/api/gateway/status"
}

output "admin_email" {
  description = "Correo del usuario administrador semilla"
  value       = var.admin_email
}

output "admin_password" {
  description = "Contrasena generada/configurada para el usuario web (ver con: terraform output -raw admin_password)"
  value       = local.adm_pass
  sensitive   = true
}

output "gateway_secret" {
  description = "GATEWAY_SECRET generado/configurado (ver con: terraform output -raw gateway_secret)"
  value       = local.gw_sec
  sensitive   = true
}

output "postgres_password" {
  description = "Contrasena maestra de Amazon RDS (ver con: terraform output -raw postgres_password)"
  value       = local.pg_pass
  sensitive   = true
}
