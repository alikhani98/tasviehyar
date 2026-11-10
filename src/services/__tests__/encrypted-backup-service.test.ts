import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decryptBackupText,
  encryptBackupText,
  generateRecoveryKey,
  importRecoveryKey,
  inspectEncryptedBackupContainer,
  parseRecoveryKey
} from "../encrypted-backup-service";

const demoBackup = readFileSync("demo/tasviehyar-demo-backup-v1.json", "utf8");

function mutateContainer(text: string, mutate: (container: Record<string, unknown>) => void): string {
  const container = JSON.parse(text) as Record<string, unknown>;
  mutate(container);
  return JSON.stringify(container);
}

describe("encrypted backup service", () => {
  it("generates independent, parseable 256-bit recovery keys", () => {
    const first = generateRecoveryKey();
    const second = generateRecoveryKey();

    expect(first.value).toMatch(/^TYRK1-[A-Za-z0-9_-]{22}-[A-Za-z0-9_-]{43}$/);
    expect(second.value).toMatch(/^TYRK1-[A-Za-z0-9_-]{22}-[A-Za-z0-9_-]{43}$/);
    expect(first.value).not.toBe(second.value);
    expect(parseRecoveryKey(first.value)).toEqual(first);
    expect(parseRecoveryKey(second.value)).toEqual(second);
  });

  it("imports the recovery key as a non-extractable AES-GCM key with supported usages", async () => {
    const recoveryKey = generateRecoveryKey();
    const imported = await importRecoveryKey(recoveryKey.value);

    expect(imported.keyId).toBe(recoveryKey.keyId);
    expect(imported.key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(imported.key.extractable).toBe(false);
    expect(imported.key.usages).toEqual(["encrypt", "decrypt"]);
  });

  it("rejects malformed and incorrectly sized recovery keys", () => {
    expect(() => parseRecoveryKey("TYRK1-invalid")).toThrow();
    expect(() => parseRecoveryKey("TYRK1-abcdefghijklmnopqrstuv-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
      .toThrow();
    const recoveryKey = generateRecoveryKey();
    const noncanonical = `${recoveryKey.value.slice(0, -1)}B`;
    expect(() => parseRecoveryKey(noncanonical)).toThrow();
  });

  it("encrypts and decrypts a Backup Format v1 payload without touching IndexedDB", async () => {
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackup, recoveryKey.value, { createdAt: "2026-11-08T08:00:00.000Z" });
    const container = inspectEncryptedBackupContainer(encrypted);
    const decrypted = await decryptBackupText(encrypted, recoveryKey.value);

    expect(container.containerIdentifier).toBe("tasviehyar-encrypted-backup-v1");
    expect(container.containerVersion).toBe(1);
    expect(container.algorithm).toBe("AES-256-GCM");
    expect(container.keyId).toBe(recoveryKey.keyId);
    expect(container.innerBackupFormatVersion).toBe(1);
    expect(container.innerDatabaseSchemaVersion).toBe(3);
    expect(decrypted).toEqual(JSON.parse(demoBackup));
  });

  it("rejects an invalid inner Backup Format v1 payload before encryption", async () => {
    await expect(encryptBackupText("{}", generateRecoveryKey().value)).rejects.toThrow("Backup Format v1");
  });

  it("rejects a wrong recovery key", async () => {
    const encrypted = await encryptBackupText(demoBackup, generateRecoveryKey().value);
    await expect(decryptBackupText(encrypted, generateRecoveryKey().value)).rejects.toThrow("does not match");
  });

  it("rejects a validly shaped but wrong key identifier", async () => {
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackup, recoveryKey.value);
    const otherKeyId = generateRecoveryKey().keyId;
    await expect(decryptBackupText(mutateContainer(encrypted, (container) => { container.keyId = otherKeyId; }), recoveryKey.value))
      .rejects.toThrow("does not match");
  });

  it.each([
    ["ciphertext", (container: Record<string, unknown>) => { container.ciphertext = `A${String(container.ciphertext).slice(1)}`; }],
    ["wrapped DEK", (container: Record<string, unknown>) => { container.wrappedDataEncryptionKey = `${String(container.wrappedDataEncryptionKey).slice(0, -1)}A`; }],
    ["payload nonce", (container: Record<string, unknown>) => { container.payloadNonce = "AAAAAAAAAAAAAAAA"; }],
    ["wrapping nonce", (container: Record<string, unknown>) => { container.wrappedKeyNonce = "AAAAAAAAAAAAAAAA"; }],
    ["authenticated metadata", (container: Record<string, unknown>) => { container.createdAt = "2026-11-09T08:00:00.000Z"; }]
  ])("rejects modified %s", async (_label, mutate) => {
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackup, recoveryKey.value);
    await expect(decryptBackupText(mutateContainer(encrypted, mutate), recoveryKey.value))
      .rejects.toThrow("authentication or decryption failed");
  });

  it("rejects truncated, malformed, unknown-version, unknown-algorithm, and unknown-field containers", async () => {
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackup, recoveryKey.value);

    await expect(decryptBackupText(encrypted.slice(0, -10), recoveryKey.value)).rejects.toThrow();
    await expect(decryptBackupText("{", recoveryKey.value)).rejects.toThrow("not valid JSON");
    await expect(decryptBackupText(mutateContainer(encrypted, (container) => { container.ciphertext = `${String(container.ciphertext)}*`; }), recoveryKey.value))
      .rejects.toThrow("structure is invalid");
    await expect(decryptBackupText(mutateContainer(encrypted, (container) => { container.containerVersion = 99; }), recoveryKey.value))
      .rejects.toThrow("structure is invalid");
    await expect(decryptBackupText(mutateContainer(encrypted, (container) => { container.algorithm = "AES-128-GCM"; }), recoveryKey.value))
      .rejects.toThrow("structure is invalid");
    await expect(decryptBackupText(mutateContainer(encrypted, (container) => { container.unexpected = true; }), recoveryKey.value))
      .rejects.toThrow("structure is invalid");
  });

  it("does not expose plaintext or key material in cryptographic failure messages", async () => {
    const recoveryKey = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackup, recoveryKey.value);
    const changed = mutateContainer(encrypted, (container) => { container.ciphertext = `A${String(container.ciphertext).slice(1)}`; });

    try {
      await decryptBackupText(changed, recoveryKey.value);
      throw new Error("Expected decryption to fail.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Encrypted backup authentication or decryption failed.");
      expect(message).not.toContain(recoveryKey.value);
      expect(message).not.toContain("زارع");
    }
  });
});
