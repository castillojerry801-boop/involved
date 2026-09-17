import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    const imageBase64 = formData.get('imageBase64') as string | null

    let base64Data: string
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer()
      base64Data = Buffer.from(bytes).toString('base64')
      mediaType = (imageFile.type as typeof mediaType) || 'image/jpeg'
    } else if (imageBase64) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })
      mediaType = match[1] as typeof mediaType
      base64Data = match[2]
    } else {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            {
              type: 'text',
              text: 'Please analyze this food photo and provide detailed nutritional estimates.',
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const analysis = JSON.parse(text)
    return NextResponse.json(analysis)
  } catch (err) {
    console.error('AI analyze error:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
