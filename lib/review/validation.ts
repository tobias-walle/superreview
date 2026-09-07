import { z } from "zod";
const point = z.object({
  hunk: z.number().int().nonnegative(),
  source: z.number().int().nonnegative(),
  line: z.number().int().nonnegative(),
  text: z.string(),
});
const anchor = z.object({
  snapshotId: z.string().optional(),
  path: z.string().min(1),
  fingerprint: z.string(),
  side: z.enum(["old", "new"]),
  start: point,
  end: point,
  excerpt: z.string().max(100000),
});
export const threadSchema = z.object({
  id: z.string().min(1),
  anchor,
  created: z.number(),
  resolved: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        body: z.string().max(30000),
        created: z.number(),
        edited: z.number().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .max(10000),
});
const version = z.object({ object: z.string().nullable(), mode: z.string() });
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread"), thread: threadSchema }),
  z.object({
    type: z.literal("checkpoint"),
    checkpoint: z.object({
      path: z.string(),
      fingerprint: z.string(),
      viewed: z.boolean(),
      manual: z.boolean(),
      snapshotId: z.string(),
      created: z.number(),
      evidence: z.object({ before: version, after: version, key: z.string() }).optional(),
    }),
  }),
  z.object({ type: z.literal("submit"), summary: z.string().max(30000) }),
  z.object({ type: z.literal("archive"), archived: z.boolean() }),
]);
export const draftsSchema = z
  .array(
    z.object({
      id: z.string(),
      anchor,
      threadId: z.string().optional(),
      messageId: z.string().optional(),
      body: z.string().max(30000),
    }),
  )
  .max(1000);
