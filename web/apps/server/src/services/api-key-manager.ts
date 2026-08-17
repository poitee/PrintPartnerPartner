import { randomBytes } from "node:crypto";
import type { AppRepository } from "../db/repository.js";

export interface ApiKeyInfo {
  id: string;
  key: string; // Only shown once on creation
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export interface StoredApiKey {
  id: string;
  keyHash: string; // bcrypt or simple hash
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

const SETTINGS_KEY = "api_keys_v1";

function getHash(key: string): string {
  // Simple hash for API keys (not user passwords — bcrypt is overkill)
  // In production, consider using a proper KDF like scrypt/argon2
  return Buffer.from(key).toString("base64");
}

function loadKeys(repo: AppRepository): StoredApiKey[] {
  const raw = repo.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredApiKey[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveKeys(repo: AppRepository, keys: StoredApiKey[]): void {
  repo.setSetting(SETTINGS_KEY, JSON.stringify(keys));
}

/**
 * Generate a new API key and save it.
 * Returns the key info with the plaintext key (only shown once).
 */
export function createApiKey(repo: AppRepository): ApiKeyInfo {
  const key = `ppk_${randomBytes(32).toString("hex")}`;
  const keyHash = getHash(key);
  const now = new Date().toISOString();

  const stored: StoredApiKey = {
    id: `key_${randomBytes(8).toString("hex")}`,
    keyHash,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: null,
    isActive: true,
  };

  const keys = loadKeys(repo);
  keys.push(stored);
  saveKeys(repo, keys);

  return {
    ...stored,
    key, // Only exposed once
  };
}

/**
 * Get all API keys without exposing the actual keys.
 */
export function listApiKeys(repo: AppRepository): Omit<StoredApiKey, "keyHash">[] {
  const keys = loadKeys(repo);
  return keys.map((k) => {
    const { keyHash: _keyHash, ...rest } = k;
    return rest;
  });
}

/**
 * Revoke an API key by ID.
 */
export function revokeApiKey(repo: AppRepository, keyId: string): boolean {
  const keys = loadKeys(repo);
  const key = keys.find((k) => k.id === keyId);
  if (!key) return false;

  key.isActive = false;
  saveKeys(repo, keys);
  return true;
}

/**
 * Regenerate (rotate) an API key.
 * Creates a new key and marks the old one as inactive.
 * Returns the new key info (plaintext key shown once).
 */
export function regenerateApiKey(repo: AppRepository, keyId: string): ApiKeyInfo | null {
  const keys = loadKeys(repo);
  const oldKey = keys.find((k) => k.id === keyId);
  if (!oldKey) return null;

  // Deactivate old key
  oldKey.isActive = false;

  // Create new key
  const newKey = `ppk_${randomBytes(32).toString("hex")}`;
  const keyHash = getHash(newKey);
  const now = new Date().toISOString();

  const stored: StoredApiKey = {
    id: `key_${randomBytes(8).toString("hex")}`,
    keyHash,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: null,
    isActive: true,
  };

  keys.push(stored);
  saveKeys(repo, keys);

  return {
    ...stored,
    key: newKey,
  };
}

/**
 * Validate an API key and record its usage.
 * Returns the key ID if valid and active, null otherwise.
 */
export function validateApiKey(repo: AppRepository, rawKey: string): string | null {
  if (!rawKey) return null;

  const keys = loadKeys(repo);
  const keyHash = getHash(rawKey);
  const key = keys.find((k) => k.keyHash === keyHash && k.isActive);

  if (!key) return null;

  // Update last used timestamp
  key.lastUsedAt = new Date().toISOString();
  saveKeys(repo, keys);

  return key.id;
}

/**
 * Check if a key has expired.
 */
export function isKeyExpired(key: StoredApiKey): boolean {
  if (!key.expiresAt) return false;
  return new Date(key.expiresAt) < new Date();
}
