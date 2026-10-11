import 'server-only'
import { prisma } from '@/lib/prisma'
import { fetchActivities, refreshAccessToken } from './client'
import { mapStravaType } from './activity-map'

const THIRTY_DAYS_S = 30 * 24 * 60 * 60
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 min

export async function syncStravaActivities(
  userId: string,
  options: { initialSync?: boolean } = {},
): Promise<{ synced: number }> {
  // 1. Load token
  const token = await prisma.stravaToken.findUnique({ where: { userId } })
  if (!token) throw new Error('No Strava token for user')

  // 2. Refresh if expiring soon
  let accessToken = token.accessToken
  if (token.expiresAt.getTime() < Date.now() + REFRESH_BUFFER_MS) {
    const fresh = await refreshAccessToken(token.refreshToken)
    await prisma.stravaToken.update({
      where: { userId },
      data: {
        accessToken:  fresh.accessToken,
        refreshToken: fresh.refreshToken,
        expiresAt:    fresh.expiresAt,
      },
    })
    accessToken = fresh.accessToken
  }

  // 3. Determine after timestamp
  let after: number
  if (options.initialSync) {
    after = Math.floor(Date.now() / 1000) - THIRTY_DAYS_S
  } else {
    const cursor = await prisma.healthSyncCursor.findUnique({
      where: {
        userId_provider_dataType: { userId, provider: 'strava', dataType: 'activities' },
      },
    })
    after = cursor?.lastAnchor
      ? parseInt(cursor.lastAnchor, 10)
      : Math.floor(Date.now() / 1000) - THIRTY_DAYS_S
  }

  // 4. Paginate
  let synced = 0
  let page = 1
  while (true) {
    const batch = await fetchActivities(accessToken, { after, perPage: 10, page })
    if (batch.length === 0) break

    for (const activity of batch) {
      const externalId  = String(activity.id)
      const activityType = mapStravaType(activity.sport_type || activity.type)
      const startedAt   = new Date(activity.start_date)
      const endedAt     = new Date(startedAt.getTime() + activity.elapsed_time * 1000)

      const shared = {
        activityType,
        title:           activity.name,
        endedAt,
        durationSeconds: activity.elapsed_time,
        activeEnergyKcal: activity.calories ? activity.calories : null,
        distanceM:       activity.distance > 0 ? activity.distance : null,
        avgHeartRateBpm: activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null,
        maxHeartRateBpm: activity.max_heartrate != null ? Math.round(activity.max_heartrate) : null,
        syncState:       'synced' as const,
      }

      const healthActivity = await prisma.healthActivity.upsert({
        where: {
          userId_provider_externalId: { userId, provider: 'strava', externalId },
        },
        create: {
          userId,
          provider:   'strava',
          externalId,
          startedAt,
          ...shared,
        },
        update: shared,
      })

      // Create a linked Workout if not already linked
      if (!healthActivity.involvedWorkoutId) {
        const workout = await prisma.workout.create({
          data: {
            userId,
            title:          activity.name,
            source:         'strava',
            status:         'completed',
            startedAt,
            completedAt:    endedAt,
            durationSeconds: activity.elapsed_time,
            notes:          activity.description || null,
          },
        })
        await prisma.healthActivity.update({
          where: { id: healthActivity.id },
          data:  { involvedWorkoutId: workout.id },
        })
      }

      synced++
    }

    if (batch.length < 10) break
    page++
  }

  // 5. Upsert cursor
  await prisma.healthSyncCursor.upsert({
    where: {
      userId_provider_dataType: { userId, provider: 'strava', dataType: 'activities' },
    },
    create: {
      userId,
      provider:    'strava',
      dataType:    'activities',
      lastSyncedAt: new Date(),
      lastAnchor:  String(Math.floor(Date.now() / 1000)),
    },
    update: {
      lastSyncedAt: new Date(),
      lastAnchor:  String(Math.floor(Date.now() / 1000)),
    },
  })

  return { synced }
}
