// The only file allowed to import a provider package (@ai-sdk/openai or
// @ai-sdk/anthropic). Everything else gets its model from getModel().
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type Provider = "openai" | "anthropic";

function requireEnv(name: string, provider: Provider): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is missing. Set it in .env.local (or in Vercel) to use AI_PROVIDER=${provider}.`,
    );
  }
  return value;
}

/** "anthropic" if AI_PROVIDER says so, otherwise "openai". */
export function getProvider(): Provider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "anthropic"
    ? "anthropic"
    : "openai";
}

/** Returns the language model chosen by AI_PROVIDER. */
export function getModel(): LanguageModel {
  const provider = getProvider();

  if (provider === "anthropic") {
    const apiKey = requireEnv("ANTHROPIC_API_KEY", provider);
    const modelId = requireEnv("ANTHROPIC_MODEL", provider);
    return createAnthropic({ apiKey })(modelId);
  }

  const apiKey = requireEnv("OPENAI_API_KEY", provider);
  const modelId = requireEnv("OPENAI_MODEL", provider);
  return createOpenAI({ apiKey })(modelId);
}
