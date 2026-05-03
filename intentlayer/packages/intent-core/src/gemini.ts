import axios from "axios";
import { z } from "zod";
import type { IntentProof, Policy } from "./types";

export const GeminiDecisionSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT"]),
  reason: z.string().min(1).max(500),
  risk: z.enum(["low", "medium", "high"]),
});
export type GeminiDecision = z.infer<typeof GeminiDecisionSchema>;

export interface GeminiDecisionConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
}

function proofForPrompt(proof: IntentProof) {
  return {
    ...proof,
    value: proof.value.toString(),
    nonce: proof.nonce.toString(),
    expiry: proof.expiry.toString(),
  };
}

function policyForPrompt(policy: Policy) {
  return {
    ...policy,
    maxValuePerTx: policy.maxValuePerTx.toString(),
    dailyBudget: policy.dailyBudget.toString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableGeminiError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return true;
  const status = err.response?.status;
  if (status === undefined) return true;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function describeGeminiError(err: unknown): string {
  if (!axios.isAxiosError(err)) return (err as Error).message;
  const status = err.response?.status;
  const apiMessage = err.response?.data?.error?.message;
  return status ? `Gemini HTTP ${status}${apiMessage ? `: ${apiMessage}` : ""}` : err.message;
}

export async function decideIntentWithGemini(
  cfg: GeminiDecisionConfig,
  proof: IntentProof,
  policy: Policy,
): Promise<GeminiDecision> {
  if (!cfg.apiKey || cfg.apiKey.startsWith("YOUR_")) {
    throw new Error("GEMINI_API_KEY is required for live policy reasoning");
  }
  const model = cfg.model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const prompt = [
    "You are IntentLayer Agent B, an autonomous payee agent.",
    "Decide whether to accept this payment intent after deterministic policy checks passed.",
    "Reject if the intent is inconsistent, risky, not explainable, or appears unrelated to the policy.",
    "Return only JSON matching the response schema.",
    `Policy: ${JSON.stringify(policyForPrompt(policy))}`,
    `IntentProof: ${JSON.stringify(proofForPrompt(proof))}`,
  ].join("\n\n");

  const maxRetries = cfg.maxRetries ?? Number(process.env.GEMINI_MAX_RETRIES ?? "6");
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await axios.post(
        url,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 256,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? "0") },
            responseJsonSchema: {
              type: "object",
              properties: {
                decision: { type: "string", enum: ["ACCEPT", "REJECT"] },
                reason: { type: "string" },
                risk: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["decision", "reason", "risk"],
            },
          },
        },
        {
          headers: {
            "x-goog-api-key": cfg.apiKey,
            "content-type": "application/json",
          },
          timeout: cfg.timeoutMs ?? 12_000,
        },
      );

      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string" || text.trim() === "") {
        throw new Error("Gemini returned an empty decision");
      }
      return GeminiDecisionSchema.parse(JSON.parse(text));
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !retryableGeminiError(err)) break;
      // exponential backoff capped at 30 s — gives ~2 min total on a 503 spike
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
      const status = axios.isAxiosError(err) ? err.response?.status : "n/a";
      console.warn(`[gemini] transient error (attempt ${attempt}, status ${status}) — retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw new Error(describeGeminiError(lastErr));
}
