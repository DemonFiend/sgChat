import type { FastifyInstance } from 'fastify';
import { cpus, totalmem, freemem } from 'os';
import { loadRelayConfig } from '../config.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    const config = loadRelayConfig();
    const cpuLoad =
      cpus().reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return acc + ((total - cpu.times.idle) / total) * 100;
      }, 0) / cpus().length;

    const totalMem = totalmem();
    const memUsage = ((totalMem - freemem()) / totalMem) * 100;

    return reply.send({
      status: config ? 'healthy' : 'unconfigured',
      relay_id: config?.relay_id ?? null,
      livekit_status: 'unknown', // TODO: actual LiveKit health check
      active_rooms: 0,
      total_participants: 0,
      cpu_usage_percent: Math.round(cpuLoad),
      memory_usage_percent: Math.round(memUsage),
      uptime_seconds: Math.round(process.uptime()),
    });
  });
}
