import Foundation
import HealthKit
import SwiftData
import os

/// Persisted summary of the last completed sync
struct LastSyncSummary: Codable {
    var startedAt: Date
    var completedAt: Date
    var durationSeconds: Double
    var totalSamples: Int
    var log: [String]
    var wasInterrupted: Bool
}

@Observable
final class SyncService {
    var isSyncing = false
    var lastSyncDate: Date?
    var lastSyncStartedAt: Date?
    var lastSyncDurationSeconds: Double?
    var lastSyncTotalSamples: Int = 0
    var lastSyncLog: [String] = []        // preserved summary of the last completed sync
    var lastSyncWasInterrupted: Bool = false
    var currentType: String = ""
    var progress: Double = 0
    var typeProgress: Double = 0          // progress within current type (0..1)
    var currentWindowDate: Date?          // latest date reached in current type
    var totalSamplesSynced: Int = 0       // live counter this sync
    var lastError: String?
    var syncLog: [String] = []
    var shouldStop: Bool = false          // set to true to cancel mid-sync

    private let healthKitManager = HealthKitManager()
    private let apiClient = APIClient()
    private var modelContainer: ModelContainer?

    private let logger = Logger(subsystem: "com.healthtracker", category: "sync")

    // 90-day chunks keep peak memory reasonable
    private let fetchWindowDays = 90

    // Types to sync LAST (after everything else has finished).
    private let deferredTypes: Set<String> = []

    private let lastSyncKey = "last_sync_summary_v1"

    init() {
        loadLastSyncSummary()
    }

    func setModelContainer(_ container: ModelContainer) {
        self.modelContainer = container
    }

    private func loadLastSyncSummary() {
        guard let data = UserDefaults.standard.data(forKey: lastSyncKey) else { return }
        guard let summary = try? JSONDecoder().decode(LastSyncSummary.self, from: data) else { return }
        lastSyncStartedAt = summary.startedAt
        lastSyncDate = summary.completedAt
        lastSyncDurationSeconds = summary.durationSeconds
        lastSyncTotalSamples = summary.totalSamples
        lastSyncLog = summary.log
        lastSyncWasInterrupted = summary.wasInterrupted
    }

    private func saveLastSyncSummary(startedAt: Date, interrupted: Bool) {
        let summary = LastSyncSummary(
            startedAt: startedAt,
            completedAt: Date(),
            durationSeconds: Date().timeIntervalSince(startedAt),
            totalSamples: totalSamplesSynced,
            log: syncLog,
            wasInterrupted: interrupted
        )
        if let data = try? JSONEncoder().encode(summary) {
            UserDefaults.standard.set(data, forKey: lastSyncKey)
        }
    }

    func requestStop() {
        shouldStop = true
    }

    /// Quick sync: calls performFullSync but only if not already syncing and
    /// enough time has passed since the last sync. Intended for automatic
    /// triggers (HKObserverQuery, app launch, scene change).
    @MainActor
    func performQuickSync(minInterval: TimeInterval = 120) async {
        if isSyncing { return }
        if let last = lastSyncDate, Date().timeIntervalSince(last) < minInterval {
            return
        }
        await performFullSync()
    }

    /// Resets the sync date for body-related types so they get re-fetched from scratch.
    @MainActor
    func resetBodySync() async {
        let typeIds = [
            HKQuantityTypeIdentifier.bodyMass.rawValue,
            HKQuantityTypeIdentifier.bodyMassIndex.rawValue,
            HKQuantityTypeIdentifier.bodyFatPercentage.rawValue,
            HKQuantityTypeIdentifier.leanBodyMass.rawValue,
            HKQuantityTypeIdentifier.height.rawValue,
            HKQuantityTypeIdentifier.waistCircumference.rawValue,
        ]
        guard let container = modelContainer else { return }
        let context = ModelContext(container)
        for tid in typeIds {
            let predicate = #Predicate<SyncState> { $0.typeIdentifier == tid }
            let descriptor = FetchDescriptor(predicate: predicate)
            if let existing = try? context.fetch(descriptor).first {
                context.delete(existing)
            }
        }
        try? context.save()
    }

