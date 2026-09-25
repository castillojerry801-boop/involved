import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: "promise"),
        CAPPluginMethod(name: "requestPermissions", returnType: "promise"),
        CAPPluginMethod(name: "queryWorkouts", returnType: "promise"),
        CAPPluginMethod(name: "queryBodyMass", returnType: "promise"),
        CAPPluginMethod(name: "queryRestingHeartRate", returnType: "promise"),
        CAPPluginMethod(name: "querySteps", returnType: "promise"),
        CAPPluginMethod(name: "queryDailyEnergy", returnType: "promise"),
    ]

    private let store = HKHealthStore()

    // ─── Availability ─────────────────────────────────────────────────────────

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    // ─── Permissions ──────────────────────────────────────────────────────────

    public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        let readTypes: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)!,
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .distanceCycling)!,
            HKQuantityType.quantityType(forIdentifier: .stepCount)!,
            HKQuantityType.quantityType(forIdentifier: .vo2Max)!,
            HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
            HKQuantityType.quantityType(forIdentifier: .bodyMass)!,
        ]

        store.requestAuthorization(toShare: nil, read: readTypes) { granted, error in
            if let error = error {
                call.reject("Authorization error: \(error.localizedDescription)")
                return
            }
            call.resolve(["granted": granted])
        }
    }

    // ─── Query workouts ───────────────────────────────────────────────────────

    @objc func queryWorkouts(_ call: CAPPluginCall) {
        guard let startDateStr = call.getString("startDate"),
              let endDateStr = call.getString("endDate"),
              let startDate = ISO8601DateFormatter().date(from: startDateStr),
              let endDate = ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid or missing startDate/endDate (ISO8601 required)")
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Workout query error: \(error.localizedDescription)")
                return
            }

            let workouts = (samples as? [HKWorkout]) ?? []
            let group = DispatchGroup()
            var results: [[String: Any]] = Array(repeating: [:], count: workouts.count)

            for (i, workout) in workouts.enumerated() {
                group.enter()
                self.buildWorkoutDict(workout) { dict in
                    results[i] = dict
                    group.leave()
                }
            }

            group.notify(queue: .main) {
                call.resolve(["workouts": results])
            }
        }

        store.execute(query)
    }

    private func buildWorkoutDict(_ workout: HKWorkout, completion: @escaping ([String: Any]) -> Void) {
        let iso = ISO8601DateFormatter()
        var dict: [String: Any] = [
            "uuid": workout.uuid.uuidString,
            "workoutActivityType": workout.workoutActivityType.rawValue,
            "startDate": iso.string(from: workout.startDate),
            "endDate": iso.string(from: workout.endDate),
            "duration": workout.duration,
            "sourceName": workout.sourceRevision.source.name,
            "sourceBundle": workout.sourceRevision.source.bundleIdentifier,
        ]

        if let activeEnergy = workout.statistics(for: HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!)?.sumQuantity() {
            dict["activeEnergyKcal"] = activeEnergy.doubleValue(for: .kilocalorie())
        }
        if let basalEnergy = workout.statistics(for: HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)!)?.sumQuantity(),
           let active = dict["activeEnergyKcal"] as? Double {
            dict["totalEnergyKcal"] = basalEnergy.doubleValue(for: .kilocalorie()) + active
        }
        if let distance = workout.statistics(for: HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!)?.sumQuantity() {
            dict["distanceM"] = distance.doubleValue(for: .meter())
        } else if let distance = workout.statistics(for: HKQuantityType.quantityType(forIdentifier: .distanceCycling)!)?.sumQuantity() {
            dict["distanceM"] = distance.doubleValue(for: .meter())
        }

        let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let hrPredicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate)
        let hrQuery = HKSampleQuery(sampleType: hrType, predicate: hrPredicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            let hrSamples = (samples as? [HKQuantitySample]) ?? []
            let hrValues = hrSamples.map { $0.quantity.doubleValue(for: HKUnit(from: "count/min")) }
            if !hrValues.isEmpty {
                dict["avgHeartRate"] = Int(hrValues.reduce(0, +) / Double(hrValues.count))
                dict["maxHeartRate"] = Int(hrValues.max()!)
                dict["hrSampleCount"] = hrValues.count
            }
            completion(dict)
        }
        store.execute(hrQuery)
    }

    // ─── Query body mass ──────────────────────────────────────────────────────

    @objc func queryBodyMass(_ call: CAPPluginCall) {
        guard let startDateStr = call.getString("startDate"),
              let endDateStr = call.getString("endDate"),
              let startDate = ISO8601DateFormatter().date(from: startDateStr),
              let endDate = ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid or missing startDate/endDate (ISO8601 required)")
            return
        }

        let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass)!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: bodyMassType, predicate: predicate, limit: 90, sortDescriptors: [sortDescriptor]) { _, samples, error in
            if let error = error {
                call.reject("Body mass query error: \(error.localizedDescription)")
                return
            }
            let samples = (samples as? [HKQuantitySample]) ?? []
            let iso = ISO8601DateFormatter()
            let results: [[String: Any]] = samples.map { sample in
                [
                    "uuid": sample.uuid.uuidString,
                    "weightKg": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                    "recordedAt": iso.string(from: sample.startDate),
                    "sourceName": sample.sourceRevision.source.name,
                ]
            }
            call.resolve(["samples": results])
        }

        store.execute(query)
    }

    // ─── Query daily step count ───────────────────────────────────────────────
    // Uses HKStatisticsCollectionQuery with 1-day intervals so one call returns
    // per-day totals across the full sync window — no N-per-day round trips.

    @objc func querySteps(_ call: CAPPluginCall) {
        guard let startDateStr = call.getString("startDate"),
              let endDateStr = call.getString("endDate"),
              let startDate = ISO8601DateFormatter().date(from: startDateStr),
              let endDate = ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid or missing startDate/endDate (ISO8601 required)")
            return
        }

        let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let anchorDate = Calendar.current.startOfDay(for: startDate)
        var interval = DateComponents()
        interval.day = 1

        let query = HKStatisticsCollectionQuery(
            quantityType: stepType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum,
            anchorDate: anchorDate,
            intervalComponents: interval
        )

        query.initialResultsHandler = { _, collection, error in
            if let error = error {
                call.reject("Steps query error: \(error.localizedDescription)")
                return
            }

            var results: [[String: Any]] = []
            let iso = ISO8601DateFormatter()

            collection?.enumerateStatistics(from: startDate, to: endDate) { stats, _ in
                if let sum = stats.sumQuantity() {
                    let count = Int(sum.doubleValue(for: .count()))
                    if count > 0 {
                        results.append([
                            "date": iso.string(from: stats.startDate),
                            "steps": count,
                        ])
                    }
                }
            }

            call.resolve(["dailySteps": results])
        }

        store.execute(query)
    }

    // ─── Query daily active + basal energy burned ─────────────────────────────
    // Runs two HKStatisticsCollectionQuery instances in parallel (one per type)
    // and merges by date so a single call returns per-day totals for both.

    @objc func queryDailyEnergy(_ call: CAPPluginCall) {
        guard let startDateStr = call.getString("startDate"),
              let endDateStr = call.getString("endDate"),
              let startDate = ISO8601DateFormatter().date(from: startDateStr),
              let endDate = ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid or missing startDate/endDate (ISO8601 required)")
            return
        }

        let anchorDate = Calendar.current.startOfDay(for: startDate)
        var interval = DateComponents()
        interval.day = 1
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let iso = ISO8601DateFormatter()

        // Separate dicts; each is written by exactly one query handler — no contention.
        var activeByDate: [String: Double] = [:]
        var basalByDate: [String: Double] = [:]
        let group = DispatchGroup()

        // Active energy burned (all-day, not just workouts)
        group.enter()
        let activeType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        let activeQuery = HKStatisticsCollectionQuery(
            quantityType: activeType, quantitySamplePredicate: predicate,
            options: .cumulativeSum, anchorDate: anchorDate, intervalComponents: interval
        )
        activeQuery.initialResultsHandler = { _, collection, _ in
            defer { group.leave() }
            collection?.enumerateStatistics(from: startDate, to: endDate) { stats, _ in
                if let sum = stats.sumQuantity() {
                    activeByDate[iso.string(from: stats.startDate)] = sum.doubleValue(for: .kilocalorie())
                }
            }
        }

        // Basal (resting) energy burned
        group.enter()
        let basalType = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)!
        let basalQuery = HKStatisticsCollectionQuery(
            quantityType: basalType, quantitySamplePredicate: predicate,
            options: .cumulativeSum, anchorDate: anchorDate, intervalComponents: interval
        )
        basalQuery.initialResultsHandler = { _, collection, _ in
            defer { group.leave() }
            collection?.enumerateStatistics(from: startDate, to: endDate) { stats, _ in
                if let sum = stats.sumQuantity() {
                    basalByDate[iso.string(from: stats.startDate)] = sum.doubleValue(for: .kilocalorie())
                }
            }
        }

        store.execute(activeQuery)
        store.execute(basalQuery)

        group.notify(queue: .main) {
            let allDates = Set(activeByDate.keys).union(Set(basalByDate.keys)).sorted()
            let results: [[String: Any]] = allDates.map { key in
                var dict: [String: Any] = ["date": key]
                if let a = activeByDate[key] { dict["activeEnergyKcal"] = a }
                if let b = basalByDate[key]  { dict["basalEnergyKcal"]  = b }
                return dict
            }
            call.resolve(["dailyEnergy": results])
        }
    }

    // ─── Query resting heart rate ─────────────────────────────────────────────

    @objc func queryRestingHeartRate(_ call: CAPPluginCall) {
        guard let startDateStr = call.getString("startDate"),
              let endDateStr = call.getString("endDate"),
              let startDate = ISO8601DateFormatter().date(from: startDateStr),
              let endDate = ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid or missing startDate/endDate (ISO8601 required)")
            return
        }

        let rhrType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: rhrType, predicate: predicate, limit: 90, sortDescriptors: [sortDescriptor]) { _, samples, error in
            if let error = error {
                call.reject("RHR query error: \(error.localizedDescription)")
                return
            }
            let samples = (samples as? [HKQuantitySample]) ?? []
            let iso = ISO8601DateFormatter()
            let results: [[String: Any]] = samples.map { sample in
                [
                    "uuid": sample.uuid.uuidString,
                    "bpm": Int(sample.quantity.doubleValue(for: HKUnit(from: "count/min"))),
                    "recordedAt": iso.string(from: sample.startDate),
                ]
            }
            call.resolve(["samples": results])
        }

        store.execute(query)
    }
}
