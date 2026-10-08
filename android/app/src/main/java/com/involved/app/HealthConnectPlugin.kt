package com.involved.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

@CapacitorPlugin(name = "HealthKit")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.Main)

    companion object {
        val PERMISSIONS = setOf(
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(WeightRecord::class),
        )
    }

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE)
            HealthConnectClient.getOrCreate(context)
        else null

    // ─── isAvailable ──────────────────────────────────────────────────────────

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE)
        call.resolve(ret)
    }

    // ─── requestPermissions ───────────────────────────────────────────────────

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val c = client() ?: run { call.reject("Health Connect not available on this device"); return }
        scope.launch {
            val granted = withContext(Dispatchers.IO) { c.permissionController.getGrantedPermissions() }
            if (granted.containsAll(PERMISSIONS)) {
                val ret = JSObject(); ret.put("granted", true); call.resolve(ret)
            } else {
                val intent = PermissionController
                    .createRequestPermissionResultContract()
                    .createIntent(context, PERMISSIONS)
                startActivityForResult(call, intent, "onPermissionsResult")
            }
        }
    }

    @ActivityCallback
    private fun onPermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            val granted = withContext(Dispatchers.IO) { c.permissionController.getGrantedPermissions() }
            val ret = JSObject()
            ret.put("granted", granted.containsAll(PERMISSIONS))
            call.resolve(ret)
        }
    }

    // ─── queryWorkouts ────────────────────────────────────────────────────────

    @PluginMethod
    fun queryWorkouts(call: PluginCall) {
        val (start, end) = parseDates(call) ?: return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            try {
                val sessions = withContext(Dispatchers.IO) {
                    c.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class,
                        TimeRangeFilter.between(start, end))).records
                }

                val arr = JSArray()
                for (s in sessions) {
                    val range = TimeRangeFilter.between(s.startTime, s.endTime)
                    val (hrRecords, activeKcal, totalKcal) = withContext(Dispatchers.IO) {
                        val hr = c.readRecords(ReadRecordsRequest(HeartRateRecord::class, range)).records
                        val active = c.readRecords(ReadRecordsRequest(ActiveCaloriesBurnedRecord::class, range))
                            .records.sumOf { it.energy.inKilocalories }
                        val total = c.readRecords(ReadRecordsRequest(TotalCaloriesBurnedRecord::class, range))
                            .records.sumOf { it.energy.inKilocalories }
                        Triple(hr, active, total)
                    }

                    val obj = JSObject()
                    obj.put("uuid",               s.metadata.id)
                    obj.put("workoutActivityType", s.exerciseType)
                    obj.put("platform",            "health_connect")
                    obj.put("startDate",           s.startTime.toString())
                    obj.put("endDate",             s.endTime.toString())
                    obj.put("duration",            Duration.between(s.startTime, s.endTime).seconds.toDouble())
                    obj.put("sourceName",          s.metadata.dataOrigin.packageName)
                    obj.put("sourceBundle",        s.metadata.dataOrigin.packageName)

                    if (activeKcal > 0) obj.put("activeEnergyKcal", activeKcal)
                    if (totalKcal  > 0) obj.put("totalEnergyKcal",  totalKcal)

                    val bpms = hrRecords.flatMap { r -> r.samples.map { it.beatsPerMinute } }
                    if (bpms.isNotEmpty()) {
                        obj.put("avgHeartRate",  bpms.average().toInt())
                        obj.put("maxHeartRate",  bpms.max().toInt())
                        obj.put("hrSampleCount", bpms.size)
                    }
                    arr.put(obj)
                }

                val ret = JSObject(); ret.put("workouts", arr); call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Workout query error: ${e.message}")
            }
        }
    }

    // ─── querySteps ───────────────────────────────────────────────────────────

    @PluginMethod
    fun querySteps(call: PluginCall) {
        val (start, end) = parseDates(call) ?: return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            try {
                val records = withContext(Dispatchers.IO) {
                    c.readRecords(ReadRecordsRequest(StepsRecord::class,
                        TimeRangeFilter.between(start, end))).records
                }

                val zone = ZoneId.systemDefault()
                val byDate = mutableMapOf<String, Long>()
                for (r in records) {
                    val date = r.startTime.atZone(zone).toLocalDate().toString()
                    byDate[date] = (byDate[date] ?: 0L) + r.count
                }

                val arr = JSArray()
                for ((date, count) in byDate.entries.sortedBy { it.key }) {
                    val obj = JSObject()
                    obj.put("date",  "${date}T00:00:00Z")
                    obj.put("steps", count)
                    arr.put(obj)
                }
                val ret = JSObject(); ret.put("dailySteps", arr); call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Steps query error: ${e.message}")
            }
        }
    }

    // ─── queryDailyEnergy ─────────────────────────────────────────────────────

    @PluginMethod
    fun queryDailyEnergy(call: PluginCall) {
        val (start, end) = parseDates(call) ?: return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            try {
                val (activeRecs, totalRecs) = withContext(Dispatchers.IO) {
                    val a = c.readRecords(ReadRecordsRequest(ActiveCaloriesBurnedRecord::class,
                        TimeRangeFilter.between(start, end))).records
                    val t = c.readRecords(ReadRecordsRequest(TotalCaloriesBurnedRecord::class,
                        TimeRangeFilter.between(start, end))).records
                    Pair(a, t)
                }

                val zone = ZoneId.systemDefault()
                val activeByDate = mutableMapOf<String, Double>()
                val totalByDate  = mutableMapOf<String, Double>()

                for (r in activeRecs) {
                    val d = r.startTime.atZone(zone).toLocalDate().toString()
                    activeByDate[d] = (activeByDate[d] ?: 0.0) + r.energy.inKilocalories
                }
                for (r in totalRecs) {
                    val d = r.startTime.atZone(zone).toLocalDate().toString()
                    totalByDate[d] = (totalByDate[d] ?: 0.0) + r.energy.inKilocalories
                }

                val arr = JSArray()
                for (date in (activeByDate.keys + totalByDate.keys).toSortedSet()) {
                    val obj   = JSObject()
                    val active = activeByDate[date] ?: 0.0
                    val total  = totalByDate[date]  ?: 0.0
                    obj.put("date", "${date}T00:00:00Z")
                    if (active > 0) obj.put("activeEnergyKcal", active)
                    val basal = total - active
                    if (basal  > 0) obj.put("basalEnergyKcal",  basal)
                    arr.put(obj)
                }
                val ret = JSObject(); ret.put("dailyEnergy", arr); call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Energy query error: ${e.message}")
            }
        }
    }

    // ─── queryBodyMass ────────────────────────────────────────────────────────

    @PluginMethod
    fun queryBodyMass(call: PluginCall) {
        val (start, end) = parseDates(call) ?: return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            try {
                val records = withContext(Dispatchers.IO) {
                    c.readRecords(ReadRecordsRequest(WeightRecord::class,
                        TimeRangeFilter.between(start, end))).records
                }

                val arr = JSArray()
                for (r in records.sortedByDescending { it.time }) {
                    val obj = JSObject()
                    obj.put("uuid",       r.metadata.id)
                    obj.put("weightKg",   r.weight.inKilograms)
                    obj.put("recordedAt", r.time.toString())
                    obj.put("sourceName", r.metadata.dataOrigin.packageName)
                    arr.put(obj)
                }
                val ret = JSObject(); ret.put("samples", arr); call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Weight query error: ${e.message}")
            }
        }
    }

    // ─── queryRestingHeartRate ────────────────────────────────────────────────

    @PluginMethod
    fun queryRestingHeartRate(call: PluginCall) {
        val (start, end) = parseDates(call) ?: return
        val c = client() ?: run { call.reject("Health Connect not available"); return }
        scope.launch {
            try {
                val records = withContext(Dispatchers.IO) {
                    c.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class,
                        TimeRangeFilter.between(start, end))).records
                }

                val arr = JSArray()
                for (r in records.sortedByDescending { it.time }) {
                    val obj = JSObject()
                    obj.put("uuid",       r.metadata.id)
                    obj.put("bpm",        r.beatsPerMinute.toInt())
                    obj.put("recordedAt", r.time.toString())
                    arr.put(obj)
                }
                val ret = JSObject(); ret.put("samples", arr); call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Resting HR query error: ${e.message}")
            }
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun parseDates(call: PluginCall): Pair<Instant, Instant>? {
        val s = call.getString("startDate")
        val e = call.getString("endDate")
        if (s == null || e == null) {
            call.reject("Missing startDate or endDate (ISO8601 required)")
            return null
        }
        return try { Pair(Instant.parse(s), Instant.parse(e)) }
        catch (ex: Exception) { call.reject("Invalid date format: ${ex.message}"); null }
    }
}
