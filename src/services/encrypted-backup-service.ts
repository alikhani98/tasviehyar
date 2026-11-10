import { z } from "zod";
import type { BackupEnvelope } from "../domain/backup";
import {
  backupAppIdentifier,
  backupFormatVersion,
  digestBackupEnvelope,
  createBackupEnvelopeWithoutChecksum,
  parseBackupEnvelope,
  validateBackupIntegrity
} from "../domain/backup";
import { TASVIEHYAR_SCHEMA_VERSION } from "../db/tasviehyar-db";

export const encryptedBackupContainerIdentifier = "tasviehyar-encrypted-backup-v1" as const;
export const encryptedBackupContainerVersion = 1 as const;
export const encryptedBackupAlgorithm = "AES-256-GCM" as const;
export const encryptedBackupKeyPrefix = "TYRK1" as const;
export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const AES_256_KEY_BYTES = 32;
export const MAX_ENCRYPTED_BACKUP_BYTES = 32 * 1024 * 1024;

const recoveryKeySchema = z.string().regex(/^TYRK1-[A-Za-z0-9_-]{22}-[A-Za-z0-9_-]{43}$/);

const encryptedBackupContainerSchema = z.object({
  containerIdentifier: z.literal(encryptedBackupContainerIdentifier),
  containerVersion: z.literal(encryptedBackupContainerVersion),
  algorithm: z.literal(encryptedBackupAlgorithm),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  createdAt: z.string().datetime({ offset: true }),
  innerBackupFormat: z.literal(backupAppIdentifier),
  innerBackupFormatVersion: z.literal(backupFormatVersion),
  innerDatabaseSchemaVersion: z.literal(TASVIEHYAR_SCHEMA_VERSION),
  payloadNonce: z.string().regex(/^[A-Za-z0-9_-]+$/),
  wrappedKeyNonce: z.string().regex(/^[A-Za-z0-9_-]+$/),
  wrappedDataEncryptionKey: z.string().regex(/^[A-Za-z0-9_-]+$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/)
}).strict();

export interface RecoveryKey {
  keyId: string;
  value: string;
}

