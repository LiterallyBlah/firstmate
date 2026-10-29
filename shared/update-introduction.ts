/** A discovery preference only: never feature policy, approval or a decision. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PROJECT_INTRODUCTION_VERSION = 1;
export const IntroductionInputSchema = z.object({ homeId: z.string().min(1), version: z.literal(PROJECT_INTRODUCTION_VERSION) }).strict();
export const IntroductionStateSchema = z.object({ homeId: z.string(), version: z.literal(PROJECT_INTRODUCTION_VERSION),
  state: z.enum(["available", "dismissed", "held"]) }).strict();
export const readUpdateIntroduction = defineRpc({ name: "firstmate.introduction.read", input: IntroductionInputSchema, output: IntroductionStateSchema });
export const dismissUpdateIntroduction = defineRpc({ name: "firstmate.introduction.dismiss", input: IntroductionInputSchema, output: IntroductionStateSchema });
