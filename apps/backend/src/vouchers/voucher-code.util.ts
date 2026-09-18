import { randomInt } from 'node:crypto';

// Alphabet sans caractères ambigus à l'oral/à l'écran (0/O, 1/I/l) : les
// vouchers sont lus et retapés à la main par des clients sur un téléphone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateVoucherCode(length = 10, prefix?: string): string {
  let body = '';
  for (let i = 0; i < length; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return prefix ? `${prefix}${body}` : body;
}
