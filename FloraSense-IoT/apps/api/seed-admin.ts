import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@florasense.local';
  const password = process.env.ADMIN_PASSWORD || 'change-me-admin-password';

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.log('El usuario administrador ya existe.');
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME || 'Administrador FloraSense',
      email: email,
      passwordHash: passwordHash,
      role: 'ADMIN',
    },
  });

  console.log('✅ Usuario semilla (Admin) creado correctamente.');
  console.log(`Email: ${email}`);
  console.log('Contraseña encriptada exitosamente.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
