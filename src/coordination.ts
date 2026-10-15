import type { TeamState } from './types.ts'
import { readUnreadMailbox, discardMailboxMessages } from './state.ts'
import { isCurrentMail, mailboxContent } from './mailbox.ts'
import { foldFailureInbox } from './availability.ts'

export interface InboxEntry { id: string; from: string; content: string; ts: number }

export function syncInboxLimit(value = 10): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error('inbox_limit must be an integer from 1 to 50')
  return value
}

/** Caller holds the team lock and checks participant identity. This function never reacquires it. */
export async function collectParticipantInbox(root: string, team: TeamState, recipient: string, limit: number): Promise<{ inbox: InboxEntry[]; ids: string[]; remaining: number }> {
  const unread = await readUnreadMailbox(root, team.id, recipient)
  const current = unread.filter(message => isCurrentMail(team, message))
  await discardMailboxMessages(root, team.id, recipient, unread.filter(message => !isCurrentMail(team, message)).map(message => message.id))
  const groups = foldFailureInbox(current)
  const selected = groups.slice(0, syncInboxLimit(limit))
  return {
    inbox: selected.map(({ message }) => ({ id: message.id, from: message.from, content: mailboxContent(message), ts: message.ts })),
    ids: selected.flatMap(group => group.ids), remaining: groups.length - selected.length,
  }
}

export function formatInbox(inbox: readonly InboxEntry[], remaining: number): string {
  if (!inbox.length) return 'No unread direct messages.'
  return `Unread direct messages (communications, not independently verified findings):\n${inbox.map(message => `[${message.id}] ${message.from}: ${message.content}`).join('\n\n')}${remaining ? `\n${remaining} more message group(s) remain; call sync again.` : ''}`
}