    @MainActor
    func performFullSync() async {
        guard !isSyncing else { return }
        let startedAt = Date()
        isSyncing = true
        shouldStop = false
        lastError = nil
        syncLog = []
        progress = 0
        typeProgress = 0
        totalSamplesSynced = 0
        currentWindowDate = nil
        lastSyncStartedAt = startedAt

        // Process pending writes and deletions FIRST (quick)
        await processPendingWrites()
        await processPendingDeletions()

        let totalTypes = HealthKitManager.quantityTypes.count
            + HealthKitManager.categoryTypes.count
            + 1 // workouts
        var completedTypes = 0

        // Split in two passes: non-deferred first, then deferred (heavy) at the end
        let quantityNormal = HealthKitManager.quantityTypes.filter { !deferredTypes.contains($0.0.rawValue) }
        let quantityDeferred = HealthKitManager.quantityTypes.filter { deferredTypes.contains($0.0.rawValue) }
        let categoryNormal = HealthKitManager.categoryTypes.filter { !deferredTypes.contains($0.rawValue) }
        let categoryDeferred = HealthKitManager.categoryTypes.filter { deferredTypes.contains($0.rawValue) }

        // PASS 1: light/normal types
        for (typeId, unit) in quantityNormal {
            if shouldStop { break }
            currentType = typeId.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
            typeProgress = 0
            currentWindowDate = nil
            await syncQuantityType(typeId: typeId, unit: unit)
            completedTypes += 1
            progress = Double(completedTypes) / Double(totalTypes)
        }

        for typeId in categoryNormal {
            if shouldStop { break }
            currentType = typeId.rawValue.replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
            typeProgress = 0
            currentWindowDate = nil
            await syncCategoryType(typeId: typeId)
            completedTypes += 1
            progress = Double(completedTypes) / Double(totalTypes)
        }

        // Workouts (always in first pass, they're usually small)
        if !shouldStop {
            currentType = "Workouts"
            typeProgress = 0
            currentWindowDate = nil
            await syncWorkouts()
            completedTypes += 1
            progress = Double(completedTypes) / Double(totalTypes)
        }

        // PASS 2: deferred heavy types (HeartRate, HRV)
        for (typeId, unit) in quantityDeferred {
            if shouldStop { break }
            currentType = typeId.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "") + " (deferred)"
            typeProgress = 0
            currentWindowDate = nil
            await syncQuantityType(typeId: typeId, unit: unit)
            completedTypes += 1
            progress = Double(completedTypes) / Double(totalTypes)
        }

