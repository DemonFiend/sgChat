import type { SlashCommand } from '@sgchat/shared';
import { db } from '../lib/db.js';

/**
 * Built-in slash commands for sgChat.
 *
 * Text-replacement commands modify the message content and return it for normal
 * message creation.  Action commands (like /nick) perform side-effects and may
 * return an ephemeral response instead of creating a message.
 */

const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'shrug',
    description: 'Appends \u00af\\_(\u30c4)_/\u00af to your message',
    options: [
      {
        name: 'message',
        description: 'Optional text before the shrug',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    name: 'tableflip',
    description: 'Appends (\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b to your message',
    options: [
      {
        name: 'message',
        description: 'Optional text before the tableflip',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    name: 'unflip',
    description: 'Appends \u252c\u2500\u252c\u30ce( \u00ba _ \u00ba\u30ce) to your message',
    options: [
      {
        name: 'message',
        description: 'Optional text before the unflip',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    name: 'me',
    description: 'Sends an action message (italicized)',
    options: [
      {
        name: 'action',
        description: 'The action to perform',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    name: 'nick',
    description: 'Change your server display name',
    options: [
      {
        name: 'nickname',
        description: 'Your new nickname (leave empty to reset)',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    name: 'clear',
    description: 'Clear chat messages locally (client-side only)',
  },
];

export function getBuiltinCommands(): SlashCommand[] {
  return BUILTIN_COMMANDS;
}

export interface CommandResult {
  /** Modified message content to send as a normal message. If undefined, no message is created. */
  content?: string;
  /** If true, the response is only visible to the command invoker (not persisted). */
  ephemeral?: boolean;
  /** Ephemeral text to show the user. */
  ephemeralText?: string;
}

/**
 * Parse a message that starts with `/` into a command name and arguments string.
 * Returns null if the message does not match a known command.
 */
export function parseCommand(content: string): { name: string; args: string } | null {
  if (!content.startsWith('/')) return null;

  const spaceIndex = content.indexOf(' ');
  const name = (spaceIndex === -1 ? content.slice(1) : content.slice(1, spaceIndex)).toLowerCase();
  const args = spaceIndex === -1 ? '' : content.slice(spaceIndex + 1).trim();

  // Only match known commands
  if (!BUILTIN_COMMANDS.some((cmd) => cmd.name === name)) return null;

  return { name, args };
}

/**
 * Execute a built-in slash command.
 *
 * Returns a CommandResult indicating how to proceed:
 * - `content` set: create a message with this content
 * - `ephemeral` set: return a client-only response (no message persisted)
 * - null: command not recognized (should not happen if parseCommand was used)
 */
export async function executeCommand(
  name: string,
  args: string,
  userId: string,
  channelId: string,
  serverId: string,
): Promise<CommandResult | null> {
  switch (name) {
    case 'shrug': {
      const text = args ? `${args} ` : '';
      return { content: `${text}\u00af\\_(\u30c4)_/\u00af` };
    }

    case 'tableflip': {
      const text = args ? `${args} ` : '';
      return { content: `${text}(\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b` };
    }

    case 'unflip': {
      const text = args ? `${args} ` : '';
      return { content: `${text}\u252c\u2500\u252c\u30ce( \u00ba _ \u00ba\u30ce)` };
    }

    case 'me': {
      if (!args) {
        return { ephemeral: true, ephemeralText: 'Usage: /me <action>' };
      }
      return { content: `*${args}*` };
    }

    case 'nick': {
      try {
        const nickname = args.trim() || null;
        await db.sql`
          UPDATE members
          SET nickname = ${nickname}
          WHERE user_id = ${userId} AND server_id = ${serverId}
        `;
        const displayText = nickname ? `Nickname changed to **${nickname}**` : 'Nickname reset';
        return { ephemeral: true, ephemeralText: displayText };
      } catch (err) {
        console.error('Failed to change nickname:', err);
        return { ephemeral: true, ephemeralText: 'Failed to change nickname' };
      }
    }

    case 'clear': {
      // Handled entirely on the client side
      return { ephemeral: true, ephemeralText: '__clear__' };
    }

    default:
      return null;
  }
}
