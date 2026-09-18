---
name: feedback_openai_not_anthropic
description: This project uses OpenAI exclusively — not Anthropic/Claude SDK
metadata:
  type: feedback
---

This project uses OpenAI for all AI features. Do not use `@anthropic-ai/sdk` or suggest `ANTHROPIC_API_KEY`.

**Why:** User corrected this directly — the app is wired to OpenAI only.

**How to apply:** All AI calls (coach, vision, extraction, workout generation) go through `lib/ai/client.ts` → `getOpenAI()`. Use `openai.chat.completions.create()` with vision-capable models (gpt-4o) for image analysis.
