import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    calories: number
    proteinG: number
    carbohydrateG: number
    fatG: number
    fiberG?: number
    sugarG?: number
    sodiumMg?: number
  }

  const target = await prisma.nutritionTarget.create({
    data: {
      userId: user.id,
      effectiveDate: new Date(),
      calories: body.calories,
      proteinG: body.proteinG,
      carbohydrateG: body.carbohydrateG,
      fatG: body.fatG,
      fiberG: body.fiberG ?? null,
      sugarG: body.sugarG ?? null,
      sodiumMg: body.sodiumMg ?? null,
    },
  })

  return NextResponse.json({ target }, { status: 201 })
}
