import { describe, expect, it } from "vitest";
import { createSecretCrypto, ENVELOPE_VERSION } from "../src/shared/secret-crypto.js";
import { redactSecrets } from "../src/shared/redact.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("secret-crypto", () => {
  it("往返加解密保真", () => {
    const crypto = createSecretCrypto({ masterKeyBase64: KEY_A, keyId: "k1" });
    const envelope = crypto.encrypt("sk-super-secret");
    expect(crypto.decrypt(envelope)).toBe("sk-super-secret");
  });

  it("信封格式 v1:keyId:iv:ct，keyId 明文可见（支撑轮换选钥）", () => {
    const crypto = createSecretCrypto({ masterKeyBase64: KEY_A, keyId: "k7" });
    const parts = crypto.encrypt("x").split(":");
    expect(parts[0]).toBe(ENVELOPE_VERSION);
    expect(parts[1]).toBe("k7");
    expect(Buffer.from(parts[2], "base64url").length).toBe(12);
  });

  it("同一明文两次加密 IV 不同（同钥 IV 复用红线）", () => {
    const crypto = createSecretCrypto({ masterKeyBase64: KEY_A });
    expect(crypto.encrypt("same")).not.toBe(crypto.encrypt("same"));
  });

  it("密文被篡改时 GCM 校验失败抛错", () => {
    const crypto = createSecretCrypto({ masterKeyBase64: KEY_A });
    const envelope = crypto.encrypt("plain");
    const parts = envelope.split(":");
    parts[3] = Buffer.from("tampered-ciphertext-and-tag-xx").toString("base64url");
    expect(() => crypto.decrypt(parts.join(":"))).toThrow();
  });

  it("换主密钥解不开旧密文", () => {
    const a = createSecretCrypto({ masterKeyBase64: KEY_A });
    const b = createSecretCrypto({ masterKeyBase64: KEY_B });
    expect(() => b.decrypt(a.encrypt("plain"))).toThrow();
  });

  it("拒绝非 32 字节主密钥", () => {
    expect(() => createSecretCrypto({ masterKeyBase64: Buffer.alloc(16).toString("base64") })).toThrow(/32/);
  });

  it("非法信封结构抛错", () => {
    const crypto = createSecretCrypto({ masterKeyBase64: KEY_A });
    expect(() => crypto.decrypt("v2:k1:aa:bb")).toThrow(/格式/);
    expect(() => crypto.decrypt("nonsense")).toThrow(/格式/);
  });
});

describe("redactSecrets", () => {
  it("逐一替换密钥明文并截断", () => {
    const out = redactSecrets("err key=sk-abc tail", ["sk-abc"]);
    expect(out).toBe("err key=[redacted] tail");
  });

  it("忽略空密钥，长文本截断到 500", () => {
    expect(redactSecrets("keep", ["", null, undefined])).toBe("keep");
    expect(redactSecrets("x".repeat(1000), []).length).toBe(500);
  });
});
