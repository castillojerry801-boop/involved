import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {
    private let store = HKHealthStore()

    // ─── Availability ─────────────────────────────────────────────────────────

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    // ─── Permissions ──────────────────────────────────────────────────────────

    @objc func requestPermissions(_ call: CAPPluginCall) {
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
