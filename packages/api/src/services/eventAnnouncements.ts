import { db, sql } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { createNotification } from '../routes/notifications.js';

export async function checkAndAnnounceEvents() {
  const events = await db.serverEvents.getUnannouncedEvents();

  for (const event of events) {
    try {
      // Claim this event first to prevent duplicate announcements across workers
      const claimed = await db.serverEvents.recordAnnouncement(event.id, 'success');
      if (!claimed) continue; // Another worker already claimed it

      // Resolve announcement channel
      const channelId = event.announcement_channel_id || event.welcome_channel_id;

      if (channelId) {
        // Post system message
        const [message] = await sql`
          INSERT INTO messages (channel_id, author_id, content, system_event)
          VALUES (
            ${channelId},
            NULL,
            ${`Event started: ${event.title}`},
            ${JSON.stringify({
              type: 'event_start',
              event_id: event.id,
              title: event.title,
              timestamp: new Date(),
            })}
          )
          RETURNING *
        `;

        // Broadcast message to channel
        await publishEvent({
          type: 'message.new',
          actorId: null,
          resourceId: `channel:${channelId}`,
          payload: { ...message, type: 'system' },
        });
      }

      // Send in-app notifications to interested/tentative users
      const interestedUsers = await db.serverEvents.getInterestedUsers(event.id);
      for (const user of interestedUsers) {
        await createNotification({
          userId: user.user_id,
          type: 'event_start',
          data: {
            event_id: event.id,
            server_id: event.server_id,
            title: event.title,
          },
          priority: 'high',
        });
      }
    } catch (err) {
      console.error(`Failed to announce event ${event.id}:`, err);
      await db.serverEvents.updateAnnouncementResult(
        event.id,
        'failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }
}
