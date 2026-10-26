/** Routing describes conversation only. It never grants work/release authority. */
import { z } from "zod";

export const DiscussionTargetSchema = z.object({
  homeId: z.string().min(1).max(1024), scopeId: z.string().min(1).max(256), scopeVersion: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(), agentId: z.string().max(256).nullable(),
}).strict();
export type DiscussionTarget = z.infer<typeof DiscussionTargetSchema>;
export const DiscussionRouteSchema = z.object({
  target: DiscussionTargetSchema, recipient: z.string().max(1000), projectIds: z.array(z.string().min(1).max(256)).max(16),
  conversationId: z.string().min(1).max(200), replyTo: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/).nullable(),
}).strict();
export type DiscussionRoute = z.infer<typeof DiscussionRouteSchema>;
export interface DiscussionAddress { id: string; title: string; aliases: string[]; target: DiscussionTarget }
export interface DiscussionProject { id: string; name: string }

/** Only leading address tokens are routing syntax. Body quotes, code and later mentions are words.
 * A dedicated discussion supplies its explicit default; the shared stream defaults to General.
 */
export function resolveDiscussion<T extends DiscussionAddress>(text: string, scopes: readonly T[], projects: readonly DiscussionProject[], defaultScope = "general") {
  let rest = text.trimStart(), recipient: string | null = null;
  const projectIds: string[] = [];
  while (/^[@#]/.test(rest) && !/^#{1,6}\s/.test(rest)) {
    const match = /^([@#])([a-zA-Z0-9_.-]+)(?=\s|$)/.exec(rest);
    if (!match) throw new Error("Use a complete @mate or #project address followed by a space.");
    const [, marker, name] = match;
    if (marker === "@") {
      if (recipient !== null) throw new Error("Choose one recipient; messages are never broadcast.");
      const found = scopes.filter(s => [s.id, ...s.aliases].some(a => a.toLowerCase() === name!.toLowerCase()));
      if (found.length !== 1) throw new Error(`${found.length ? "Ambiguous" : "Unknown"} recipient @${name}. Choose a scope explicitly.`);
      recipient = found[0]!.id;
    } else {
      const found = [...new Map(projects.filter(p => [p.id, p.name].some(a => a.toLowerCase() === name!.toLowerCase())).map(p => [p.id, p])).values()];
      if (found.length !== 1) throw new Error(`${found.length ? "Ambiguous" : "Unknown"} project #${name}. Choose project context explicitly.`);
      if (!projectIds.includes(found[0]!.id)) projectIds.push(found[0]!.id);
    }
    rest = rest.slice(match[0].length).trimStart();
  }
  const scope = scopes.find(s => s.id === (recipient ?? defaultScope));
  if (!scope) throw new Error("The selected recipient is unavailable. Refresh scopes before sending.");
  if (!rest.trim()) throw new Error("Write a message after the address.");
  return { scope, projectIds, text: rest.trim() };
}

/** JSON tuples avoid collisions and retain the scope across session replacement. */
export const scopeConversationKey = (homeId: string, scopeId: string, conversationId = "main") =>
  JSON.stringify(["firstmate.scope-conversation/1", homeId, scopeId, conversationId]);
export const scopeDraftKey = (hostId: string, homeId: string, scopeId: string, conversationId = "main") =>
  JSON.stringify(["firstmate.scope-draft/1", hostId, homeId, scopeId, conversationId]);
