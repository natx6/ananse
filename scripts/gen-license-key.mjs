// Offline license key generator — keep this PRIVATE
import crypto from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// Generate or load Ed25519 key pair
let privateKey, publicKey;

if (existsSync("license-private.pem")) {
  privateKey = readFileSync("license-private.pem", "utf-8");
  publicKey = readFileSync("license-public.pem", "utf-8");
  console.log("Keys loaded from existing files.");
} else {
  const pair = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKey = pair.publicKey;
  privateKey = pair.privateKey;
  writeFileSync("license-private.pem", privateKey);
  writeFileSync("license-public.pem", publicKey);
  console.log("Keys generated.");
}

// Show the public key for embedding
const pubStrip = publicKey
  .split("\n")
  .filter((l) => !l.includes("BEGIN") && !l.includes("END") && l.trim())
  .join("");
console.log(`\nPublic key (embed this):\n${pubStrip}\n`);

// Generate a license
const tier = process.argv[2] || "enterprise";
const customer = process.argv[3] || "demo";
const expiry = process.argv[4] || "2027-12-31";
const payload = `${tier}:${customer}:${expiry}`;
const buf = Buffer.from(payload, "utf-8");

// Use the key object's sign method
const keyObj = crypto.createPrivateKey({ key: privateKey, format: "pem", type: "pkcs8" });
const signature = crypto.sign(null, buf, keyObj).toString("base64url");

const license = Buffer.from(`${payload}.${signature}`, "utf-8").toString("base64url");
console.log(`License key for ${tier}/${customer} (expires ${expiry}):\n${license}\n`);

// Verify
const pubKeyObj = crypto.createPublicKey({ key: publicKey, format: "pem", type: "spki" });
const valid = crypto.verify(null, buf, pubKeyObj, Buffer.from(signature, "base64url"));
console.log(`Self-verify: ${valid ? "PASS" : "FAIL"}`);
