const DEFAULT_OWN_DEVICE_KEYS = ['INVERNADERO_1'];

/**
 * Determines whether a registered device belongs to the local owner and may receive actuator commands.
 */
export function isControllableDevice(deviceKey?: string | null): boolean {
  if (!deviceKey) return false;
  const raw = process.env.OWN_DEVICE_KEYS;
  const allowedKeys = (raw ? raw.split(',') : DEFAULT_OWN_DEVICE_KEYS)
    .map((key) => key.trim().toUpperCase())
    .filter(Boolean);
  return allowedKeys.includes(deviceKey.trim().toUpperCase());
}
