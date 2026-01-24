import { FastifyReply } from 'fastify';

/**
 * Standard error response format for sgChat API
 */
interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * HTTP status code to error name mapping
 */
const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/**
 * Send a standardized error response
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  error?: string
): FastifyReply {
  const response: ErrorResponse = {
    statusCode,
    error: error || STATUS_NAMES[statusCode] || 'Error',
    message,
  };
  return reply.status(statusCode).send(response);
}

/**
 * Send a 404 Not Found error for a resource
 */
export function notFound(reply: FastifyReply, resource: string): FastifyReply {
  return sendError(reply, 404, `${resource} not found`);
}

/**
 * Send a 401 Unauthorized error
 */
export function unauthorized(reply: FastifyReply, message = 'Authentication required'): FastifyReply {
  return sendError(reply, 401, message);
}

/**
 * Send a 403 Forbidden error
 */
export function forbidden(reply: FastifyReply, message = 'You do not have permission to perform this action'): FastifyReply {
  return sendError(reply, 403, message);
}

/**
 * Send a 400 Bad Request error
 */
export function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return sendError(reply, 400, message);
}

/**
 * Send a 409 Conflict error
 */
export function conflict(reply: FastifyReply, message: string): FastifyReply {
  return sendError(reply, 409, message);
}
