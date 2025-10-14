import { Server as IOServer } from 'socket.io';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';

type Room = string;

export interface JwtPayloadLike {
  userId: string;
  email?: string;
  role?: string;
  permissions?: string[];
}

export class SocketService {
  private static io: IOServer | null = null;

  static init(httpServer: Server) {
    if (this.io) return this.io;
    const io = new IOServer(httpServer, {
      cors: {
        origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean).concat([
          'http://localhost:5173', 
          'http://127.0.0.1:5173',
          'https://oms-client-01ry.onrender.com',
          'https://oms-server-ntlv.onrender.com'
        ])
      }
    });

    io.use((socket, next) => {
      try {
        const token = (socket.handshake.auth?.token || socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, '')) as string | undefined;
        if (!token) return next(new Error('Unauthorized'));
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayloadLike;
        (socket as any).user = decoded;
        next();
      } catch (e) {
        next(new Error('Unauthorized'));
      }
    });

    io.on('connection', (socket) => {
      const user = (socket as any).user as JwtPayloadLike;
      const rooms: Room[] = [
        `user:${user.userId}`,
        user.role ? `role:${user.role}` : ''
      ].filter(Boolean) as Room[];
      rooms.forEach((r) => socket.join(r));
    });

    this.io = io;
    return io;
  }

  static getIO(): IOServer | null {
    return this.io;
  }

  static emitNotification(payload: any & { targets?: { userIds?: string[]; roles?: string[] } }) {
    if (!this.io) return;
    const io = this.io;
    const targets = payload.targets || {};
    let emitted = false;
    if (targets.userIds && targets.userIds.length) {
      targets.userIds.forEach((uid) => {
        io.to(`user:${uid}`).emit('notification', payload);
        emitted = true;
      });
    }
    if (targets.roles && targets.roles.length) {
      targets.roles.forEach((role) => {
        io.to(`role:${role}`).emit('notification', payload);
        emitted = true;
      });
    }
    // If no targets provided, do not broadcast implicitly
  }
}