export type EncryptedBackupContainer = z.infer<typeof encryptedBackupContainerSchema>;

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("Web Crypto API is unavailable in this secure context.");
  }

  return globalThis.crypto;
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Encrypted backup encoding is invalid.");
  }

  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytesToBase64Url(bytes) !== value) {
      throw new Error("Noncanonical encoding");
    }
    return bytes;
  } catch {
    throw new Error("Encrypted backup encoding is invalid.");
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

function assertExactLength(bytes: Uint8Array, expected: number, message: string): void {
  if (bytes.byteLength !== expected) {
    throw new Error(message);
  }
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function headerForAad(container: EncryptedBackupContainer): Record<string, unknown> {
  return {
    containerIdentifier: container.containerIdentifier,
    containerVersion: container.containerVersion,
    algorithm: container.algorithm,
    keyId: container.keyId,
    createdAt: container.createdAt,
    innerBackupFormat: container.innerBackupFormat,
    innerBackupFormatVersion: container.innerBackupFormatVersion,
    innerDatabaseSchemaVersion: container.innerDatabaseSchemaVersion,
    payloadNonce: container.payloadNonce,
    wrappedKeyNonce: container.wrappedKeyNonce
  };
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function decodeRecoveryKey(value: string): { keyId: string; bytes: Uint8Array } {
  recoveryKeySchema.parse(value);
  const match = /^TYRK1-([A-Za-z0-9_-]{22})-([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) {
    throw new Error("Recovery Key format is invalid.");
  }
  const [, keyId, encodedBytes] = match;
  const bytes = base64UrlToBytes(encodedBytes!);
  assertExactLength(bytes, AES_256_KEY_BYTES, "Recovery Key must contain exactly 256 bits.");
  return { keyId: keyId!, bytes };
}

export async function importRecoveryKey(value: string): Promise<{ keyId: string; key: CryptoKey }> {
  const decoded = decodeRecoveryKey(value);
  const key = await getCrypto().subtle.importKey(
    "raw",
    bufferSource(decoded.bytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return { keyId: decoded.keyId, key };
}

function parseContainer(text: string): EncryptedBackupContainer {
  if (typeof text !== "string" || text.length === 0 || utf8(text).byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
    throw new Error("Encrypted backup container is missing or too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Encrypted backup container is not valid JSON.");
  }

  const result = encryptedBackupContainerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Encrypted backup container structure is invalid.");
  }

  const container = result.data;
  const payloadNonce = base64UrlToBytes(container.payloadNonce);
  const wrappedKeyNonce = base64UrlToBytes(container.wrappedKeyNonce);
  const wrappedKey = base64UrlToBytes(container.wrappedDataEncryptionKey);
  const ciphertext = base64UrlToBytes(container.ciphertext);
  assertExactLength(payloadNonce, AES_GCM_NONCE_BYTES, "Encrypted backup nonce is invalid.");
  assertExactLength(wrappedKeyNonce, AES_GCM_NONCE_BYTES, "Wrapped-key nonce is invalid.");
  if (wrappedKey.byteLength !== AES_256_KEY_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error("Wrapped data-encryption key is invalid.");
  }
  if (ciphertext.byteLength < AES_GCM_TAG_BYTES) {
    throw new Error("Encrypted backup ciphertext is truncated.");
  }

  return container;
}

function validateInnerBackup(text: string): Promise<BackupEnvelope> {
  let envelope: BackupEnvelope;
  try {
    envelope = parseBackupEnvelope(text);
  } catch {
    throw new Error("Decrypted backup is not a valid Backup Format v1 file.");
  }

  if (envelope.appIdentifier !== backupAppIdentifier || envelope.backupFormatVersion !== backupFormatVersion || envelope.databaseSchemaVersion !== TASVIEHYAR_SCHEMA_VERSION) {
    throw new Error("Decrypted backup format is incompatible.");
  }

  const issues = validateBackupIntegrity({
    parties: envelope.parties,
    destinationAccounts: envelope.destinationAccounts,
    invoices: envelope.invoices,
    paymentInstructions: envelope.paymentInstructions,
    payments: envelope.payments,
    paymentAllocations: envelope.paymentAllocations,
    paymentVerifications: envelope.paymentVerifications,
    auditEvents: envelope.auditEvents
  });
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error("Decrypted backup failed integrity validation.");
  }

  const { checksum: expectedChecksum, applicationVersion, ...data } = envelope;
  const unsignedEnvelope = createBackupEnvelopeWithoutChecksum(data, {
    createdAt: envelope.createdAt,
    databaseSchemaVersion: envelope.databaseSchemaVersion,
    ...(applicationVersion ? { applicationVersion } : {})
  });
  return digestBackupEnvelope(unsignedEnvelope).then((actualChecksum) => {
    if (actualChecksum.value !== expectedChecksum.value || actualChecksum.algorithm !== expectedChecksum.algorithm) {
      throw new Error("Decrypted backup integrity check failed.");
    }
    return envelope;
  });
}

export function generateRecoveryKey(): RecoveryKey {
  const keyBytes = randomBytes(AES_256_KEY_BYTES);
  const keyId = bytesToBase64Url(randomBytes(16));
  return {
    keyId,
    value: `${encryptedBackupKeyPrefix}-${keyId}-${bytesToBase64Url(keyBytes)}`
  };
}

export function parseRecoveryKey(value: string): RecoveryKey {
  const decoded = decodeRecoveryKey(value);
  return { keyId: decoded.keyId, value };
}

export async function encryptBackupText(
  backupText: string,
  recoveryKeyValue: string,
  options: { createdAt?: string } = {}
): Promise<string> {
  await validateInnerBackup(backupText);
  const recovery = await importRecoveryKey(recoveryKeyValue);
  const payloadNonce = randomBytes(AES_GCM_NONCE_BYTES);
  const wrappedKeyNonce = randomBytes(AES_GCM_NONCE_BYTES);
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!z.string().datetime({ offset: true }).safeParse(createdAt).success) {
    throw new Error("Encrypted backup creation time is invalid.");
  }

  const containerBase = {
    containerIdentifier: encryptedBackupContainerIdentifier,
    containerVersion: encryptedBackupContainerVersion,
    algorithm: encryptedBackupAlgorithm,
    keyId: recovery.keyId,
    createdAt,
    innerBackupFormat: backupAppIdentifier,
    innerBackupFormatVersion: backupFormatVersion,
    innerDatabaseSchemaVersion: TASVIEHYAR_SCHEMA_VERSION,
    payloadNonce: bytesToBase64Url(payloadNonce),
    wrappedKeyNonce: bytesToBase64Url(wrappedKeyNonce)
  } as const;
  const aad = utf8(canonicalJson(containerBase));
  const crypto = getCrypto();
  const dekBytes = randomBytes(AES_256_KEY_BYTES);
  const dek = await crypto.subtle.importKey(
    "raw",
    bufferSource(dekBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const wrappedDataEncryptionKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(wrappedKeyNonce), additionalData: bufferSource(aad), tagLength: 128 },
    recovery.key,
    bufferSource(dekBytes)
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(payloadNonce), additionalData: bufferSource(aad), tagLength: 128 },
    dek,
    bufferSource(utf8(backupText))
  );
  const container: EncryptedBackupContainer = {
    ...containerBase,
    wrappedDataEncryptionKey: bytesToBase64Url(wrappedDataEncryptionKey),
    ciphertext: bytesToBase64Url(ciphertext)
  };
  return JSON.stringify(container);
}

export async function decryptBackupText(backupText: string, recoveryKeyValue: string): Promise<BackupEnvelope> {
  const container = parseContainer(backupText);
  const recovery = await importRecoveryKey(recoveryKeyValue);
  if (recovery.keyId !== container.keyId) {
    throw new Error("Recovery Key does not match this encrypted backup.");
  }

  const crypto = getCrypto();
  const aad = utf8(canonicalJson(headerForAad(container)));
  try {
    const dekBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(base64UrlToBytes(container.wrappedKeyNonce)), additionalData: bufferSource(aad), tagLength: 128 },
      recovery.key,
      bufferSource(base64UrlToBytes(container.wrappedDataEncryptionKey))
    ));
    assertExactLength(dekBytes, AES_256_KEY_BYTES, "Wrapped data-encryption key is invalid.");
    const dek = await crypto.subtle.importKey(
      "raw",
      bufferSource(dekBytes),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(base64UrlToBytes(container.payloadNonce)), additionalData: bufferSource(aad), tagLength: 128 },
      dek,
      bufferSource(base64UrlToBytes(container.ciphertext))
    );
    return await validateInnerBackup(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Encrypted backup authentication or decryption failed.");
  }
}

export function inspectEncryptedBackupContainer(text: string): EncryptedBackupContainer {
  return parseContainer(text);
}
