/**
 * Crypto Key Exchange Routes
 *
 * POST /api/crypto/exchange — ECDH P-256 key exchange for payload encryption.
 * No authentication required (used before login).
 */

import { randomUUID } from 'crypto';
import { FastifyPluginAsync } from 'fastify';
import { redis } from '../lib/redis.js';
import {
  CRYPTO_HKDF_INFO,
  CRYPTO_SESSION_TTL,
  type CryptoExchangeRequest,
  type CryptoExchangeResponse,
} from '@sgchat/shared';
import { z } from 'zod';

const exchangeBodySchema = z.object({
  clientPublicKey: z.string().min(40).max(200), // base64 of 65-byte raw P-256 key
});

export const cryptoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/exchange', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => req.ip,
      },
    },
    handler: async (request, reply) => {
      const body = exchangeBodySchema.parse(request.body);

      try {
        // 1. Decode client's public key from base64
        const clientPubBytes = Buffer.from(body.clientPublicKey, 'base64');

        // Validate key length (65 bytes for uncompressed P-256)
        if (clientPubBytes.length !== 65) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid public key length (expected 65 bytes uncompressed P-256)',
          });
        }

        // 2. Generate ephemeral server ECDH P-256 keypair
        const serverKeyPair = await crypto.subtle.generateKey(
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          ['deriveBits'],
        );

        // 3. Import client's public key
        const clientPubKey = await crypto.subtle.importKey(
          'raw',
          clientPubBytes,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          [],
        );

        // 4. Derive shared bits (256 bits = 32 bytes)
        const sharedBits = await crypto.subtle.deriveBits(
          { name: 'ECDH', public: clientPubKey },
          serverKeyPair.privateKey,
          256,
        );

        // 5. Generate session ID
        const sessionId = randomUUID();

        // 6. Derive AES-256 key via HKDF
        const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, [
          'deriveKey',
        ]);

        const aesKey = await crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode(sessionId),
            info: new TextEncoder().encode(CRYPTO_HKDF_INFO),
          },
          hkdfKey,
          { name: 'AES-GCM', length: 256 },
          true, // extractable so we can store in Redis
          ['encrypt', 'decrypt'],
        );

        // 7. Export AES key as hex and store in Redis
        const rawKey = await crypto.subtle.exportKey('raw', aesKey);
        const keyHex = Buffer.from(rawKey).toString('hex');
        await redis.setCryptoSession(sessionId, keyHex, CRYPTO_SESSION_TTL);

        // 8. Export server public key as base64
        const serverPubRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
        const serverPubB64 = Buffer.from(serverPubRaw).toString('base64');

        // 9. Calculate expiration
        const expiresAt = new Date(Date.now() + CRYPTO_SESSION_TTL * 1000).toISOString();

        const response: CryptoExchangeResponse = {
          serverPublicKey: serverPubB64,
          sessionId,
          expiresAt,
        };

        return response;
      } catch (err) {
        fastify.log.error(err, 'Key exchange failed');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Key exchange failed',
        });
      }
    },
  });
};
