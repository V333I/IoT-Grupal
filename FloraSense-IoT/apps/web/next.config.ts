import type { NextConfig } from "next";

const dynamicDevOrigins: string[] = [
  "localhost",
  "localhost:3000",
  "127.0.0.1",
  "127.0.0.1:3000",
  "192.168.1.7",
  "192.168.1.7:3000",
  "54.224.172.65",
  "54.224.172.65:3000",
  "*",
  "*:3000",
];

if (process.env.NEXT_PUBLIC_API_URL) {
  try {
    const parsedHost = new URL(process.env.NEXT_PUBLIC_API_URL).hostname;
    if (parsedHost) {
      dynamicDevOrigins.push(parsedHost, `${parsedHost}:3000`);
    }
  } catch {}
}

if (process.env.ALLOWED_DEV_ORIGINS) {
  for (const origin of process.env.ALLOWED_DEV_ORIGINS.split(",")) {
    const trimmed = origin.trim();
    if (trimmed) dynamicDevOrigins.push(trimmed);
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: Array.from(new Set(dynamicDevOrigins)),
};

export default nextConfig;
