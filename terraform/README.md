# Despliegue Automatizado en AWS (EC2 + Amazon RDS PostgreSQL) con Terraform

Esta carpeta aprovisiona e inicializa automáticamente toda la infraestructura Cloud en AWS cumpliendo con el almacenamiento en nube en **Amazon RDS**:
- **Amazon RDS PostgreSQL (`db.t3.micro`, 20 GiB):** base de datos administrada privada dentro de la VPC (`publicly_accessible = false`), accesible **únicamente** desde el Security Group de la instancia EC2 en el puerto `5432`.
- **Instancia EC2 Ubuntu 24.04 LTS (`t3.small`, 20 GiB gp3 + 2 GB swap):** ejecuta `mosquitto`, `api` (NestJS conectado a RDS vía TLS) y `web` (Next.js) sin usar Postgres local.
- **Security Groups:** puertos `22` (SSH), `3000` (Web Next.js) y `3001` (API + Sync cifrado desde la Raspberry Pi 5).

---

## Requisitos
1. [Terraform >= 1.5](https://developer.hashicorp.com/terraform/install) (en Windows: `winget install Hashicorp.Terraform`).
2. Credenciales temporales o IAM de AWS cargadas en tu terminal (por ejemplo, en **AWS Academy → AWS Details → Show**):
   ```powershell
   $env:AWS_ACCESS_KEY_ID="ASIA..."
   $env:AWS_SECRET_ACCESS_KEY="..."
   $env:AWS_SESSION_TOKEN="..."
   $env:AWS_DEFAULT_REGION="us-east-1"
   ```

---

## Uso rápido

```powershell
cd terraform
terraform init
terraform apply
```

Confirma escribiendo `yes`. La creación del RDS toma ~4–6 minutos y luego la EC2 ejecuta automáticamente `prisma db push` contra el RDS para crear todas las tablas y el usuario administrador semilla.

### Ver URLs, endpoint RDS y secretos generados
```powershell
terraform output
terraform output -raw admin_password
terraform output -raw gateway_secret
```

*(Para ver el log de inicialización dentro de la EC2: `ssh -i labsuser.pem ubuntu@<EC2_IP> "sudo tail -f /var/log/florasense-init.log"`.)*

### Conectar tu Raspberry Pi 5 a la EC2 recién creada
Usa `ec2_public_ip` y `gateway_secret` de Terraform en tu Raspberry Pi 5:
```bash
cd ~/IoT-Grupal/FloraSense-IoT/gateway
bash setup_rpi5.sh <EC2_PUBLIC_IP> <GATEWAY_SECRET> auto
```

### Apagar y eliminar EC2 + RDS de AWS
```powershell
terraform destroy
```
