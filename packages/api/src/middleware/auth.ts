import { FastifyRequest, FastifyReply } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';

export interface UserPayload {
  id: string;
  username: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserPayload;
    /** Set by crypto payload plugin when request was encrypted */
    cryptoSessionId?: string;
  }

  interface FastifyInstance {
    io?: SocketIOServer;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: UserPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }
}

export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    // Continue without auth
  }
}