        for typeId in categoryDeferred {
            if shouldStop { break }
            currentType = typeId.rawValue.replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "") + " (deferred)"
            typeProgress = 0
            currentWindowDate = nil
            await syncCategoryType(typeId: typeId)
            completedTypes += 1
            progress = Double(completedTypes) / Double(totalTypes)
        }

        progress = 1.0

        if shouldStop {
            syncLog.append("Sync interrotta dall'utente")
        } else {
            lastSyncDate = Date()
            if syncLog.isEmpty {
                syncLog.append("Nessun nuovo dato da sincronizzare")
            }
        }

        // Preserve summary of this sync for the UI + persist across launches
        let wasInterrupted = shouldStop
        lastSyncDurationSeconds = Date().timeIntervalSince(startedAt)
        lastSyncTotalSamples = totalSamplesSynced
        lastSyncLog = syncLog
        lastSyncWasInterrupted = wasInterrupted
        saveLastSyncSummary(startedAt: startedAt, interrupted: wasInterrupted)

        currentType = ""
        currentWindowDate = nil
        typeProgress = 0
        isSyncing = false
        shouldStop = false
    }

    /// Polls the backend for pending writes and writes them to Apple Health.
    @MainActor
    private func processPendingWrites() async {
        currentType = "Pending writes"
        typeProgress = 0

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoFallback = ISO8601DateFormatter()
        isoFallback.formatOptions = [.withInternetDateTime]

        func parseDate(_ s: String) -> Date? {
            iso.date(from: s) ?? isoFallback.date(from: s)
        }

        let pending: [APIClient.PendingWrite]
        do {
            pending = try await apiClient.fetchPendingWrites()
        } catch {
            syncLog.append("Pending writes: fetch failed - \(error.localizedDescription)")
            return
        }

        if pending.isEmpty { return }

        var ok = 0
        var failed = 0
        let total = Double(pending.count)

        for (idx, write) in pending.enumerated() {
            if shouldStop { return }
            typeProgress = Double(idx) / total
            guard let start = parseDate(write.startDate),
                  let end = parseDate(write.endDate) else {
                try? await apiClient.failWrite(id: write.id, error: "invalid date format")
                failed += 1
                continue
            }

            do {
                let uuid = try await healthKitManager.writeQuantitySample(
                    typeIdentifierRaw: write.type,
                    value: write.value,
                    unitString: write.unit,
                    startDate: start,
                    endDate: end,
                    sourceName: write.sourceName,
                    notes: write.notes
                )
                try await apiClient.confirmWrite(id: write.id, hkUuid: uuid)
                ok += 1
            } catch {
                try? await apiClient.failWrite(id: write.id, error: error.localizedDescription)
                failed += 1
            }
        }

        typeProgress = 1.0
        syncLog.append("Pending writes: \(ok) ok, \(failed) failed")
        logger.info("Pending writes processed: \(ok) ok, \(failed) failed")
    }

    @MainActor
    private func syncQuantityType(typeId: HKQuantityTypeIdentifier, unit: HKUnit) async {
        let startDate = (await getSyncDate(for: typeId.rawValue)) ?? Date.distantPast
        let endDate = Date()
        var totalInserted = 0

        let effectiveStart = startDate == Date.distantPast ? endDate.addingTimeInterval(-86400 * 365 * 20) : startDate
        let totalDuration = endDate.timeIntervalSince(effectiveStart)

        var windowStart = startDate
        while windowStart < endDate {
            if shouldStop { return }
            let windowEnd = min(Calendar.current.date(byAdding: .day, value: fetchWindowDays, to: windowStart) ?? endDate, endDate)

            do {
                let samples = try await healthKitManager.fetchQuantitySamples(
                    type: typeId, unit: unit,
                    since: windowStart == Date.distantPast ? nil : windowStart,
                    until: windowEnd
                )

                if !samples.isEmpty {
                    let chunks = samples.chunked(into: Constants.syncBatchSize)
                    do {
                        let inserted = try await postChunksInParallel(chunks) { chunk in
                            try await self.apiClient.postSamples(chunk)
                        }
                        totalInserted += inserted
                        totalSamplesSynced += inserted
                    } catch {
                        let msg = "\(currentType): chunk failed - \(error.localizedDescription)"
                        syncLog.append(msg)
                        logger.error("\(msg)")
                        return
                    }
                }

                await updateSyncDate(for: typeId.rawValue, date: windowEnd)
                currentWindowDate = windowEnd
                if totalDuration > 0 {
                    typeProgress = min(1.0, windowEnd.timeIntervalSince(effectiveStart) / totalDuration)
                }
            } catch {
                let msg = "\(currentType): window failed - \(error.localizedDescription)"
                syncLog.append(msg)
                logger.error("\(msg)")
                return
            }

            windowStart = windowEnd
        }

        if totalInserted > 0 {
            let msg = "\(currentType): \(totalInserted) synced"
            syncLog.append(msg)
            logger.info("\(msg)")
        }
    }

    @MainActor
    private func syncCategoryType(typeId: HKCategoryTypeIdentifier) async {
        let startDate = (await getSyncDate(for: typeId.rawValue)) ?? Date.distantPast
        let endDate = Date()
        var totalInserted = 0

        let effectiveStart = startDate == Date.distantPast ? endDate.addingTimeInterval(-86400 * 365 * 20) : startDate
        let totalDuration = endDate.timeIntervalSince(effectiveStart)

        var windowStart = startDate
        while windowStart < endDate {
            if shouldStop { return }
            let windowEnd = min(Calendar.current.date(byAdding: .day, value: fetchWindowDays, to: windowStart) ?? endDate, endDate)

            do {
                let samples = try await healthKitManager.fetchCategorySamples(
                    type: typeId,
                    since: windowStart == Date.distantPast ? nil : windowStart,
                    until: windowEnd
                )

                if !samples.isEmpty {
                    let chunks = samples.chunked(into: Constants.syncBatchSize)
                    do {
                        let inserted = try await postChunksInParallel(chunks) { chunk in
                            try await self.apiClient.postCategories(chunk)
                        }
                        totalInserted += inserted
                        totalSamplesSynced += inserted
                    } catch {
                        let msg = "\(currentType): chunk failed - \(error.localizedDescription)"
                        syncLog.append(msg)
                        logger.error("\(msg)")
                        return
                    }
                }
                await updateSyncDate(for: typeId.rawValue, date: windowEnd)
                currentWindowDate = windowEnd
                if totalDuration > 0 {
                    typeProgress = min(1.0, windowEnd.timeIntervalSince(effectiveStart) / totalDuration)
                }
            } catch {
                let msg = "\(currentType): window failed - \(error.localizedDescription)"
                syncLog.append(msg)
                logger.error("\(msg)")
                return
            }

            windowStart = windowEnd
        }

        if totalInserted > 0 {
            let msg = "\(currentType): \(totalInserted) synced"
            syncLog.append(msg)
            logger.info("\(msg)")
        }
    }

    @MainActor
    private func syncWorkouts() async {
        let startDate = (await getSyncDate(for: "HKWorkoutType")) ?? Date.distantPast
        let endDate = Date()
        var totalInserted = 0

        let effectiveStart = startDate == Date.distantPast ? endDate.addingTimeInterval(-86400 * 365 * 20) : startDate
        let totalDuration = endDate.timeIntervalSince(effectiveStart)

        var windowStart = startDate
        while windowStart < endDate {
            if shouldStop { return }
            let windowEnd = min(Calendar.current.date(byAdding: .day, value: fetchWindowDays, to: windowStart) ?? endDate, endDate)

            do {
                let workouts = try await healthKitManager.fetchWorkouts(
                    since: windowStart == Date.distantPast ? nil : windowStart,
                    until: windowEnd
                )

                if !workouts.isEmpty {
                    let chunks = workouts.chunked(into: Constants.syncBatchSize)
                    do {
                        let inserted = try await postChunksInParallel(chunks) { chunk in
                            try await self.apiClient.postWorkouts(chunk)
                        }
                        totalInserted += inserted
                        totalSamplesSynced += inserted
                    } catch {
                        let msg = "Workouts: chunk failed - \(error.localizedDescription)"
                        syncLog.append(msg)
                        logger.error("\(msg)")
                        return
                    }
                }
                await updateSyncDate(for: "HKWorkoutType", date: windowEnd)
                currentWindowDate = windowEnd
                if totalDuration > 0 {
                    typeProgress = min(1.0, windowEnd.timeIntervalSince(effectiveStart) / totalDuration)
                }
            } catch {
                let msg = "Workouts: window failed - \(error.localizedDescription)"
                syncLog.append(msg)
                logger.error("\(msg)")
                return
            }

            windowStart = windowEnd
        }

        if totalInserted > 0 {
            let msg = "Workouts: \(totalInserted) synced"
            syncLog.append(msg)
            logger.info("\(msg)")
        }
    }

    /// Post chunks in parallel with limited concurrency. Throws at first error.
    /// Respects shouldStop: if set, stops sending more chunks.
    private func postChunksInParallel<T, R>(
        _ chunks: [[T]],
        poster: @escaping (_ chunk: [T]) async throws -> R
    ) async throws -> Int where R == BatchResult {
        var inserted = 0
        let concurrency = Constants.syncConcurrency

        var index = 0
        while index < chunks.count {
            if await MainActor.run(body: { shouldStop }) { return inserted }

            let windowEnd = min(index + concurrency, chunks.count)
            let window = Array(chunks[index..<windowEnd])

            try await withThrowingTaskGroup(of: BatchResult.self) { group in
                for chunk in window {
                    group.addTask {
                        try await poster(chunk)
                    }
                }
                for try await result in group {
                    inserted += result.inserted
                }
            }

            index = windowEnd
        }

        return inserted
    }

    /// Polls the backend for pending deletions and deletes them from Apple Health.
    @MainActor
    private func processPendingDeletions() async {
        currentType = "Pending deletions"
        typeProgress = 0

        let pending: [APIClient.PendingDeletion]
        do {
            pending = try await apiClient.fetchPendingDeletions()
        } catch {
            syncLog.append("Deletions: fetch failed - \(error.localizedDescription)")
            return
        }

        if pending.isEmpty { return }

        var ok = 0
        var failed = 0
        let total = Double(pending.count)

        for (idx, item) in pending.enumerated() {
            if shouldStop { return }
            typeProgress = Double(idx) / total

            do {
                let deleted = try await healthKitManager.deleteSample(
                    uuidString: item.hkUuid,
                    typeIdentifierRaw: item.type
                )
                if deleted {
                    try await apiClient.confirmDeletion(id: item.id)
                    ok += 1
                } else {
                    // Sample not found in HealthKit (maybe already deleted)
                    try await apiClient.confirmDeletion(id: item.id)
                    ok += 1
                }
            } catch {
                try? await apiClient.failDeletion(id: item.id, error: error.localizedDescription)
                failed += 1
            }
        }

        typeProgress = 1.0
        syncLog.append("Deletions: \(ok) ok, \(failed) failed")
        logger.info("Deletions processed: \(ok) ok, \(failed) failed")
    }

    private func getSyncDate(for typeIdentifier: String) async -> Date? {
        guard let container = modelContainer else { return nil }
        let context = ModelContext(container)
        let predicate = #Predicate<SyncState> { $0.typeIdentifier == typeIdentifier }
        let descriptor = FetchDescriptor(predicate: predicate)
        return try? context.fetch(descriptor).first?.lastSyncDate
    }

    private func updateSyncDate(for typeIdentifier: String, date: Date) async {
        guard let container = modelContainer else { return }
        let context = ModelContext(container)
        let predicate = #Predicate<SyncState> { $0.typeIdentifier == typeIdentifier }
        let descriptor = FetchDescriptor(predicate: predicate)

        if let existing = try? context.fetch(descriptor).first {
            existing.lastSyncDate = date
            existing.lastSyncCount += 1
        } else {
            let state = SyncState(typeIdentifier: typeIdentifier, lastSyncDate: date, lastSyncCount: 1)
            context.insert(state)
        }

        try? context.save()
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
