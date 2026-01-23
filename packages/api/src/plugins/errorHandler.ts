import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';

export const errorHandler: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Validation Error',
        message: 'Invalid request data',
        details: error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    // JWT errors
    if (error.message?.includes('jwt')) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }

    // Log unexpected errors
    if (error.statusCode && error.statusCode >= 500) {
      request.log.error(error);
    }

    // Default error response
    reply.status(error.statusCode || 500).send({
      statusCode: error.statusCode || 500,
      error: error.name || 'Internal Server Error',
      message: error.message || 'An unexpected error occurred',
    });
  });
};
