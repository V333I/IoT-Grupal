# Despliegue Automatizado en AWS EC2 con Terraform

Esta carpeta aprovisiona e inicializa automáticamente toda la infraestructura en AWS EC2:
- **Security Group** con puertos `22` (SSH), `3000` (Web Next.js) y `3001` (API NestJS + Sync RPi 5).
- **Instancia EC2 Ubuntu 24.04 LTS** (`t3.small` por defecto) con **20 GiB gp3** (evita errores de disco lleno en Docker) y 2 GB de swap.
- **Instalación y arranque automático (`cloud-init`):** instala Docker, clona `IoT-Grupal`, genera un `.env` seguro con contraseñas aleatorias y levanta `postgres`, `mosquitto`, `api` y `web`.

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

Confirma escribiendo `yes`. Luego espera ~3–4 minutos mientras `cloud-init` termina el `docker compose up -d --build`.

### Ver URLs y secretos generados (sensibles)
```powershell
terraform output
terraform output -raw admin_password
terraform output -raw gateway_secret
```

*(Para verificar el avance de instalación dentro de la EC2: `ssh -i labsuser.pem ubuntu@<EC2_IP> "sudo tail -f /var/log/florasense-init.log"`.)*

### Conectar tu Raspberry Pi 5 a la EC2 recién creada
Usa la IP pública (`ec2_public_ip`) y el secreto (`terraform output -raw gateway_secret`) en tu Raspberry Pi 5:
```bash
cd ~/IoT-Grupal/FloraSense-IoT/gateway
bash setup_rpi5.sh <EC2_PUBLIC_IP> <GATEWAY_SECRET> auto
```

### Apagar y eliminar toda la infraestructura de AWS
```powershell
terraform destroy
```
