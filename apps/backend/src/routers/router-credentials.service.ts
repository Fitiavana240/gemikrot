import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface RouterCredentials {
  username: string;
  password: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Chiffre les identifiants RouterOS stockés dans `Router.credentialsEncrypted`
 * (Section 35 : ils ne doivent jamais transiter en clair ni être exposés au
 * navigateur). Format persisté : `iv.authTag.ciphertext`, en base64url.
 */
@Injectable()
export class RouterCredentialsService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const rawKey = config.getOrThrow<string>('ROUTER_CREDENTIALS_KEY');
    this.key = Buffer.from(rawKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error(
        'ROUTER_CREDENTIALS_KEY doit faire 32 octets en hexadécimal (64 caractères) — ex: openssl rand -hex 32',
      );
    }
  }

  encrypt(credentials: RouterCredentials): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(payload: string): RouterCredentials {
    const [ivPart, tagPart, dataPart] = payload.split('.');
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('Identifiants routeur illisibles : format chiffré invalide');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as RouterCredentials;
  }
}
