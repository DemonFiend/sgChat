import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getEnvConfig, loadRelayConfig, type RelayConfig, type EnvConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { HeartbeatService } from './services/heartbeat.js';
import { MasterClient } from './services/masterClient.js';
import { VoiceCacheService } from './services/voiceCache.js';
import { EventBufferService } from './services/eventBuffer.js';
import { voiceAuthorizeRoutes } from './routes/voiceAuthorize.js';
import type { FastifyInstance } from 'fastify';

async function startServices(
  fastify: FastifyInstance,
  config: RelayConfig,
  env: EnvConfig,
): Promise<void> {
  console.log(`  Relay "${config.relay_id}" paired — starting services`);
  const masterClient = new MasterClient(config);
  const heartbeat = new HeartbeatService(config, env);
  heartbeat.start();

  const voiceCache = new VoiceCacheService(masterClient, config, env);
  voiceCache.start();

  const eventBuffer = new EventBufferService(masterClient);
  eventBuffer.start();

  // Register voice-authorize route (clients call this when Master is down)
  await fastify.register(voiceAuthorizeRoutes(masterClient, voiceCache));

  // Graceful shutdown
  const shutdown = () => {
    heartbeat.stop();
    voiceCache.stop();
    eventBuffer.stop();
    fastify.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const env = getEnvConfig();

  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    },
  });

  // Enable CORS (clients call /voice-authorize cross-origin during Master outage)
  await fastify.register(cors, { origin: true });

  // Register routes
  await fastify.register(healthRoutes);

  // Start server
  await fastify.listen({ port: env.PORT, host: env.HOST });
  console.log(`  sgChat Relay listening on ${env.HOST}:${env.PORT}`);

  // Check for existing config (already paired)
  let config = loadRelayConfig();

  // Auto-pair on first startup if token is provided but not yet paired (Docker workflow)
  if (!config && env.RELAY_PAIRING_TOKEN) {
    console.log('  Pairing token detected — auto-pairing with Master...');
    const { autoPair } = await import('./lib/autoPair.js');
    const paired = await autoPair(env.RELAY_PAIRING_TOKEN, env);
    if (paired) {
      config = loadRelayConfig();
    } else {
      console.error('  Auto-pair failed. Check the pairing token and Master URL.');
      process.exit(1);
    }
  }

  if (config) {
    await startServices(fastify, config, env);
  } else {
    console.log(
      '  No relay config found. Set RELAY_PAIRING_TOKEN env var or run: sgchat-relay pair <token>',
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
