import CoreLocation
import Foundation
import HealthKit
import os

actor HealthKitManager {
    let healthStore = HKHealthStore()
    private static let logger = Logger(subsystem: "com.healthtracker", category: "healthkit")

    // All quantity types we want to read
    static let quantityTypes: [(HKQuantityTypeIdentifier, HKUnit)] = [
        // Activity
        (.stepCount, .count()),
        (.distanceWalkingRunning, .meter()),
        (.distanceCycling, .meter()),
        (.distanceSwimming, .meter()),
        (.activeEnergyBurned, .kilocalorie()),
        (.basalEnergyBurned, .kilocalorie()),
        (.flightsClimbed, .count()),
        (.appleExerciseTime, .minute()),
        (.appleMoveTime, .minute()),
        (.appleStandTime, .minute()),
        (.pushCount, .count()),
        (.swimmingStrokeCount, .count()),

        // Vitals
        (.heartRate, HKUnit.count().unitDivided(by: .minute())),
        (.restingHeartRate, HKUnit.count().unitDivided(by: .minute())),
        (.walkingHeartRateAverage, HKUnit.count().unitDivided(by: .minute())),
        (.heartRateVariabilitySDNN, .secondUnit(with: .milli)),
        (.oxygenSaturation, .percent()),
        (.bodyTemperature, .degreeCelsius()),
        (.bloodPressureSystolic, .millimeterOfMercury()),
        (.bloodPressureDiastolic, .millimeterOfMercury()),
        (.respiratoryRate, HKUnit.count().unitDivided(by: .minute())),

        // Body measurements
        (.bodyMass, .gramUnit(with: .kilo)),
        (.height, .meter()),
        (.bodyMassIndex, .count()),
        (.bodyFatPercentage, .percent()),
        (.leanBodyMass, .gramUnit(with: .kilo)),
        (.waistCircumference, .meter()),

        // Nutrition
        (.dietaryEnergyConsumed, .kilocalorie()),
        (.dietaryCarbohydrates, .gram()),
        (.dietaryFatTotal, .gram()),
        (.dietaryProtein, .gram()),
        (.dietaryFiber, .gram()),
        (.dietarySugar, .gram()),
        (.dietaryWater, .liter()),
        (.dietaryCaffeine, .gram()),

        // Other
        (.bloodGlucose, HKUnit.moleUnit(with: .milli, molarMass: HKUnitMolarMassBloodGlucose).unitDivided(by: .liter())),
        (.electrodermalActivity, .siemen()),
        (.numberOfTimesFallen, .count()),
        (.uvExposure, .count()),

        // Fitness avanzato
        (.vo2Max, HKUnit(from: "ml/(kg*min)")),
        (.runningPower, .watt()),
        (.runningSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.runningStrideLength, .meter()),
        (.runningGroundContactTime, .secondUnit(with: .milli)),
        (.runningVerticalOscillation, .meterUnit(with: .centi)),
        (.cyclingPower, .watt()),
        (.cyclingCadence, HKUnit.count().unitDivided(by: .minute())),
        (.cyclingSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.cyclingFunctionalThresholdPower, .watt()),
        (.stairAscentSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.stairDescentSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.walkingSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.walkingStepLength, .meter()),
        (.walkingAsymmetryPercentage, .percent()),
        (.walkingDoubleSupportPercentage, .percent()),
        (.sixMinuteWalkTestDistance, .meter()),
    ]

    // Types the app is allowed to WRITE to Apple Health.
    // Keep in sync with backend's ALLOWED_WRITE_TYPES.
    static let writableQuantityTypes: [(HKQuantityTypeIdentifier, HKUnit)] = [
        (.bodyMass, .gramUnit(with: .kilo)),
        (.height, .meter()),
        (.bodyMassIndex, .count()),
        (.bodyFatPercentage, .percent()),
        (.leanBodyMass, .gramUnit(with: .kilo)),
        (.waistCircumference, .meter()),
        (.dietaryEnergyConsumed, .kilocalorie()),
        (.dietaryCarbohydrates, .gram()),
        (.dietaryFatTotal, .gram()),
        (.dietaryProtein, .gram()),
        (.dietaryFiber, .gram()),
        (.dietarySugar, .gram()),
        (.dietaryWater, .liter()),
        (.dietaryCaffeine, .gramUnit(with: .milli)),
    ]

    // Category types we want to read
    static let categoryTypes: [HKCategoryTypeIdentifier] = [
        .sleepAnalysis,
        .appleStandHour,
        .mindfulSession,
        .highHeartRateEvent,
        .lowHeartRateEvent,
        .irregularHeartRhythmEvent,
    ]

    private var allReadTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()

        for (identifier, _) in Self.quantityTypes {
            if let type = HKQuantityType.quantityType(forIdentifier: identifier) {
                types.insert(type)
            }
        }

        for identifier in Self.categoryTypes {
            if let type = HKCategoryType.categoryType(forIdentifier: identifier) {
                types.insert(type)
            }
        }

        types.insert(HKWorkoutType.workoutType())
        // GPS routes for outdoor workouts (HKWorkoutRoute series). Required to
        // read CLLocation points via HKWorkoutRouteQuery for the dashboard map.
        types.insert(HKSeriesType.workoutRoute())

        return types
    }

    private var writableTypesSet: Set<HKSampleType> {
        var set = Set<HKSampleType>()
        for (identifier, _) in Self.writableQuantityTypes {
            if let type = HKQuantityType.quantityType(forIdentifier: identifier) {
                set.insert(type)
            }
        }
        return set
    }

    /// Starts HKObserverQuery on all read types. iOS will call `onChange` whenever
    /// new samples are added to HealthKit, even when the app is backgrounded
    /// (requires background delivery). The callback should trigger a quick sync.
    func startObservingNewSamples(onChange: @escaping @Sendable () async -> Void) {
        let store = self.healthStore
        let log = Self.logger

        let runCallback = { (typeName: String, completion: @escaping HKObserverQueryCompletionHandler) in
            log.info("HKObserverQuery fired: \(typeName)")
            Task {
                await onChange()
                completion()
            }
        }

        let bgCompletion: (String) -> (Bool, Error?) -> Void = { name in
            return { success, error in
                if success {
                    log.info("BG delivery enabled: \(name)")
                } else {
                    log.error("BG delivery FAILED for \(name): \(error?.localizedDescription ?? "unknown")")
                }
            }
        }

        var registered = 0
        for (identifier, _) in Self.quantityTypes {
            guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            let name = identifier.rawValue
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, _ in
                runCallback(name, completion)
            }
            store.execute(query)
            registered += 1
            store.enableBackgroundDelivery(for: type, frequency: .hourly, withCompletion: bgCompletion(name))
        }

        for identifier in Self.categoryTypes {
            guard let type = HKCategoryType.categoryType(forIdentifier: identifier) else { continue }
            let name = identifier.rawValue
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, _ in
                runCallback(name, completion)
            }
            store.execute(query)
            registered += 1
            store.enableBackgroundDelivery(for: type, frequency: .hourly, withCompletion: bgCompletion(name))
        }

        let workoutQuery = HKObserverQuery(sampleType: .workoutType(), predicate: nil) { _, completion, _ in
            runCallback("HKWorkoutType", completion)
        }
        store.execute(workoutQuery)
        registered += 1
        store.enableBackgroundDelivery(for: .workoutType(), frequency: .hourly, withCompletion: bgCompletion("HKWorkoutType"))

        log.info("HKObserverQuery setup: \(registered) types registered (BG delivery requested)")
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }
        try await healthStore.requestAuthorization(
            toShare: writableTypesSet,
            read: allReadTypes
        )
    }

    /// Writes a quantity sample to Apple Health. Returns the HKSample UUID.
    func writeQuantitySample(
        typeIdentifierRaw: String,
        value: Double,
        unitString: String,
        startDate: Date,
        endDate: Date,
        sourceName: String?,
        notes: String?
    ) async throws -> UUID {
        let typeIdentifier = HKQuantityTypeIdentifier(rawValue: typeIdentifierRaw)
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: typeIdentifier) else {
            throw HealthKitError.unsupportedType
        }

        let unit = Self.unitFromString(unitString)
        let quantity = HKQuantity(unit: unit, doubleValue: value)

        var metadata: [String: Any] = [:]
        if let sourceName, !sourceName.isEmpty {
            metadata["external_source"] = sourceName
        }
        if let notes, !notes.isEmpty {
            metadata[HKMetadataKeyExternalUUID] = UUID().uuidString
            metadata["notes"] = notes
        }

        let sample = HKQuantitySample(
            type: sampleType,
            quantity: quantity,
            start: startDate,
            end: endDate,
            metadata: metadata.isEmpty ? nil : metadata
        )

        try await healthStore.save(sample)
        return sample.uuid
    }

    /// Deletes a HealthKit sample by its UUID. Returns true if found and deleted.
    func deleteSample(uuidString: String, typeIdentifierRaw: String) async throws -> Bool {
        guard let sampleUUID = UUID(uuidString: uuidString) else { return false }

        // Try quantity type first
        if let qType = HKQuantityType.quantityType(
            forIdentifier: HKQuantityTypeIdentifier(rawValue: typeIdentifierRaw)
        ) {
            return try await deleteHKObject(uuid: sampleUUID, sampleType: qType)
        }

        // Try category type
        if let cType = HKCategoryType.categoryType(
            forIdentifier: HKCategoryTypeIdentifier(rawValue: typeIdentifierRaw)
        ) {
            return try await deleteHKObject(uuid: sampleUUID, sampleType: cType)
        }

        return false
    }

    private func deleteHKObject(uuid: UUID, sampleType: HKSampleType) async throws -> Bool {
        // Find the sample by UUID
        let predicate = HKQuery.predicateForObject(with: uuid)
        let samples: [HKSample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: 1,
                sortDescriptors: nil
            ) { _, results, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: results ?? [])
            }
            healthStore.execute(query)
        }

        guard let sample = samples.first else { return false }
        try await healthStore.delete(sample)
        return true
    }

    /// Maps a unit string (e.g. "kg", "kcal", "%") to HKUnit.
    private static func unitFromString(_ s: String) -> HKUnit {
        switch s {
        case "kg": return .gramUnit(with: .kilo)
        case "g": return .gram()
        case "mg": return .gramUnit(with: .milli)
        case "lb": return .pound()
        case "m": return .meter()
        case "cm": return .meterUnit(with: .centi)
        case "L": return .liter()
        case "mL": return .literUnit(with: .milli)
        case "kcal": return .kilocalorie()
        case "%": return .percent()
        case "count", "": return .count()
        default:
            // Fallback: try to parse
            return HKUnit(from: s)
        }
    }

    func fetchQuantitySamples(
        type: HKQuantityTypeIdentifier,
        unit: HKUnit,
        since: Date?,
        until: Date? = nil
    ) async throws -> [SamplePayload] {
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: type) else {
            return []
        }

        let predicate: NSPredicate? = (since != nil || until != nil)
            ? HKQuery.predicateForSamples(withStart: since, end: until, options: .strictStartDate)
            : nil

        let samples: [HKQuantitySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKQuantitySample]) ?? [])
            }
            healthStore.execute(query)
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return samples.map { sample in
            SamplePayload(
                uuid: sample.uuid.uuidString,
                type: type.rawValue,
                value: sample.quantity.doubleValue(for: unit),
                unit: unit.unitString,
                startDate: formatter.string(from: sample.startDate),
                endDate: formatter.string(from: sample.endDate),
                sourceName: sample.sourceRevision.source.name,
                sourceBundleId: sample.sourceRevision.source.bundleIdentifier,
                device: sample.device?.model,
                metadata: sample.metadata?.compactMapValues { "\($0)" }
            )
        }
    }

    func fetchCategorySamples(
        type: HKCategoryTypeIdentifier,
        since: Date?,
        until: Date? = nil
    ) async throws -> [CategoryPayload] {
        guard let sampleType = HKCategoryType.categoryType(forIdentifier: type) else {
            return []
        }

        let predicate: NSPredicate? = (since != nil || until != nil)
            ? HKQuery.predicateForSamples(withStart: since, end: until, options: .strictStartDate)
            : nil

        let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKCategorySample]) ?? [])
            }
            healthStore.execute(query)
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return samples.map { sample in
            CategoryPayload(
                uuid: sample.uuid.uuidString,
                type: type.rawValue,
                value: sample.value,
                startDate: formatter.string(from: sample.startDate),
                endDate: formatter.string(from: sample.endDate),
                sourceName: sample.sourceRevision.source.name,
                sourceBundleId: sample.sourceRevision.source.bundleIdentifier,
                metadata: sample.metadata?.compactMapValues { "\($0)" }
            )
        }
    }

    /// Fetches workouts using an anchored query so we also receive deletions.
    /// Returns the workouts to upsert, the UUIDs of workouts deleted since the
    /// last anchor, and the new anchor (to persist).
    func fetchWorkoutsAnchored(anchor: HKQueryAnchor?) async throws -> (added: [WorkoutPayload], deletedUUIDs: [UUID], newAnchor: HKQueryAnchor?) {
        let result: ([HKWorkout], [HKDeletedObject], HKQueryAnchor?) = try await withCheckedThrowingContinuation { cont in
            let query = HKAnchoredObjectQuery(
                type: .workoutType(),
                predicate: nil,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deleted, newAnchor, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: ((samples as? [HKWorkout]) ?? [], deleted ?? [], newAnchor))
            }
            healthStore.execute(query)
        }

        let (added, deleted, newAnchor) = result
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let payloads = added.map { workout -> WorkoutPayload in
            let activities = Self.extractWorkoutActivities(workout, formatter: formatter)
            return WorkoutPayload(
                uuid: workout.uuid.uuidString,
                activityType: Int(workout.workoutActivityType.rawValue),
                activityName: workout.workoutActivityType.displayName,
                duration: workout.duration,
                totalEnergyBurned: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
                totalDistance: workout.totalDistance?.doubleValue(for: .meter()),
                startDate: formatter.string(from: workout.startDate),
                endDate: formatter.string(from: workout.endDate),
                sourceName: workout.sourceRevision.source.name,
                metadata: workout.metadata?.compactMapValues { "\($0)" },
                title: workout.metadata?["workout name"] as? String,
                activities: activities
            )
        }

        let deletedUUIDs = deleted.map { $0.uuid }
        return (payloads, deletedUUIDs, newAnchor)
    }

    // MARK: - Workout GPS route

    /// Returns the GPS fixes recorded by Apple Watch / iPhone during a workout
    /// (HKWorkoutRoute series). Empty array means "no route exists for this
    /// workout" — typical for indoor workouts, manually entered ones, and
    /// most third-party imports. Multiple route series associated to the
    /// same workout are concatenated by timestamp.
    func fetchWorkoutRoute(for workout: HKWorkout) async throws -> [RoutePointPayload] {
        let routeType = HKSeriesType.workoutRoute()
        let predicate = HKQuery.predicateForObjects(from: workout)

        let routes: [HKWorkoutRoute] = try await withCheckedThrowingContinuation { cont in
            let q = HKSampleQuery(
                sampleType: routeType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
            }
            healthStore.execute(q)
        }
        if routes.isEmpty { return [] }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        var allPoints: [RoutePointPayload] = []
        for route in routes {
            let locs = try await fetchLocations(for: route)
            allPoints.append(contentsOf: locs.map { Self.toPayload($0, formatter: formatter) })
        }
        // Multiple route series may overlap in time on watchOS; sort by ts.
        allPoints.sort { $0.ts < $1.ts }
        return allPoints
    }

    /// Variant looked up by HKWorkout.uuid. Returns nil if the workout is no
    /// longer in HealthKit (e.g., user deleted it from the Health app).
    func fetchWorkoutRoute(workoutUUID: UUID) async throws -> [RoutePointPayload]? {
        let pred = HKQuery.predicateForObject(with: workoutUUID)
        let workout: HKWorkout? = try await withCheckedThrowingContinuation { cont in
            let q = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: pred,
                limit: 1,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: (samples as? [HKWorkout])?.first)
            }
            healthStore.execute(q)
        }
        guard let workout else { return nil }
        return try await fetchWorkoutRoute(for: workout)
    }

    /// Drains an `HKWorkoutRouteQuery` (which delivers CLLocation in batches)
    /// until `done == true`, accumulating all points.
    private func fetchLocations(for route: HKWorkoutRoute) async throws -> [CLLocation] {
        try await withCheckedThrowingContinuation { cont in
            var collected: [CLLocation] = []
            let q = HKWorkoutRouteQuery(route: route) { _, locsOrNil, done, error in
                if let error { cont.resume(throwing: error); return }
                if let locs = locsOrNil { collected.append(contentsOf: locs) }
                if done { cont.resume(returning: collected) }
            }
            healthStore.execute(q)
        }
    }

    private static func toPayload(_ loc: CLLocation, formatter: ISO8601DateFormatter) -> RoutePointPayload {
        // Negative accuracy values from Core Location mean "invalid" and
        // should be dropped per Apple's docs.
        let alt: Double? = loc.verticalAccuracy >= 0 ? loc.altitude : nil
        let hAcc: Double? = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
        let vAcc: Double? = loc.verticalAccuracy >= 0 ? loc.verticalAccuracy : nil
        let speed: Double? = loc.speed >= 0 ? loc.speed : nil
        let course: Double? = loc.course >= 0 ? loc.course : nil
        return RoutePointPayload(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            ts: formatter.string(from: loc.timestamp),
            alt: alt,
            hAcc: hAcc,
            vAcc: vAcc,
            speed: speed,
            course: course
        )
    }

    // MARK: - Workout intervals extraction

    /// Builds the normalized `activities` payload for a workout, preferring
    /// `HKWorkoutActivity` (iOS 17+, rich per-interval statistics) and falling
    /// back to `HKWorkoutEvent` lap/segment markers when activities are absent.
    /// Returns `nil` if neither is present so the backend keeps any existing
    /// value intact (upsert-friendly).
    private static func extractWorkoutActivities(
        _ workout: HKWorkout,
        formatter: ISO8601DateFormatter
    ) -> [WorkoutActivityPayload]? {
        let fromActivities = encodeWorkoutActivities(workout, formatter: formatter)
        if !fromActivities.isEmpty { return fromActivities }
        let fromEvents = encodeWorkoutEventsAsLaps(workout, formatter: formatter)
        return fromEvents.isEmpty ? nil : fromEvents
    }

    private static let restNames: Set<String> = ["rest", "recovery", "recupero", "pausa", "riposo"]

    private static func encodeWorkoutActivities(
        _ workout: HKWorkout,
        formatter: ISO8601DateFormatter
    ) -> [WorkoutActivityPayload] {
        let activities = workout.workoutActivities
        if activities.isEmpty { return [] }

        var workCounter = 0
        var restCounter = 0
        var otherCounter = 0

        return activities.map { act -> WorkoutActivityPayload in
            let start = act.startDate
            let end = act.endDate ?? start.addingTimeInterval(act.duration)
            let durationS = act.duration > 0 ? act.duration : end.timeIntervalSince(start)

            let subType = act.workoutConfiguration.activityType

            // Distance — pick the unit matching the activity type.
            let distanceType: HKQuantityType = {
                switch subType {
                case .cycling, .handCycling: return HKQuantityType(.distanceCycling)
                case .swimming:              return HKQuantityType(.distanceSwimming)
                case .wheelchairRunPace, .wheelchairWalkPace:
                    return HKQuantityType(.distanceWheelchair)
                default:                     return HKQuantityType(.distanceWalkingRunning)
                }
            }()
            let distanceM = act.statistics(for: distanceType)?.sumQuantity()?.doubleValue(for: .meter())

            let hrType = HKQuantityType(.heartRate)
            let bpm = HKUnit.count().unitDivided(by: .minute())
            let avgHr = act.statistics(for: hrType)?.averageQuantity()?.doubleValue(for: bpm)
            let maxHr = act.statistics(for: hrType)?.maximumQuantity()?.doubleValue(for: bpm)

            let kcal = act.statistics(for: HKQuantityType(.activeEnergyBurned))?
                .sumQuantity()?
                .doubleValue(for: .kilocalorie())

            // Prefer the per-interval label the source app provides. Intervals Pro
            // writes "Interval Name" (e.g. "Camminata ", "Corsa ") and the app's
            // color in "Interval Color"/"Interval Color Name". These keys are the
            // only authoritative way to distinguish walk vs run inside Intervals
            // Pro's "Corsa Livello N" programs — the workoutConfiguration.activityType
            // stays Running for every interval.
            let explicitNameRaw = (act.metadata?["Interval Name"] as? String)
                ?? (act.metadata?["workout name"] as? String)
                ?? (act.metadata?["HKWorkoutName"] as? String)
                ?? (act.metadata?["name"] as? String)
            let explicitName = explicitNameRaw?.trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty

            // Kind detection — only from data the source app explicitly provides.
            // No heuristics based on sub-activity type: if Intervals Pro (or any
            // other app) wants an interval to show as "rest", it has to say so
            // in metadata or in the interval name.
            let lowerName = explicitName?.lowercased() ?? ""
            let metaKind = (act.metadata?["Intervals Pro Activity Type"] as? String)?.lowercased()
                ?? (act.metadata?["kind"] as? String)?.lowercased()
            let isRestByMeta = metaKind == "rest" || metaKind == "recovery"
            let isRestByName = restNames.contains(lowerName)
            let isRest = isRestByMeta || isRestByName
            let kind = isRest ? "rest" : "work"

            let n: Int
            if isRest { restCounter += 1; n = restCounter }
            else if kind == "work" { workCounter += 1; n = workCounter }
            else { otherCounter += 1; n = otherCounter }

            let pace: Double? = {
                guard let d = distanceM, d > 0, durationS > 0 else { return nil }
                return durationS / (d / 1000.0)
            }()

            // Display name for the sub-activity type (e.g., "Running", "Walking").
            // Prefer the explicit metadata name over the generic activity type name.
            let activityDisplayName = subType.displayName
            let name = explicitName ?? activityDisplayName

            return WorkoutActivityPayload(
                n: n,
                kind: kind,
                name: name,
                activityType: Int(subType.rawValue),
                activityName: activityDisplayName,
                start: formatter.string(from: start),
                end: formatter.string(from: end),
                durationS: durationS,
                distanceM: distanceM,
                avgHr: avgHr,
                maxHr: maxHr,
                kcal: kcal,
                paceSPerKm: pace,
                metadata: act.metadata?.compactMapValues { "\($0)" }
            )
        }
    }

    private static func encodeWorkoutEventsAsLaps(
        _ workout: HKWorkout,
        formatter: ISO8601DateFormatter
    ) -> [WorkoutActivityPayload] {
        let events = (workout.workoutEvents ?? []).filter {
            $0.type == .lap || $0.type == .segment
        }
        if events.isEmpty { return [] }

        var result: [WorkoutActivityPayload] = []
        var prevStart = workout.startDate
        var lapCounter = 0
        var segmentCounter = 0

        // Each event's dateInterval.start marks the end of the previous lap
        // (and the start of the next). Close the last entry at workout.endDate.
        let closingBoundary = workout.endDate
        for event in events {
            let endOfInterval = event.dateInterval.start
            let durationS = endOfInterval.timeIntervalSince(prevStart)
            guard durationS > 0 else { prevStart = endOfInterval; continue }

            let kind = (event.type == .segment) ? "segment" : "lap"
            let n: Int
            if kind == "segment" { segmentCounter += 1; n = segmentCounter }
            else { lapCounter += 1; n = lapCounter }

            let name = event.metadata?[HKMetadataKeyWorkoutBrandName] as? String

            result.append(WorkoutActivityPayload(
                n: n,
                kind: kind,
                name: name,
                activityType: nil,
                activityName: nil,
                start: formatter.string(from: prevStart),
                end: formatter.string(from: endOfInterval),
                durationS: durationS,
                distanceM: nil,
                avgHr: nil,
                maxHr: nil,
                kcal: nil,
                paceSPerKm: nil,
                metadata: event.metadata?.compactMapValues { "\($0)" }
            ))
            prevStart = endOfInterval
        }

        // Trailing segment from last event → workout end
        if prevStart < closingBoundary {
            let durationS = closingBoundary.timeIntervalSince(prevStart)
            lapCounter += 1
            result.append(WorkoutActivityPayload(
                n: lapCounter,
                kind: "lap",
                name: nil,
                activityType: nil,
                activityName: nil,
                start: formatter.string(from: prevStart),
                end: formatter.string(from: closingBoundary),
                durationS: durationS,
                distanceM: nil,
                avgHr: nil,
                maxHr: nil,
                kcal: nil,
                paceSPerKm: nil,
                metadata: nil
            ))
        }

        return result
    }

    /// Fetches quantity samples of the given type via an anchored query.
    /// Returns new samples, UUIDs deleted since last anchor, and the new anchor.
    /// Used for slow-changing body metrics (weight, BMI, body fat, lean mass,
    /// height, waist) where sources like Withings can write samples retroactively
    /// into HealthKit — a plain windowed HKSampleQuery would miss those.
    func fetchQuantitySamplesAnchored(
        type: HKQuantityTypeIdentifier,
        unit: HKUnit,
        anchor: HKQueryAnchor?
    ) async throws -> (added: [SamplePayload], deletedUUIDs: [UUID], newAnchor: HKQueryAnchor?) {
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: type) else {
            return ([], [], anchor)
        }

        let result: ([HKQuantitySample], [HKDeletedObject], HKQueryAnchor?) = try await withCheckedThrowingContinuation { cont in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: nil,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deleted, newAnchor, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: ((samples as? [HKQuantitySample]) ?? [], deleted ?? [], newAnchor))
            }
            healthStore.execute(query)
        }

        let (added, deleted, newAnchor) = result
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let payloads = added.map { sample in
            SamplePayload(
                uuid: sample.uuid.uuidString,
                type: type.rawValue,
                value: sample.quantity.doubleValue(for: unit),
                unit: unit.unitString,
                startDate: formatter.string(from: sample.startDate),
                endDate: formatter.string(from: sample.endDate),
                sourceName: sample.sourceRevision.source.name,
                sourceBundleId: sample.sourceRevision.source.bundleIdentifier,
                device: sample.device?.model,
                metadata: sample.metadata?.compactMapValues { "\($0)" }
            )
        }

        let deletedUUIDs = deleted.map { $0.uuid }
        return (payloads, deletedUUIDs, newAnchor)
    }

    /// Esegue una `HKStatisticsCollectionQuery` con bucket giornalieri (anchor =
    /// inizio del giorno locale di `from`) e ritorna i totali pre-calcolati per
    /// ciascun giorno. E' la stessa API che alimenta i widget di Apple Salute:
    /// HealthKit applica internamente il dedup proprietario tra Watch e iPhone,
    /// quindi i numeri tornati combaciano con quelli mostrati in Salute.
    /// Usa `.cumulativeSum` (i 9 tipi attivita' sono tutti cumulative).
    func fetchDailyStatistics(
        type: HKQuantityTypeIdentifier,
        unit: HKUnit,
        from: Date,
        to: Date
    ) async throws -> [DailyStatPoint] {
        guard let qt = HKQuantityType.quantityType(forIdentifier: type) else { return [] }
        let calendar = Calendar.current
        let anchor = calendar.startOfDay(for: from)
        let interval = DateComponents(day: 1)

        // NOTE: nessun predicate temporale. `HKStatisticsCollectionQuery` con
        // `intervalComponents = 1 day` + `anchor = startOfDay(from)` gestisce
        // gia' il bucketing. Aggiungere `.strictStartDate` taglia sample che
        // attraversano la mezzanotte e produce numeri diversi da Apple Salute.
        // L'enumeration `from...to` sotto limita i risultati alla finestra.
        let stats: [HKStatistics] = try await withCheckedThrowingContinuation { cont in
            let q = HKStatisticsCollectionQuery(
                quantityType: qt,
                quantitySamplePredicate: nil,
                options: [.cumulativeSum],
                anchorDate: anchor,
                intervalComponents: interval
            )
            q.initialResultsHandler = { _, results, error in
                if let error { cont.resume(throwing: error); return }
                var out: [HKStatistics] = []
                results?.enumerateStatistics(from: from, to: to) { s, _ in out.append(s) }
                cont.resume(returning: out)
            }
            healthStore.execute(q)
        }

        return stats.compactMap { s in
            guard let q = s.sumQuantity() else { return nil }
            return DailyStatPoint(date: s.startDate, value: q.doubleValue(for: unit))
        }
    }

    func fetchWorkouts(since: Date?, until: Date? = nil) async throws -> [WorkoutPayload] {
        let predicate: NSPredicate? = (since != nil || until != nil)
            ? HKQuery.predicateForSamples(withStart: since, end: until, options: .strictStartDate)
            : nil

        let samples: [HKWorkout] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKWorkout]) ?? [])
            }
            healthStore.execute(query)
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return samples.map { workout in
            WorkoutPayload(
                uuid: workout.uuid.uuidString,
                activityType: Int(workout.workoutActivityType.rawValue),
                activityName: workout.workoutActivityType.displayName,
                duration: workout.duration,
                totalEnergyBurned: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
                totalDistance: workout.totalDistance?.doubleValue(for: .meter()),
                startDate: formatter.string(from: workout.startDate),
                endDate: formatter.string(from: workout.endDate),
                sourceName: workout.sourceRevision.source.name,
                metadata: workout.metadata?.compactMapValues { "\($0)" },
                title: workout.metadata?["workout name"] as? String,
                activities: Self.extractWorkoutActivities(workout, formatter: formatter)
            )
        }
    }
}

enum HealthKitError: LocalizedError {
    case notAvailable
    case unsupportedType

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "HealthKit is not available on this device"
        case .unsupportedType:
            return "Unsupported HealthKit type"
        }
    }
}

extension HKWorkoutActivityType {
    var displayName: String {
        switch self {
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .walking: return "Walking"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .yoga: return "Yoga"
        case .functionalStrengthTraining: return "Strength Training"
        case .traditionalStrengthTraining: return "Strength Training"
        case .crossTraining: return "Cross Training"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .highIntensityIntervalTraining: return "HIIT"
        case .coreTraining: return "Core Training"
        case .pilates: return "Pilates"
        case .dance: return "Dance"
        case .cooldown: return "Cooldown"
        case .soccer: return "Soccer"
        case .tennis: return "Tennis"
        case .basketball: return "Basketball"
        default: return "Workout (\(self.rawValue))"
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
