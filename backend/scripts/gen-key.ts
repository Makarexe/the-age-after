// Prints a new RSA-4096 private key (PKCS#8 PEM) for SIGNING_PRIVATE_KEY.
// Generate it once for production and keep it: changing it breaks skins until the MC server restarts.
import { generatePrivateKeyPem } from '../src/lib/signing.js';

process.stdout.write(generatePrivateKeyPem(4096));
