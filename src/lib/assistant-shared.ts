/**
 * Plain module, deliberately not "use server": a "use server" file may only
 * export async functions, so this schema/type can't live in assistant.ts
 * next to the actions that use it. The widget imports the type from here.
 */
import { z } from "zod";

/**
 * A change the assistant proposes making to the user's records. Deliberately
 * a *proposal*, never applied automatically: the whole point of this app is
 * that the tracking data is trustworthy, and a model that silently logged an
 * application the user only mentioned hypothetically ("要不要投字节") would
 * quietly corrupt exactly the thing being tracked. The UI renders these as
 * buttons; nothing is written until the user clicks one.
 *
 * The shape is flat rather than a per-type union because non-Gemini
 * providers get the schema only as a prompt hint (see withSchemaReminder) —
 * a discriminated union with different fields per branch is what they get
 * wrong most often, whereas one flat object with nullable fields survives.
 */
export const assistantActionSchema = z.object({
  type: z.enum([
    "add_task",
    "log_application",
    "add_position",
    "update_stage",
    "promote_lead",
    "add_contact",
  ]),
  label: z.string(),
  companyName: z.string().nullish(),
  title: z.string().nullish(),
  /// A person's name, only for add_contact — kept separate from `title`
  /// (used for job/position titles by every other action type; reusing it
  /// for a person's name would collide in meaning).
  contactName: z.string().nullish(),
  date: z.string().nullish(),
  /// Window end, for a 笔试/测评 that gives a range ("8/26-8/30 期间") rather
  /// than a single deadline — mirrors StageHistory.nextDeadlineEnd /
  /// PersonalTask.dueDateEnd.
  dateEnd: z.string().nullish(),
  stage: z.string().nullish(),
  targetId: z.string().nullish(),
  note: z.string().nullish(),
});

export type AssistantAction = z.infer<typeof assistantActionSchema>;

export type AssistantChatMessage = { role: "user" | "assistant"; content: string };
