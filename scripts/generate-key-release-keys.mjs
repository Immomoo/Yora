const pair = await crypto.subtle.generateKey(
  {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["encrypt", "decrypt"],
);

const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");

console.log("VITE_YORA_KEY_RELEASE_PUBLIC_KEY=");
console.log(publicKey);
console.log("");
console.log("YORA_KEY_RELEASE_PRIVATE_KEY=");
console.log(privateKey);
console.log("");
console.log("Store the private key only as a server-side Vercel environment variable.");
