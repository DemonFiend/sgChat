/**
 * Voice Authorize Route (Relay)
 *
 * Clients call this endpoint directly when Master is unreachable.
 * The relay first tries to proxy to Master, and if that fails,
 * uses the cached permission data to generate a local LiveKit token.
 */

import type { FastifyInstance } from 'fastify';
import type { MasterClient } from '../services/masterClient.js';
import type { VoiceCacheService } from '../services/voiceCache.js';

interface VoiceAuthorizeBody {
  user_id: string;
  channel_id: string;
}

export interface ServiceRefs {
  masterClient: MasterClient | null;
  voiceCache: VoiceCacheService | null;
}

export function voiceAuthorizeRoutes(refs: ServiceRefs) {
  return async function (fastify: FastifyInstance): Promise<void> {
    fastify.post<{ Body: VoiceAuthorizeBody }>(
      '/voice-authorize',
      async (request, reply) => {
        if (!refs.masterClient || !refs.voiceCache) {
          return reply.status(503).send({ error: 'Relay not yet paired' });
        }

        const { user_id, channel_id } = request.body || {};

        if (!user_id || !channel_id) {
          return reply.status(400).send({ error: 'user_id and channel_id required' });
        }

        // Try Master first
        const masterResult = await refs.masterClient.voiceAuthorize(user_id, channel_id);
        if (masterResult) {
          return masterResult;
        }

        // Master unreachable — try cached authorization
        const cachedResult = await refs.voiceCache.authorizeFromCache(user_id, channel_id);
        if (cachedResult) {
          console.log(
            `[VoiceAuthorize] Cache-authorized user ${user_id} for channel ${channel_id}`,
          );
          return cachedResult;
        }

        return reply.status(503).send({
          error: 'Master offline and no cached permissions available',
        });
      },
    );
  };
}
