import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) {
    return false;
  }
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(encoded, "base64url");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
