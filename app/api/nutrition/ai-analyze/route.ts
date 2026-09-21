import { NextRequest, NextResponse } from 'next/server'
import { getOpenAI } from '@/lib/ai/client'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are a nutrition expert and dietitian. When given a photo of food, analyze it and estimate the nutritional content as accurately as possible.

CONFIDENCE HIERARCHY — apply strictly in this order:
1. User-stated information (portions, brands, ingredients, cooking method) — HIGHEST AUTHORITY, always overrides visual estimates
2. Visible text or labels in the photo
3. Visual portion estimation
4. Standard portion assumptions — only when nothing else is available

When user notes are provided about the meal:
- Use them to correct or refine your visual estimates
- Set portionSource to "user_stated" when the user specified the portion
- Set foodSource to "user_stated" when the user identified the food
- Set cookingMethodSource to "user_stated" when the user described the cooking method
- If the user's description clearly contradicts what you see in the image, set conflictNote to a brief explanation

Respond ONLY with a JSON object in this exact format (no markdown, no extra text):
{
  "foods": [
    {
      "name": "Food item name",
      "estimatedAmount": "e.g. 1 cup, 6 oz, 2 pieces",
      "calories": 250,
      "proteinG": 20,
      "carbohydrateG": 30,
      "fatG": 8,
      "fiberG": 3,
      "sodiumMg": 400,
      "confidence": "high|medium|low",
      "portionSource": "user_stated|visual_estimate|standard_portion",
      "foodSource": "user_stated|visual_identified|ai_inferred",
      "brandSource": "user_stated|visual_label|unknown",
      "cookingMethodSource": "user_stated|visual_inferred|assumed",
      "notes": "Any relevant notes about the estimate",
      "conflictNote": "Only include if user notes clearly conflict with the image"
    }
  ],
  "totalCalories": 250,
  "disclaimer": "These are estimates based on visual analysis. Actual values may vary."
}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { imageBase64?: string; userContext?: string }
    const { imageBase64, userContext } = body

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })

    const openai = getOpenAI()

    const userContent: OpenAI.ChatCompletionContentPart[] = []
    if (userContext?.trim()) {
      userContent.push({ type: 'text', text: `User notes about this meal: ${userContext.trim()}` })
    }
    userContent.push({ type: 'image_url', image_url: { url: imageBase64, detail: 'high' } })
    userContent.push({
      type: 'text',
      text: 'Analyze this food photo and provide nutritional estimates. Apply the confidence hierarchy from the system prompt.',
    })

    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL_VISION ?? 'gpt-4o',
      max_tokens: 1200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    let text = response.choices[0]?.message?.content ?? ''
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const analysis = JSON.parse(text)
    return NextResponse.json(analysis)
  } catch (err) {
    console.error('AI analyze error:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
