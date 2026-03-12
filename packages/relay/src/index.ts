import 'dotenv/config';
import Fastify from 'fastify';
import { getEnvConfig, loadRelayConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { HeartbeatService } from './services/heartbeat.js';

async function main(): Promise<void> {
  const env = getEnvConfig();

  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    },
  });

  // Register routes
  await fastify.register(healthRoutes);

  // Start server
  await fastify.listen({ port: env.PORT, host: env.HOST });
  console.log(`  sgChat Relay listening on ${env.HOST}:${env.PORT}`);

  // Start heartbeat if paired
  const config = loadRelayConfig();
  if (config) {
    console.log(`  Relay "${config.relay_id}" paired — starting heartbeat`);
    const heartbeat = new HeartbeatService(config);
    heartbeat.start();

    // Graceful shutdown
    const shutdown = () => {
      heartbeat.stop();
      fastify.close();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else if (env.RELAY_PAIRING_TOKEN) {
    console.log('  Pairing token detected — run `sgchat-relay pair` to complete setup');
  } else {
    console.log(
      '  No relay config found. Provide a RELAY_PAIRING_TOKEN or run `sgchat-relay pair <token>`',
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
