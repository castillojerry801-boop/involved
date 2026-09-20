import { NextRequest, NextResponse } from 'next/server'
import { getOpenAI } from '@/lib/ai/client'

const SYSTEM_PROMPT = `You are a nutrition expert and dietitian. When given a photo of food, analyze it and estimate the nutritional content as accurately as possible.

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
      "notes": "Any relevant notes about the estimate"
    }
  ],
  "totalCalories": 250,
  "disclaimer": "These are estimates based on visual analysis. Actual values may vary."
}`

export async function POST(req: NextRequest) {
  try {
    // Client sends JSON: { imageBase64: "data:image/jpeg;base64,..." }
    const body = await req.json() as { imageBase64?: string }
    const imageBase64 = body.imageBase64

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })

    const openai = getOpenAI()

    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL_VISION ?? 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageBase64, detail: 'high' },
            },
            {
              type: 'text',
              text: 'Please analyze this food photo and provide detailed nutritional estimates.',
            },
          ],
        },
      ],
    })

    let text = response.choices[0]?.message?.content ?? ''
    // GPT-4o sometimes wraps JSON in markdown code blocks despite instructions
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const analysis = JSON.parse(text)
    return NextResponse.json(analysis)
  } catch (err) {
    console.error('AI analyze error:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
