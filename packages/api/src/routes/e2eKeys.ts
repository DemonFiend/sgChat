/**
 * E2E Encryption Key Management Routes
 *
 * These endpoints manage device key bundles for end-to-end encrypted DMs.
 * The server is a dumb key directory — it stores public keys and relays
 * encrypted blobs without ever decrypting E2E content.
 *
 * PUT    /api/e2e/keys           — Upload/update device key bundle + one-time pre-keys
 * GET    /api/e2e/keys/:userId   — Fetch a user's key bundles (consumes one OTP key per device)
 * POST   /api/e2e/keys/one-time  — Replenish one-time pre-keys
 * GET    /api/e2e/keys/self      — Fetch own device keys
 * DELETE /api/e2e/keys/:deviceId — Remove a device's keys
 * GET    /api/e2e/keys/self/count — Check remaining one-time pre-key count per device
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { authenticate } from '../middleware/auth.js';
import { E2E_MAX_OTP_KEYS_PER_UPLOAD, E2E_MAX_DEVICES_PER_USER } from '@sgchat/shared';

// ── Validators ───────────────────────────────────────────────

const base64KeySchema = z.string().min(40).max(200);

const otpKeySchema = z.object({
  key_id: z.number().int().min(0),
  public_key: base64KeySchema,
});

const uploadKeysSchema = z.object({
  device_id: z.string().min(1).max(128),
  device_label: z.string().max(64).optional(),
  identity_key: base64KeySchema,
  signed_pre_key: base64KeySchema,
  signed_pre_key_signature: base64KeySchema,
  signed_pre_key_id: z.number().int().min(0),
  one_time_pre_keys: z.array(otpKeySchema).max(E2E_MAX_OTP_KEYS_PER_UPLOAD).optional(),
});

const replenishOtpSchema = z.object({
  device_id: z.string().min(1).max(128),
  keys: z.array(otpKeySchema).min(1).max(E2E_MAX_OTP_KEYS_PER_UPLOAD),
});

// ── Routes ───────────────────────────────────────────────────

export const e2eKeyRoutes: FastifyPluginAsync = async (fastify) => {
  // Upload or update device key bundle
  fastify.put('/keys', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => req.user?.id || req.ip,
      },
    },
    handler: async (request, reply) => {
      const body = uploadKeysSchema.parse(request.body);
      const userId = request.user!.id;

      // Enforce max devices per user
      const [countResult] = await db.sql`
        SELECT COUNT(*)::int AS count FROM e2e_device_keys
        WHERE user_id = ${userId} AND device_id != ${body.device_id}
      `;
      if (countResult.count >= E2E_MAX_DEVICES_PER_USER) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Maximum ${E2E_MAX_DEVICES_PER_USER} devices allowed`,
        });
      }

      // Upsert device key bundle
      const [deviceKey] = await db.sql`
        INSERT INTO e2e_device_keys (
          user_id, device_id, device_label,
          identity_key, signed_pre_key, signed_pre_key_signature, signed_pre_key_id
        ) VALUES (
          ${userId}, ${body.device_id}, ${body.device_label || null},
          ${body.identity_key}, ${body.signed_pre_key},
          ${body.signed_pre_key_signature}, ${body.signed_pre_key_id}
        )
        ON CONFLICT (user_id, device_id) DO UPDATE SET
          device_label = EXCLUDED.device_label,
          identity_key = EXCLUDED.identity_key,
          signed_pre_key = EXCLUDED.signed_pre_key,
          signed_pre_key_signature = EXCLUDED.signed_pre_key_signature,
          signed_pre_key_id = EXCLUDED.signed_pre_key_id,
          updated_at = NOW()
        RETURNING *
      `;

      // Bulk insert one-time pre-keys if provided
      if (body.one_time_pre_keys && body.one_time_pre_keys.length > 0) {
        for (const otpKey of body.one_time_pre_keys) {
          await db.sql`
            INSERT INTO e2e_one_time_pre_keys (device_key_id, key_id, public_key)
            VALUES (${deviceKey.id}, ${otpKey.key_id}, ${otpKey.public_key})
            ON CONFLICT (device_key_id, key_id) DO NOTHING
          `;
        }
      }

      return { message: 'Device key bundle uploaded', device_id: body.device_id };
    },
  });

  // Fetch a user's key bundles (consumes one OTP key per device atomically)
  fastify.get('/keys/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };

      // Get all device key bundles for the target user
      const deviceKeys = await db.sql`
        SELECT id, device_id, device_label,
               identity_key, signed_pre_key, signed_pre_key_signature, signed_pre_key_id
        FROM e2e_device_keys
        WHERE user_id = ${userId}
        ORDER BY created_at ASC
      `;

      if (deviceKeys.length === 0) {
        return { bundles: [] };
      }

      // For each device, atomically consume one one-time pre-key
      const bundles = [];
      for (const dk of deviceKeys) {
        // Atomic consume: DELETE one OTP key and return it
        const [otpKey] = await db.sql`
          DELETE FROM e2e_one_time_pre_keys
          WHERE id = (
            SELECT id FROM e2e_one_time_pre_keys
            WHERE device_key_id = ${dk.id}
            ORDER BY created_at ASC
            LIMIT 1
          )
          RETURNING key_id, public_key
        `;

        bundles.push({
          device_id: dk.device_id,
          device_label: dk.device_label,
          identity_key: dk.identity_key,
          signed_pre_key: dk.signed_pre_key,
          signed_pre_key_signature: dk.signed_pre_key_signature,
          signed_pre_key_id: dk.signed_pre_key_id,
          one_time_pre_key: otpKey ? { key_id: otpKey.key_id, public_key: otpKey.public_key } : null,
        });
      }

      return { bundles };
    },
  });

  // Replenish one-time pre-keys for a device
  fastify.post('/keys/one-time', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => req.user?.id || req.ip,
      },
    },
    handler: async (request, reply) => {
      const body = replenishOtpSchema.parse(request.body);
      const userId = request.user!.id;

      // Verify the device belongs to this user
      const [deviceKey] = await db.sql`
        SELECT id FROM e2e_device_keys
        WHERE user_id = ${userId} AND device_id = ${body.device_id}
      `;
      if (!deviceKey) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Device key bundle not found',
        });
      }

      let inserted = 0;
      for (const otpKey of body.keys) {
        const [result] = await db.sql`
          INSERT INTO e2e_one_time_pre_keys (device_key_id, key_id, public_key)
          VALUES (${deviceKey.id}, ${otpKey.key_id}, ${otpKey.public_key})
          ON CONFLICT (device_key_id, key_id) DO NOTHING
          RETURNING id
        `;
        if (result) inserted++;
      }

      return { message: 'One-time pre-keys uploaded', inserted };
    },
  });

  // Fetch own device keys
  fastify.get('/keys/self', {
    onRequest: [authenticate],
    handler: async (request) => {
      const userId = request.user!.id;
      const deviceKeys = await db.sql`
        SELECT id, device_id, device_label,
               identity_key, signed_pre_key, signed_pre_key_signature, signed_pre_key_id,
               created_at, updated_at
        FROM e2e_device_keys
        WHERE user_id = ${userId}
        ORDER BY created_at ASC
      `;
      return { devices: deviceKeys };
    },
  });

  // Check remaining one-time pre-key count per device
  fastify.get('/keys/self/count', {
    onRequest: [authenticate],
    handler: async (request) => {
      const userId = request.user!.id;
      const counts = await db.sql`
        SELECT dk.device_id, dk.device_label, COUNT(otpk.id)::int AS remaining
        FROM e2e_device_keys dk
        LEFT JOIN e2e_one_time_pre_keys otpk ON otpk.device_key_id = dk.id
        WHERE dk.user_id = ${userId}
        GROUP BY dk.id, dk.device_id, dk.device_label
        ORDER BY dk.created_at ASC
      `;
      return { devices: counts };
    },
  });

  // Remove a device's keys
  fastify.delete('/keys/:deviceId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { deviceId } = request.params as { deviceId: string };
      const userId = request.user!.id;

      const [deleted] = await db.sql`
        DELETE FROM e2e_device_keys
        WHERE user_id = ${userId} AND device_id = ${deviceId}
        RETURNING id
      `;

      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Device key bundle not found',
        });
      }

      return { message: 'Device key bundle removed' };
    },
  });
};
