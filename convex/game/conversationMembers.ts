import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { GameTable } from '../engine/gameTable';
import { DatabaseReader, DatabaseWriter } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { Conversations } from './conversations';

export const conversationMembers = defineTable({
  conversationId: v.id('conversations'),
  playerId: v.id('players'),
  status: v.union(
    v.object({ kind: v.literal('invited') }),
    v.object({ kind: v.literal('walkingOver') }),
    v.object({ kind: v.literal('participating'), started: v.number() }),
    v.object({
      kind: v.literal('left'),
      started: v.optional(v.number()),
      ended: v.number(),
      with: v.id('players'),
    }),
  ),
})
  .index('conversationId', ['conversationId', 'playerId'])
  .index('playerId', ['playerId', 'status.kind', 'status.ended'])
  .index('left', ['playerId', 'status.kind', 'status.with', 'status.ended']);

export class ConversationMembers extends GameTable<'conversationMembers'> {
  table = 'conversationMembers' as const;

  static async load(
    db: DatabaseWriter,
    engineId: Id<'engines'>,
    conversations: Conversations,
  ): Promise<ConversationMembers> {
    const rows = [];
    for (const conversation of conversations.allDocuments()) {
      const conversationRows = await db
        .query('conversationMembers')
        .withIndex('conversationId', (q) => q.eq('conversationId', conversation._id))
        .filter((q) => q.neq(q.field('status.kind'), 'left'))
        .collect();
      rows.push(...conversationRows);
    }
    return new ConversationMembers(db, engineId, rows);
  }

  constructor(
    public db: DatabaseWriter,
    public engineId: Id<'engines'>,
    rows: Doc<'conversationMembers'>[],
  ) {
    super(rows);
  }

  isActive(doc: Doc<'conversationMembers'>): boolean {
    return doc.status.kind !== 'left';
  }
}

export async function conversationMember(db: DatabaseReader, playerId: Id<'players'>) {
  // TODO: We could combine these queries if we had `.neq()` in our index query API.
  const invited = await db
    .query('conversationMembers')
    .withIndex('playerId', (q) => q.eq('playerId', playerId).eq('status.kind', 'invited'))
    .unique();
  const walkingOver = await db
    .query('conversationMembers')
    .withIndex('playerId', (q) => q.eq('playerId', playerId).eq('status.kind', 'walkingOver'))
    .unique();
  const participating = await db
    .query('conversationMembers')
    .withIndex('playerId', (q) => q.eq('playerId', playerId).eq('status.kind', 'participating'))
    .unique();

  if ([invited, walkingOver, participating].filter(Boolean).length > 1) {
    throw new Error(`Player ${playerId} is in multiple conversations`);
  }
  return invited ?? walkingOver ?? participating;
}
