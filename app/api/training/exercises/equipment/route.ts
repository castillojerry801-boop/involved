import { getDistinctEquipment } from '@/lib/exercises'

export const dynamic = 'force-static'

export async function GET() {
  return Response.json({ equipment: getDistinctEquipment() })
}
