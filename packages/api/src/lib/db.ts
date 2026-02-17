import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://sgchat:password@localhost:5432/sgchat';

export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function initDatabase() {
  try {
    await sql`SELECT 1`;
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

// Database helper functions
// Safe user columns (excludes password_hash) - used by default to prevent accidental leaks
const SAFE_USER_COLUMNS = sql`
  id, username, display_name, email, avatar_url,
  status, custom_status, custom_status_emoji, status_expires_at,
  push_token, push_enabled, last_seen_at, created_at, updated_at
`;

export const db = {
  // Users
  users: {
    /** Find user by ID - excludes password_hash for safety */
    async findById(id: string) {
      const [user] = await sql`
        SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ${id}
      `;
      return user;
    },
    /** Find user by username - excludes password_hash for safety */
    async findByUsername(username: string) {
      const [user] = await sql`
        SELECT ${SAFE_USER_COLUMNS} FROM users WHERE username = ${username}
      `;
      return user;
    },
    /** Find user by email - excludes password_hash for safety */
    async findByEmail(email: string) {
      const [user] = await sql`
        SELECT ${SAFE_USER_COLUMNS} FROM users WHERE email = ${email}
      `;
      return user;
    },
    /** Find user by email INCLUDING password_hash - only use for auth verification */
    async findByEmailWithPassword(email: string) {
      const [user] = await sql`
        SELECT * FROM users WHERE email = ${email}
      `;
      return user;
    },
    /** Find user by ID INCLUDING password_hash - only use for password change/verify */
    async findByIdWithPassword(id: string) {
      const [user] = await sql`
        SELECT * FROM users WHERE id = ${id}
      `;
      return user;
    },
    async create(data: { username: string; email: string; password_hash: string }) {
      const [user] = await sql`
        INSERT INTO users (username, email, password_hash)
        VALUES (${data.username}, ${data.email}, ${data.password_hash})
        RETURNING ${SAFE_USER_COLUMNS}
      `;
      return user;
    },
    async updateStatus(id: string, status: string) {
      await sql`
        UPDATE users 
        SET status = ${status}, last_seen_at = NOW()
        WHERE id = ${id}
      `;
    },
  },

  // Servers
  servers: {
    async findById(id: string) {
      const [server] = await sql`
        SELECT * FROM servers WHERE id = ${id}
      `;
      return server;
    },
    async findByUserId(userId: string) {
      return sql`
        SELECT s.* 
        FROM servers s
        INNER JOIN members m ON s.id = m.server_id
        WHERE m.user_id = ${userId}
        ORDER BY s.created_at DESC
      `;
    },
    async create(data: { name: string; owner_id: string; icon_url?: string }) {
      const [server] = await sql`
        INSERT INTO servers (name, owner_id, icon_url)
        VALUES (${data.name}, ${data.owner_id}, ${data.icon_url || null})
        RETURNING *
      `;
      return server;
    },
  },

  // Channels
  channels: {
    async findById(id: string) {
      const [channel] = await sql`
        SELECT * FROM channels WHERE id = ${id}
      `;
      return channel;
    },
    async findByServerId(serverId: string) {
      return sql`
        SELECT * FROM channels 
        WHERE server_id = ${serverId}
        ORDER BY position ASC, created_at ASC
      `;
    },
    async create(data: {
      server_id: string;
      name: string;
      type: string;
      topic?: string;
      position?: number;
      bitrate?: number;
      is_afk_channel?: boolean;
    }) {
      const [channel] = await sql`
        INSERT INTO channels (
          server_id, name, type, topic, position, bitrate, is_afk_channel
        )
        VALUES (
          ${data.server_id}, 
          ${data.name}, 
          ${data.type},
          ${data.topic || null},
          ${data.position || 0},
          ${data.bitrate || 64000},
          ${data.is_afk_channel || false}
        )
        RETURNING *
      `;
      return channel;
    },
    async updateBitrate(id: string, bitrate: number) {
      await sql`
        UPDATE channels SET bitrate = ${bitrate} WHERE id = ${id}
      `;
    },
    async findAfkChannel(serverId: string) {
      const [channel] = await sql`
        SELECT * FROM channels 
        WHERE server_id = ${serverId} AND is_afk_channel = true
        LIMIT 1
      `;
      return channel;
    },
  },

  // Messages
  messages: {
    async findById(id: string) {
      const [message] = await sql`
        SELECT * FROM messages WHERE id = ${id}
      `;
      return message;
    },
    async findByChannelId(channelId: string, limit = 50, before?: string) {
      if (before) {
        return sql`
          SELECT m.*, u.username, u.avatar_url
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.channel_id = ${channelId} AND m.created_at < (
            SELECT created_at FROM messages WHERE id = ${before}
          )
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT m.*, u.username, u.avatar_url
        FROM messages m
        LEFT JOIN users u ON m.author_id = u.id
        WHERE m.channel_id = ${channelId}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `;
    },
    async findByDMChannelId(dmChannelId: string, limit = 50, before?: string) {
      if (before) {
        return sql`
          SELECT m.*, u.username, u.avatar_url
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.dm_channel_id = ${dmChannelId} AND m.created_at < (
            SELECT created_at FROM messages WHERE id = ${before}
          )
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT m.*, u.username, u.avatar_url
        FROM messages m
        LEFT JOIN users u ON m.author_id = u.id
        WHERE m.dm_channel_id = ${dmChannelId}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `;
    },
    async create(data: {
      channel_id?: string;
      dm_channel_id?: string;
      author_id: string;
      content: string;
      reply_to_id?: string;
      attachments?: any[];
      queued_at?: Date;
      system_event?: any;
      status?: string;
    }) {
      const [message] = await sql`
        INSERT INTO messages (
          channel_id, dm_channel_id, author_id, content, reply_to_id,
          attachments, queued_at, system_event, status
        )
        VALUES (
          ${data.channel_id || null},
          ${data.dm_channel_id || null},
          ${data.author_id},
          ${data.content},
          ${data.reply_to_id || null},
          ${JSON.stringify(data.attachments || [])},
          ${data.queued_at || null},
          ${data.system_event ? JSON.stringify(data.system_event) : null},
          ${data.status || 'sent'}
        )
        RETURNING *
      `;
      return message;
    },
    async update(id: string, data: { content?: string; edited_at?: Date }) {
      const updates: any = {};
      if (data.content !== undefined) updates.content = data.content;
      if (data.edited_at) updates.edited_at = data.edited_at;

      const [message] = await sql`
        UPDATE messages 
        SET ${sql(updates)}
        WHERE id = ${id}
        RETURNING *
      `;
      return message;
    },
    async delete(id: string) {
      await sql`DELETE FROM messages WHERE id = ${id}`;
    },
    async updateStatus(id: string, status: string, received_at?: Date) {
      if (received_at) {
        await sql`
          UPDATE messages 
          SET status = ${status}, received_at = ${received_at}
          WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE messages SET status = ${status} WHERE id = ${id}
        `;
      }
    },
  },

  // DM Channels
  dmChannels: {
    async findById(id: string) {
      const [dm] = await sql`SELECT * FROM dm_channels WHERE id = ${id}`;
      return dm;
    },
    async findByUsers(user1Id: string, user2Id: string) {
      const [smaller, larger] = [user1Id, user2Id].sort();
      const [dm] = await sql`
        SELECT * FROM dm_channels 
        WHERE user1_id = ${smaller} AND user2_id = ${larger}
      `;
      return dm;
    },
    async findByUserId(userId: string) {
      return sql`
        SELECT dc.*, 
          CASE 
            WHEN dc.user1_id = ${userId} THEN u2.username
            ELSE u1.username
          END as other_username,
          CASE 
            WHEN dc.user1_id = ${userId} THEN u2.avatar_url
            ELSE u1.avatar_url
          END as other_avatar_url,
          CASE 
            WHEN dc.user1_id = ${userId} THEN dc.user2_id
            ELSE dc.user1_id
          END as other_user_id
        FROM dm_channels dc
        LEFT JOIN users u1 ON dc.user1_id = u1.id
        LEFT JOIN users u2 ON dc.user2_id = u2.id
        WHERE dc.user1_id = ${userId} OR dc.user2_id = ${userId}
        ORDER BY dc.created_at DESC
      `;
    },
    async create(user1Id: string, user2Id: string) {
      const [smaller, larger] = [user1Id, user2Id].sort();
      const [dm] = await sql`
        INSERT INTO dm_channels (user1_id, user2_id)
        VALUES (${smaller}, ${larger})
        RETURNING *
      `;
      return dm;
    },
  },

  // Members
  members: {
    async findByUserAndServer(userId: string, serverId: string) {
      const [member] = await sql`
        SELECT * FROM members 
        WHERE user_id = ${userId} AND server_id = ${serverId}
      `;
      return member;
    },
    async findByServerId(serverId: string) {
      return sql`
        SELECT m.*, u.username, u.avatar_url, u.status, u.custom_status
        FROM members m
        INNER JOIN users u ON m.user_id = u.id
        WHERE m.server_id = ${serverId}
        ORDER BY u.username ASC
      `;
    },
    async create(data: { user_id: string; server_id: string }) {
      const [member] = await sql`
        INSERT INTO members (user_id, server_id)
        VALUES (${data.user_id}, ${data.server_id})
        RETURNING *
      `;
      return member;
    },
    async delete(userId: string, serverId: string) {
      await sql`
        DELETE FROM members 
        WHERE user_id = ${userId} AND server_id = ${serverId}
      `;
    },
  },

  // Roles
  roles: {
    async findById(id: string) {
      const [role] = await sql`SELECT * FROM roles WHERE id = ${id}`;
      return role;
    },
    async findByServerId(serverId: string) {
      return sql`
        SELECT * FROM roles 
        WHERE server_id = ${serverId}
        ORDER BY position DESC
      `;
    },
    async findEveryoneRole(serverId: string) {
      const [role] = await sql`
        SELECT * FROM roles 
        WHERE server_id = ${serverId} AND name = '@everyone'
      `;
      return role;
    },
    async create(data: {
      server_id: string;
      name: string;
      color?: string;
      position?: number;
      server_permissions?: string;
      text_permissions?: string;
      voice_permissions?: string;
    }) {
      const [role] = await sql`
        INSERT INTO roles (
          server_id, name, color, position,
          server_permissions, text_permissions, voice_permissions
        )
        VALUES (
          ${data.server_id},
          ${data.name},
          ${data.color || null},
          ${data.position || 0},
          ${data.server_permissions || '0'},
          ${data.text_permissions || '0'},
          ${data.voice_permissions || '0'}
        )
        RETURNING *
      `;
      return role;
    },
  },

  // Member Roles
  memberRoles: {
    async findByMember(userId: string, serverId: string) {
      return sql`
        SELECT r.* FROM roles r
        INNER JOIN member_roles mr ON r.id = mr.role_id
        WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
        ORDER BY r.position DESC
      `;
    },
  },

  // Invites
  invites: {
    async findByCode(code: string) {
      const [invite] = await sql`SELECT * FROM invites WHERE code = ${code}`;
      return invite;
    },
    async findByServerId(serverId: string) {
      return sql`
        SELECT i.*, u.username as creator_username
        FROM invites i
        LEFT JOIN users u ON i.creator_id = u.id
        WHERE i.server_id = ${serverId}
        ORDER BY i.created_at DESC
      `;
    },
    async create(data: {
      code: string;
      server_id: string;
      creator_id: string;
      max_uses?: number;
      expires_at?: Date;
    }) {
      const [invite] = await sql`
        INSERT INTO invites (code, server_id, creator_id, max_uses, expires_at)
        VALUES (
          ${data.code},
          ${data.server_id},
          ${data.creator_id},
          ${data.max_uses || null},
          ${data.expires_at || null}
        )
        RETURNING *
      `;
      return invite;
    },
    async incrementUses(code: string) {
      await sql`UPDATE invites SET uses = uses + 1 WHERE code = ${code}`;
    },
  },

  // Instance Settings
  instanceSettings: {
    async get(key: string) {
      const [setting] = await sql`
        SELECT * FROM instance_settings WHERE key = ${key}
      `;
      return setting;
    },
    async set(key: string, value: any) {
      await sql`
        INSERT INTO instance_settings (key, value)
        VALUES (${key}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}, updated_at = NOW()
      `;
    },
  },

  // Message Segments
  segments: {
    async findById(id: string) {
      const [segment] = await sql`
        SELECT * FROM message_segments WHERE id = ${id}
      `;
      return segment;
    },

    async findByChannelId(channelId: string, limit = 50, offset = 0) {
      return sql`
        SELECT * FROM message_segments
        WHERE channel_id = ${channelId}
        ORDER BY segment_start DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async findByDMChannelId(dmChannelId: string, limit = 50, offset = 0) {
      return sql`
        SELECT * FROM message_segments
        WHERE dm_channel_id = ${dmChannelId}
        ORDER BY segment_start DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async findByTimestamp(channelId: string | null, dmChannelId: string | null, timestamp: Date) {
      if (channelId) {
        const [segment] = await sql`
          SELECT * FROM message_segments
          WHERE channel_id = ${channelId}
            AND segment_start <= ${timestamp}
            AND segment_end > ${timestamp}
        `;
        return segment;
      } else if (dmChannelId) {
        const [segment] = await sql`
          SELECT * FROM message_segments
          WHERE dm_channel_id = ${dmChannelId}
            AND segment_start <= ${timestamp}
            AND segment_end > ${timestamp}
        `;
        return segment;
      }
      return null;
    },

    async findArchivedSegments(channelId: string | null, dmChannelId: string | null) {
      if (channelId) {
        return sql`
          SELECT * FROM message_segments
          WHERE channel_id = ${channelId} AND is_archived = true
          ORDER BY segment_start DESC
        `;
      } else if (dmChannelId) {
        return sql`
          SELECT * FROM message_segments
          WHERE dm_channel_id = ${dmChannelId} AND is_archived = true
          ORDER BY segment_start DESC
        `;
      }
      return [];
    },

    async create(data: {
      channel_id?: string;
      dm_channel_id?: string;
      segment_start: Date;
      segment_end: Date;
    }) {
      const [segment] = await sql`
        INSERT INTO message_segments (channel_id, dm_channel_id, segment_start, segment_end)
        VALUES (
          ${data.channel_id || null},
          ${data.dm_channel_id || null},
          ${data.segment_start},
          ${data.segment_end}
        )
        RETURNING *
      `;
      return segment;
    },

    async updateStats(id: string, messageCount: number, sizeBytes: number) {
      await sql`
        UPDATE message_segments
        SET message_count = ${messageCount}, size_bytes = ${sizeBytes}
        WHERE id = ${id}
      `;
    },

    async incrementStats(id: string, messageCountDelta: number, sizeBytesDelta: number) {
      await sql`
        UPDATE message_segments
        SET message_count = message_count + ${messageCountDelta},
            size_bytes = size_bytes + ${sizeBytesDelta}
        WHERE id = ${id}
      `;
    },

    async markArchived(id: string, archivePath: string) {
      await sql`
        UPDATE message_segments
        SET is_archived = true, archive_path = ${archivePath}
        WHERE id = ${id}
      `;
    },

    async markUnarchived(id: string) {
      await sql`
        UPDATE message_segments
        SET is_archived = false, archive_path = NULL
        WHERE id = ${id}
      `;
    },

    async delete(id: string) {
      await sql`DELETE FROM message_segments WHERE id = ${id}`;
    },

    async getChannelStorageStats(channelId: string) {
      const [stats] = await sql`
        SELECT 
          COUNT(*)::int as segments_count,
          SUM(CASE WHEN is_archived THEN 1 ELSE 0 END)::int as archived_segments_count,
          COALESCE(SUM(message_count), 0)::int as total_messages,
          COALESCE(SUM(size_bytes), 0)::bigint as total_size_bytes,
          COALESCE(SUM(CASE WHEN is_archived THEN 0 ELSE size_bytes END), 0)::bigint as active_size_bytes,
          COALESCE(SUM(CASE WHEN is_archived THEN size_bytes ELSE 0 END), 0)::bigint as archived_size_bytes,
          MIN(segment_start) as oldest_segment_date
        FROM message_segments
        WHERE channel_id = ${channelId}
      `;
      return stats;
    },

    async getDMStorageStats(dmChannelId: string) {
      const [stats] = await sql`
        SELECT 
          COUNT(*)::int as segments_count,
          SUM(CASE WHEN is_archived THEN 1 ELSE 0 END)::int as archived_segments_count,
          COALESCE(SUM(message_count), 0)::int as total_messages,
          COALESCE(SUM(size_bytes), 0)::bigint as total_size_bytes,
          COALESCE(SUM(CASE WHEN is_archived THEN 0 ELSE size_bytes END), 0)::bigint as active_size_bytes,
          COALESCE(SUM(CASE WHEN is_archived THEN size_bytes ELSE 0 END), 0)::bigint as archived_size_bytes,
          MIN(segment_start) as oldest_segment_date
        FROM message_segments
        WHERE dm_channel_id = ${dmChannelId}
      `;
      return stats;
    },

    async getServerStorageStats(serverId: string) {
      const [stats] = await sql`
        SELECT 
          COUNT(*)::int as segments_count,
          SUM(CASE WHEN ms.is_archived THEN 1 ELSE 0 END)::int as archived_segments_count,
          COALESCE(SUM(ms.message_count), 0)::int as total_messages,
          COALESCE(SUM(ms.size_bytes), 0)::bigint as total_size_bytes,
          COALESCE(SUM(CASE WHEN ms.is_archived THEN 0 ELSE ms.size_bytes END), 0)::bigint as active_size_bytes,
          COALESCE(SUM(CASE WHEN ms.is_archived THEN ms.size_bytes ELSE 0 END), 0)::bigint as archived_size_bytes,
          MIN(ms.segment_start) as oldest_segment_date
        FROM message_segments ms
        INNER JOIN channels c ON ms.channel_id = c.id
        WHERE c.server_id = ${serverId}
      `;
      return stats;
    },

    async getOldestUnarchived(channelId: string | null, dmChannelId: string | null, limit = 10) {
      if (channelId) {
        return sql`
          SELECT * FROM message_segments
          WHERE channel_id = ${channelId} AND is_archived = false
          ORDER BY segment_start ASC
          LIMIT ${limit}
        `;
      } else if (dmChannelId) {
        return sql`
          SELECT * FROM message_segments
          WHERE dm_channel_id = ${dmChannelId} AND is_archived = false
          ORDER BY segment_start ASC
          LIMIT ${limit}
        `;
      }
      return [];
    },
  },

  // Retention settings helpers
  retention: {
    async getChannelRetention(channelId: string) {
      const [result] = await sql`
        SELECT retention_days, retention_never, size_limit_bytes, pruning_enabled
        FROM channels
        WHERE id = ${channelId}
      `;
      return result;
    },

    async updateChannelRetention(channelId: string, settings: {
      retention_days?: number | null;
      retention_never?: boolean;
      size_limit_bytes?: number | null;
      pruning_enabled?: boolean;
    }) {
      const updates: Record<string, any> = {};
      if ('retention_days' in settings) updates.retention_days = settings.retention_days;
      if ('retention_never' in settings) updates.retention_never = settings.retention_never;
      if ('size_limit_bytes' in settings) updates.size_limit_bytes = settings.size_limit_bytes;
      if ('pruning_enabled' in settings) updates.pruning_enabled = settings.pruning_enabled;

      if (Object.keys(updates).length === 0) return;

      await sql`
        UPDATE channels
        SET ${sql(updates)}
        WHERE id = ${channelId}
      `;
    },

    async getDMRetention(dmChannelId: string) {
      const [result] = await sql`
        SELECT retention_days, retention_never, size_limit_bytes
        FROM dm_channels
        WHERE id = ${dmChannelId}
      `;
      return result;
    },

    async updateDMRetention(dmChannelId: string, settings: {
      retention_days?: number | null;
      retention_never?: boolean;
      size_limit_bytes?: number | null;
    }) {
      const updates: Record<string, any> = {};
      if ('retention_days' in settings) updates.retention_days = settings.retention_days;
      if ('retention_never' in settings) updates.retention_never = settings.retention_never;
      if ('size_limit_bytes' in settings) updates.size_limit_bytes = settings.size_limit_bytes;

      if (Object.keys(updates).length === 0) return;

      await sql`
        UPDATE dm_channels
        SET ${sql(updates)}
        WHERE id = ${dmChannelId}
      `;
    },
  },

  // Trimming log
  trimmingLog: {
    async create(data: {
      channel_id?: string;
      dm_channel_id?: string;
      action: string;
      messages_affected: number;
      bytes_freed: number;
      segment_ids?: string[];
      triggered_by: string;
      details?: Record<string, any>;
    }) {
      const [entry] = await sql`
        INSERT INTO trimming_log (
          channel_id, dm_channel_id, action, messages_affected, 
          bytes_freed, segment_ids, triggered_by, details
        )
        VALUES (
          ${data.channel_id || null},
          ${data.dm_channel_id || null},
          ${data.action},
          ${data.messages_affected},
          ${data.bytes_freed},
          ${data.segment_ids || []},
          ${data.triggered_by},
          ${JSON.stringify(data.details || {})}
        )
        RETURNING *
      `;
      return entry;
    },

    async findByChannel(channelId: string, limit = 50, offset = 0) {
      return sql`
        SELECT * FROM trimming_log
        WHERE channel_id = ${channelId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async findByDMChannel(dmChannelId: string, limit = 50, offset = 0) {
      return sql`
        SELECT * FROM trimming_log
        WHERE dm_channel_id = ${dmChannelId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async findAll(limit = 100, offset = 0) {
      return sql`
        SELECT tl.*, c.name as channel_name, c.server_id
        FROM trimming_log tl
        LEFT JOIN channels c ON tl.channel_id = c.id
        ORDER BY tl.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    },
  },

  // Helper to run transactions
  transaction: sql.begin,

  // Close connection
  async end() {
    await sql.end();
  },

  // Expose sql for direct queries
  sql,
};
