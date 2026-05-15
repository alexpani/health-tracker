import Foundation
import HealthKit
import SwiftData
import UIKit
import os

/// Returns true if protected data is currently inaccessible — i.e. the
/// device is locked. This is the *real* signal that HKAnchoredObjectQuery /
/// HKSampleQuery will silently return 0 samples for protected types
/// (StepCount, HeartRate, AEE, BEE, ...) WITHOUT throwing. If we naively
/// persisted the new anchor in that state, those samples would be skipped
/// forever once the device unlocks. Note: an app can run in `.background`
/// with the device unlocked — HK reads still succeed in that case, so the
/// guard must key off the *lock* state, not the app state.
@MainActor
func isProtectedDataInaccessible() -> Bool {
    !UIApplication.shared.isProtectedDataAvailable
}

/// Riconosce l'errore HK "Protected health data is inaccessible"
/// (`HKError.errorDatabaseInaccessible`, code 8). Si presenta:
/// - sui sync triggerati subito dopo `protectedDataDidBecomeAvailable`
///   perche' HK ha la sua chiave di derivazione che richiede un istante in
///   piu' rispetto al flag a livello UIKit;
/// - sui sync in BG che iniziano unlocked e finiscono mentre il device si
///   blocca a meta';
/// - sui sync subito dopo il primo boot (prima del first-unlock).
func isProtectedDataError(_ error: Error) -> Bool {
    let nsErr = error as NSError
    if nsErr.domain == HKError.errorDomain
        && nsErr.code == HKError.Code.errorDatabaseInaccessible.rawValue {
        return true
    }
    return nsErr.localizedDescription.contains("Protected health data is inaccessible")
}

/// Persisted summary of a single completed sync
struct LastSyncSummary: Codable, Identifiable, Hashable {
    var startedAt: Date
    var completedAt: Date
    var durationSeconds: Double
    var totalSamples: Int
    var log: [String]
    var wasInterrupted: Bool

    var id: Date { startedAt }
}

@Observable
final class SyncService {
    var isSyncing = false
    var lastSyncDate: Date?
    /// Timestamp dell'ultimo sync che ha realmente fatto qualcosa: o ha
    /// pescato almeno un sample, o e' stato eseguito con `isProtectedData`
    /// disponibile (device unlocked). I sync BG-locked che ritornano 0/0
    /// per tutti i tipi NON aggiornano questo timestamp — cosi' il throttle
    /// foreground/quick non viene "avvelenato" da no-op e l'utente che
    /// apre l'app riesce a far partire un sync reale.
    var lastSuccessfulSyncDate: Date?
    var lastSyncStartedAt: Date?
    var lastSyncDurationSeconds: Double?
    var lastSyncTotalSamples: Int = 0
    var lastSyncLog: [String] = []        // preserved summary of the last completed sync
    var lastSyncWasInterrupted: Bool = false
    /// Storico delle ultime N sync completate (capped a `maxRecentSyncs`,
    /// piu' recente prima). Persistito su UserDefaults insieme alla last
    /// sync. Mostrato in `SyncStatusView`.
    var recentSyncs: [LastSyncSummary] = []
    var currentType: String = ""
    var progress: Double = 0
    var typeProgress: Double = 0          // progress within current type (0..1)
    var currentWindowDate: Date?          // latest date reached in current type
    var totalSamplesSynced: Int = 0       // live counter this sync
    var lastError: String?
    var syncLog: [String] = []
    var shouldStop: Bool = false          // set to true to cancel mid-sync

    /// Settato a true se durante il sync HK ha rifiutato almeno una lettura
    /// con `HKError.errorDatabaseInaccessible` (= "Protected health data is
    /// inaccessible"). Succede quando la notifica
    /// `protectedDataDidBecomeAvailable` arriva troppo presto (HK ha la sua
    /// derivazione di chiave che richiede un istante in piu' rispetto al
    /// flag `UIApplication.isProtectedDataAvailable`), o quando il device si
    /// rilocka a meta' sync. Quando true a fine sync: NIENTE bump di
    /// `lastSuccessfulSyncDate`, NIENTE heartbeat — cosi' il prossimo trigger
    /// (osservatore/SLC/foreground) non viene throttled fuori.
    private var hadProtectedDataErrorThisSync = false

    /// Quanti row daily-stats sono stati upserted in questo sync. Tenuto
    /// separato da `totalSamplesSynced` perche' il backend non crea SyncLog
    /// entries per `/daily-stats/batch` (lo fa solo per
    /// samples/categories/workouts). Lo usiamo come `sample_count` quando
    /// postiamo l'heartbeat di sync vuoto, cosi' la dashboard vede una riga
    /// "wake-up N campioni" invece di "wake-up 0 campioni" quando il sync
    /// ha aggiornato solo i totali giornalieri.
    private var dailyStatsUpsertedThisSync = 0

    private let healthKitManager = HealthKitManager()
    private let apiClient = APIClient()
    private var modelContainer: ModelContainer?

    private let logger = Logger(subsystem: "com.healthtracker", category: "sync")

    // 90-day chunks keep peak memory reasonable
    private let fetchWindowDays = 90

    // Types to sync LAST (after everything else has finished).
    private let deferredTypes: Set<String> = []

    private let lastSyncKey = "last_sync_summary_v1"
    private let recentSyncsKey = "recent_syncs_v1"
    private let lastSuccessfulSyncKey = "last_successful_sync_v1"
    private let maxRecentSyncs = 5

    init() {
        loadLastSyncSummary()
        if let t = UserDefaults.standard.object(forKey: lastSuccessfulSyncKey) as? Date {
            lastSuccessfulSyncDate = t
        }
    }

    @MainActor
    func setModelContainer(_ container: ModelContainer) {
        self.modelContainer = container
        registerProtectedDataWakeUp()
    }

    /// Registra un osservatore per `UIApplication.protectedDataDidBecomeAvailable`:
    /// quando il device sblocca (o termina il post-boot first-unlock), HK
    /// torna leggibile e possiamo far partire un sync. NB: la notifica arriva
    /// PRIMA che HK sia effettivamente pronto (HK ha una sua chiave di
    /// derivazione che richiede qualche centinaia di ms in piu' rispetto al
    /// flag a livello UIKit). Aspettiamo 2s prima di triggerare il sync per
    /// evitare di sbattere contro `HKError.errorDatabaseInaccessible`. Anche
    /// se sbattiamo lo stesso, il flag `hadProtectedDataErrorThisSync` evita
    /// di poisonare `lastSuccessfulSyncDate` e il prossimo trigger riprende.
    @MainActor
    private func registerProtectedDataWakeUp() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.logger.info("Protected data became available — kicking quick sync (after 2s warm-up)")
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await self.performQuickSync()
            }
        }
    }

    private func loadLastSyncSummary() {
        // Storico recenti (piu' nuovo prima)
        if let data = UserDefaults.standard.data(forKey: recentSyncsKey),
           let arr = try? JSONDecoder().decode([LastSyncSummary].self, from: data) {
            recentSyncs = arr
        }
        // Last sync (back-compat con il vecchio singleton)
        if let last = recentSyncs.first {
            applyToLatest(last)
        } else if let data = UserDefaults.standard.data(forKey: lastSyncKey),
                  let summary = try? JSONDecoder().decode(LastSyncSummary.self, from: data) {
            recentSyncs = [summary]
            applyToLatest(summary)
        }
    }

    private func applyToLatest(_ summary: LastSyncSummary) {
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
            totalSamples: totalSamplesSynced + dailyStatsUpsertedThisSync,
            log: syncLog,
            wasInterrupted: interrupted
        )
        // Prepend, cap at maxRecentSyncs
        recentSyncs.insert(summary, at: 0)
        if recentSyncs.count > maxRecentSyncs {
            recentSyncs.removeLast(recentSyncs.count - maxRecentSyncs)
        }
        if let data = try? JSONEncoder().encode(recentSyncs) {
            UserDefaults.standard.set(data, forKey: recentSyncsKey)
        }
        // Mantieni anche la chiave singleton per back-compat con eventuali
        // letture vecchie (puo' essere rimossa in futuro).
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
        let locked = isProtectedDataInaccessible()
        logger.info("Quick sync triggered (minInterval=\(Int(minInterval))s, locked=\(locked))")
        if isSyncing {
            logger.info("Quick sync skipped: already syncing")
            return
        }
        // Throttle against the last *successful* sync, not the last attempt.
        // Otherwise BG-locked no-op attempts would advance the gate and starve
        // the next real sync that could actually fetch data.
        if let last = lastSuccessfulSyncDate {
            let elapsed = Date().timeIntervalSince(last)
            if elapsed < minInterval {
                logger.info("Quick sync skipped: throttled (last successful \(Int(elapsed))s < \(Int(minInterval))s)")
                return
            }
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
        // Device locked → HK letture protette ritornano 0 senza errore. Saltare
        // tutto il sync invece di iterare 50+ tipi che produrrebbero solo
        // anchor mancati e una riga "0 campioni" sulla dashboard. Il listener
        // `protectedDataDidBecomeAvailable` + i prossimi trigger (BG/SLC/
        // foreground) ripartiranno appena il device sblocca.
        if isProtectedDataInaccessible() {
            logger.info("Sync skipped: device locked (protected data inaccessible)")
            return
        }
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
        hadProtectedDataErrorThisSync = false
        dailyStatsUpsertedThisSync = 0

        // Process pending writes and deletions FIRST (quick)
        await processPendingWrites()
        await processPendingDeletions()

        let totalTypes = HealthKitManager.quantityTypes.count
            + HealthKitManager.categoryTypes.count
            + 1 // workouts
        var completedTypes = 0

        // Split in two passes: non-deferred first, then deferred (heavy) at the end.
        // Body-metric types are also pulled out and synced via anchored queries
        // (they come first because they're fast and user-visible on the dashboard).
        let anchoredIds = Self.anchoredQuantityIds
        let quantityNormal = HealthKitManager.quantityTypes.filter {
            !deferredTypes.contains($0.0.rawValue) && !anchoredIds.contains($0.0.rawValue)
        }
        let quantityDeferred = HealthKitManager.quantityTypes.filter { deferredTypes.contains($0.0.rawValue) }
        let categoryNormal = HealthKitManager.categoryTypes.filter { !deferredTypes.contains($0.rawValue) }
        let categoryDeferred = HealthKitManager.categoryTypes.filter { deferredTypes.contains($0.rawValue) }

        // PASS -1: daily statistics via HKStatisticsCollectionQuery for the 9
        // cumulative activity types. HealthKit applies its proprietary dedup
        // (Watch wins over iPhone) so the totals match what Apple Salute
        // shows in its widgets — additive to the raw-samples sync below.
        if !shouldStop {
            currentType = "Daily statistics"
            typeProgress = 0
            currentWindowDate = nil
            await syncDailyStats()
        }

        // PASS 0: body-metric + Watch cumulative types via anchored queries.
        // Parallelizziamo: HKAnchoredObjectQuery per tipo e' indipendente,
        // HKHealthStore e' thread-safe. Con 16 tipi che spesso non hanno
        // nuovi sample, in serie ci stavano tipo 5-10s per gli overhead di
        // HK; in parallelo ~1s.
        if !shouldStop {
            currentType = "Anchored quantity types"
            typeProgress = 0
            currentWindowDate = nil
            await withTaskGroup(of: Void.self) { group in
                for (typeId, unit) in Self.anchoredQuantityTypes {
                    if shouldStop { break }
                    group.addTask { [self] in
                        await syncQuantityTypeAnchored(typeId: typeId, unit: unit)
                    }
                }
            }
            completedTypes += Self.anchoredQuantityTypes.count
            progress = Double(completedTypes) / Double(totalTypes)
        }

        // PASS 1: tipi normali (windowed). Parallelizziamo a gruppi limitati
        // (max 4 in volo) per evitare di saturare HK / il backend con troppe
        // POST concorrenti.
        if !shouldStop {
            currentType = "Quantity types"
            typeProgress = 0
            await withTaskGroup(of: Void.self) { group in
                var inflight = 0
                let maxInflight = 4
                for (typeId, unit) in quantityNormal {
                    if shouldStop { break }
                    if inflight >= maxInflight {
                        await group.next()
                        inflight -= 1
                    }
                    group.addTask { [self] in
                        await syncQuantityType(typeId: typeId, unit: unit)
                    }
                    inflight += 1
                }
                while await group.next() != nil {}
            }
            completedTypes += quantityNormal.count
            progress = Double(completedTypes) / Double(totalTypes)
        }

        if !shouldStop {
            currentType = "Category types"
            typeProgress = 0
            await withTaskGroup(of: Void.self) { group in
                var inflight = 0
                let maxInflight = 4
                for typeId in categoryNormal {
                    if shouldStop { break }
                    if inflight >= maxInflight {
                        await group.next()
                        inflight -= 1
                    }
                    group.addTask { [self] in
                        await syncCategoryType(typeId: typeId)
                    }
                    inflight += 1
                }
                while await group.next() != nil {}
            }
            completedTypes += categoryNormal.count
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

        // GPS routes backfill — bounded per sync to avoid blocking. Runs after
        // workouts so the priority pass for newly-inserted ones (inside
        // syncWorkouts) has already happened.
        if !shouldStop {
            await syncWorkoutRoutesBackfill()
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
            let now = Date()
            lastSyncDate = now
            if hadProtectedDataErrorThisSync {
                // HK ha rifiutato letture per "Protected health data is
                // inaccessible" — il sync e' parziale (probabilmente la
                // notifica `protectedDataDidBecomeAvailable` e' arrivata
                // troppo presto e HK non era ancora pronto per tutti i tipi
                // protetti). NON aggiorniamo `lastSuccessfulSyncDate` cosi'
                // il prossimo trigger non viene throttled e riprende cio'
                // che e' rimasto fuori.
                // PERO' se nel frattempo qualcosa e' andato a buon fine
                // (daily stats, pending writes, anchored che gira prima del
                // lock, ecc), postiamo comunque l'heartbeat con il count
                // del lavoro completato cosi' la dashboard mostra la riga.
                syncLog.append("Sync interrotto: HK non ancora accessibile")
                logger.info("Sync ended with protected-data errors — not updating lastSuccessfulSyncDate")
                // Heartbeat con SOLO i daily stats: i sample grezzi
                // (totalSamplesSynced) sono gia' stati loggati dai batch
                // endpoint del backend, quindi includerli qui sarebbe doppio
                // conteggio nella session table.
                if dailyStatsUpsertedThisSync > 0 {
                    try? await apiClient.postSyncHeartbeat(sampleCount: dailyStatsUpsertedThisSync)
                }
            } else {
                // "Successo" = ha pescato dati OPPURE e' stato eseguito con
                // device unlocked (foreground o BG con dati accessibili).
                lastSuccessfulSyncDate = now
                UserDefaults.standard.set(now, forKey: lastSuccessfulSyncKey)
                if syncLog.isEmpty {
                    syncLog.append("Nessun nuovo dato da sincronizzare")
                }
                // Log on the backend so the dashboard's sync sessions table
                // riflette l'attivita' del sync. Tre casi:
                // - daily stats > 0 → heartbeat con quel count. Il backend
                //   non crea SyncLog entries per `/daily-stats/batch`, quindi
                //   senza heartbeat i daily stats sparirebbero dalla session
                //   anche quando ci sono sample grezzi affiancati;
                // - daily stats == 0 e sample grezzi == 0 → heartbeat con 0
                //   (wake-up vuoto, registrato per visibilita');
                // - daily stats == 0 e sample grezzi > 0 → no heartbeat: i
                //   batch grezzi hanno gia' creato le proprie SyncLog rows.
                if dailyStatsUpsertedThisSync > 0 {
                    try? await apiClient.postSyncHeartbeat(
                        sampleCount: dailyStatsUpsertedThisSync
                    )
                } else if totalSamplesSynced == 0 {
                    try? await apiClient.postSyncHeartbeat(sampleCount: 0)
                }
            }
        }

        // Preserve summary of this sync for the UI + persist across launches.
        // Per l'UI sommiamo daily stats + sample grezzi cosi' l'utente vede
        // un conteggio aggregato di "campioni" sincronizzati. Internamente i
        // due restano separati per la logica heartbeat (sopra).
        let wasInterrupted = shouldStop
        lastSyncDurationSeconds = Date().timeIntervalSince(startedAt)
        lastSyncTotalSamples = totalSamplesSynced + dailyStatsUpsertedThisSync
        lastSyncLog = syncLog
        lastSyncWasInterrupted = wasInterrupted
        saveLastSyncSummary(startedAt: startedAt, interrupted: wasInterrupted)

        // Retry: il sync e' fallito per HK protected-data (di solito perche'
        // la notifica `protectedDataDidBecomeAvailable` arriva troppo presto
        // e HK non ha ancora caricato le chiavi). Il flag
        // `hadProtectedDataErrorThisSync` ha gia' impedito il bump di
        // `lastSuccessfulSyncDate`, ma senza un nuovo trigger l'utente resta
        // a guardare un sync fallito finche' un altro evento (osservatore,
        // SLC, BG task, foreground) non capita. Schedula un retry tra 8s.
        let needsProtectedDataRetry = hadProtectedDataErrorThisSync && !shouldStop

        currentType = ""
        currentWindowDate = nil
        typeProgress = 0
        isSyncing = false
        shouldStop = false

        // Re-arm the BG task chain at the end of every sync (foreground or
        // background, manual or auto). BGTaskScheduler.submit() is idempotent
        // for the same identifier, so this is safe even when handleSync()
        // already scheduled the next launch at the very start of the run.
        BackgroundTaskManager.shared.scheduleNextSync()

        if needsProtectedDataRetry {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                await self?.performQuickSync()
            }
        }
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

                // Advance the bookmark, but if the device is locked with an
                // empty fetch skip the advance: HK returns 0 samples without
                // throwing for protected types in that state, and naively
                // advancing lastSyncDate would skip those samples forever
                // once unlocked. (Belt-and-braces: performFullSync already
                // early-aborts when protected data is inaccessible, but the
                // device can lock mid-sync.)
                let locked = isProtectedDataInaccessible()
                if !samples.isEmpty || !locked {
                    await updateSyncDate(for: typeId.rawValue, date: windowEnd)
                    currentWindowDate = windowEnd
                    if totalDuration > 0 {
                        typeProgress = min(1.0, windowEnd.timeIntervalSince(effectiveStart) / totalDuration)
                    }
                } else {
                    // Locked + empty → exit the loop without advancing; will
                    // retry on the next sync (foreground or unlocked).
                    return
                }
            } catch {
                if isProtectedDataError(error) { hadProtectedDataErrorThisSync = true }
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
                // Locked + empty fetch → don't advance bookmark (protected
                // data is silently masked). See syncQuantityType for the
                // full rationale.
                let locked = isProtectedDataInaccessible()
                if !samples.isEmpty || !locked {
                    await updateSyncDate(for: typeId.rawValue, date: windowEnd)
                    currentWindowDate = windowEnd
                    if totalDuration > 0 {
                        typeProgress = min(1.0, windowEnd.timeIntervalSince(effectiveStart) / totalDuration)
                    }
                } else {
                    return
                }
            } catch {
                if isProtectedDataError(error) { hadProtectedDataErrorThisSync = true }
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
        // Use HKAnchoredObjectQuery so we receive deletions too.
        let anchorKey = "hk_workout_anchor_v1"
        let anchor: HKQueryAnchor? = {
            guard let data = UserDefaults.standard.data(forKey: anchorKey) else { return nil }
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
        }()

        do {
            let (added, deletedUUIDs, newAnchor) = try await healthKitManager.fetchWorkoutsAnchored(anchor: anchor)

            var totalInserted = 0
            if !added.isEmpty {
                let chunks = added.chunked(into: Constants.syncBatchSize)
                let inserted = try await postChunksInParallel(chunks) { chunk in
                    try await self.apiClient.postWorkouts(chunk)
                }
                totalInserted = inserted
                totalSamplesSynced += inserted
            }

            var deletedCount = 0
            if !deletedUUIDs.isEmpty {
                deletedCount = try await apiClient.deleteWorkouts(uuids: deletedUUIDs)
            }

            // Persist the new anchor on success — but if the device is locked
            // skip the persist when HK returned zero samples AND zero
            // deletions, because protected types are silently masked then. If
            // we advanced the anchor we'd skip the real samples forever once
            // the device unlocks. With data accessible 0/0 truly means
            // "nothing new", so advance normally.
            let locked = isProtectedDataInaccessible()
            let didAnything = !added.isEmpty || !deletedUUIDs.isEmpty
            if let newAnchor, (didAnything || !locked) {
                if let data = try? NSKeyedArchiver.archivedData(withRootObject: newAnchor, requiringSecureCoding: true) {
                    UserDefaults.standard.set(data, forKey: anchorKey)
                }
            }

            if totalInserted > 0 || deletedCount > 0 {
                let msg = "Workouts: \(totalInserted) synced, \(deletedCount) removed"
                syncLog.append(msg)
                logger.info("\(msg)")
            }

            // Push GPS routes for the workouts we just inserted (priority pass).
            // We always try, even for workouts that probably don't have a route
            // (indoor / third-party imports): the backend stores an empty list
            // so the missing-routes backfill loop won't re-check them.
            for w in added {
                await uploadRoute(forWorkoutUUID: w.uuid)
            }
        } catch {
            if isProtectedDataError(error) { hadProtectedDataErrorThisSync = true }
            let msg = "Workouts: anchored sync failed - \(error.localizedDescription)"
            syncLog.append(msg)
            logger.error("\(msg)")
        }
    }

    /// Backfill GPS routes for workouts already in the backend that don't
    /// have a route ingested yet. Bounded to `maxBackfillPerSync` per call so
    /// a single sync doesn't spend forever crawling years of historical
    /// workouts. Subsequent syncs continue the work. Una volta che lo
    /// storico iniziale e' assorbito, il valore puo' essere abbassato.
    private static let maxBackfillPerSync = 500

    @MainActor
    private func syncWorkoutRoutesBackfill() async {
        currentType = "Workout routes (backfill)"
        typeProgress = 0
        var processed = 0
        var withRoute = 0
        var cursor: String? = nil

        while processed < Self.maxBackfillPerSync {
            if shouldStop { break }
            let batchLimit = min(50, Self.maxBackfillPerSync - processed)
            let resp: APIClient.MissingRoutesResponse
            do {
                resp = try await apiClient.fetchMissingRoutes(limit: batchLimit, before: cursor)
            } catch {
                logger.error("Workout routes backfill: fetch missing failed - \(error.localizedDescription)")
                return
            }
            if resp.uuids.isEmpty { break }

            for item in resp.uuids {
                if shouldStop { break }
                guard let uuid = UUID(uuidString: item.uuid) else { continue }
                let hadPoints = await uploadRoute(forWorkoutUUID: item.uuid, hkUUID: uuid)
                if hadPoints { withRoute += 1 }
                processed += 1
                if Self.maxBackfillPerSync > 0 {
                    typeProgress = min(1.0, Double(processed) / Double(Self.maxBackfillPerSync))
                }
            }

            // Cursor = oldest start_date in this batch, so next iteration
            // continues from there.
            cursor = resp.uuids.last?.start_date
            // If we got fewer results than requested, the queue is empty.
            if resp.count < batchLimit { break }
        }

        if processed > 0 {
            let msg = "Workout routes: \(withRoute)/\(processed) con GPS"
            syncLog.append(msg)
            logger.info("\(msg)")
        }
    }

    /// Reads the GPS route for a workout from HealthKit and POSTs it to the
    /// backend. Always POSTs, even if empty: an empty list marks the workout
    /// as "checked, no GPS data". Returns true if at least one point was
    /// uploaded, false otherwise. Errors are logged and swallowed — a failed
    /// route upload must never break the rest of the sync.
    @discardableResult
    @MainActor
    private func uploadRoute(forWorkoutUUID uuidString: String, hkUUID: UUID? = nil) async -> Bool {
        let uuid = hkUUID ?? UUID(uuidString: uuidString)
        guard let uuid else { return false }
        do {
            let points = (try await healthKitManager.fetchWorkoutRoute(workoutUUID: uuid)) ?? []
            try await apiClient.postWorkoutRoute(workoutUUID: uuidString, points: points)
            return !points.isEmpty
        } catch {
            logger.error("Route upload failed for \(uuidString): \(error.localizedDescription)")
            return false
        }
    }

    /// I 9 tipi cumulative attivita' per cui sincronizziamo i totali
    /// giornalieri pre-calcolati da `HKStatisticsCollectionQuery`. Sono gli
    /// stessi numeri che Apple Salute mostra nei suoi widget (HK applica
    /// internamente il dedup Watch+iPhone proprietario).
    static let dailyStatsTypes: [(HKQuantityTypeIdentifier, HKUnit)] = [
        (.stepCount,                .count()),
        (.distanceWalkingRunning,   .meter()),
        (.distanceCycling,          .meter()),
        (.distanceSwimming,         .meter()),
        (.flightsClimbed,           .count()),
        (.activeEnergyBurned,       .kilocalorie()),
        (.basalEnergyBurned,        .kilocalorie()),
        (.appleExerciseTime,        .minute()),
        (.appleStandTime,           .minute()),
        (.appleMoveTime,            .minute()),
    ]

    @MainActor
    private func syncDailyStats() async {
        let totalTypes = Double(Self.dailyStatsTypes.count)
        var done = 0
        var grandTotal = 0

        // ISO local-date formatter (yyyy-MM-dd in current calendar)
        let dayFmt = DateFormatter()
        dayFmt.calendar = Calendar(identifier: .gregorian)
        dayFmt.locale = Locale(identifier: "en_US_POSIX")
        dayFmt.timeZone = TimeZone.current
        dayFmt.dateFormat = "yyyy-MM-dd"

        // Lower bound for first sync — well before the user's first device.
        let firstSyncFloor: Date = {
            var c = DateComponents()
            c.year = 2014; c.month = 1; c.day = 1
            return Calendar.current.date(from: c) ?? Date.distantPast
        }()

        let now = Date()

        // I 9 tipi sono indipendenti: 9 HKStatisticsCollectionQuery + 9
        // POST in parallelo. Cosi' restiamo nei ~500ms anche con 3 giorni
        // di rewind per ciascuno (in serie erano ~3-5s).
        let endOfToday = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now)) ?? now

        await withTaskGroup(of: (String, Int, Bool).self) { group in
            for (typeId, unit) in Self.dailyStatsTypes {
                if shouldStop { break }
                let anchorKey = "lastDailyStatsAt_\(typeId.rawValue)"
                let lastAt = UserDefaults.standard.object(forKey: anchorKey) as? Date
                let from: Date = {
                    if let lastAt {
                        return Calendar.current.date(byAdding: .day, value: -3, to: lastAt) ?? lastAt
                    }
                    return firstSyncFloor
                }()
                let typeName = typeId.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")

                group.addTask { [self, dayFmt] in
                    do {
                        let points = try await healthKitManager.fetchDailyStatistics(
                            type: typeId, unit: unit, from: from, to: endOfToday
                        )
                        let nonZero = points.filter { $0.value > 0 }
                        var upserted = 0
                        if !nonZero.isEmpty {
                            let payload = nonZero.map { (date: dayFmt.string(from: $0.date), value: $0.value) }
                            upserted = try await apiClient.postDailyStats(type: typeId.rawValue, points: payload)
                        }
                        UserDefaults.standard.set(now, forKey: anchorKey)
                        return (typeName, upserted, false)
                    } catch {
                        return (typeName, -1, isProtectedDataError(error))
                    }
                }
            }

            for await (typeName, upserted, protectedErr) in group {
                done += 1
                typeProgress = Double(done) / totalTypes
                if protectedErr { hadProtectedDataErrorThisSync = true }
                if upserted > 0 {
                    grandTotal += upserted
                    let msg = "Daily \(typeName): \(upserted) days"
                    syncLog.append(msg)
                    logger.info("\(msg)")
                } else if upserted < 0 {
                    let msg = "Daily \(typeName): failed"
                    syncLog.append(msg)
                    logger.error("\(msg)")
                }
            }
        }

        if grandTotal > 0 {
            logger.info("Daily statistics: \(grandTotal) total days upserted")
        }
        dailyStatsUpsertedThisSync = grandTotal
    }

    /// Quantity types synced via HKAnchoredObjectQuery instead of the plain
    /// windowed HKSampleQuery. These types are often written retroactively
    /// into HealthKit by third-party sources (Withings for weight; Lifesum,
    /// MyFitnessPal etc. for dietary) — i.e. startDate in the past but the
    /// sample arrives in HealthKit after our windowed lastSyncDate has
    /// already advanced, so the windowed path silently misses them.
    /// Anchored queries track HealthKit insertion order (HKObjectID), so
    /// late-arriving samples are never lost.
    static let anchoredQuantityTypes: [(HKQuantityTypeIdentifier, HKUnit)] = [
        // Body metrics
        (.bodyMass,            .gramUnit(with: .kilo)),
        (.bodyMassIndex,       .count()),
        (.bodyFatPercentage,   .percent()),
        (.leanBodyMass,        .gramUnit(with: .kilo)),
        (.height,              .meter()),
        (.waistCircumference,  .meter()),
        // Dietary (Lifesum, MyFitnessPal etc. write per-meal samples with
        // startDate of the meal and creationDate at sync time — anchored
        // is the only reliable way to pick them up).
        (.dietaryEnergyConsumed, .kilocalorie()),
        (.dietaryCarbohydrates,  .gram()),
        (.dietaryFatTotal,       .gram()),
        (.dietaryProtein,        .gram()),
        // Apple Watch cumulative activity types — Watch writes samples to
        // HealthKit retroactively when it syncs with the iPhone (often
        // hours after the activity). The windowed lastSyncDate path with
        // .strictStartDate misses any sample that arrives in HealthKit
        // after the previous sync's "now" moved past its startDate. This
        // showed up as daily kcal/steps totals being 5–25% lower than
        // Apple Salute.
        (.activeEnergyBurned,        .kilocalorie()),
        (.basalEnergyBurned,         .kilocalorie()),
        (.stepCount,                 .count()),
        (.distanceWalkingRunning,    .meter()),
        (.distanceCycling,           .meter()),
        (.flightsClimbed,            .count()),
        (.appleExerciseTime,         .minute()),
        (.appleStandTime,            .minute()),
        (.appleMoveTime,             .minute()),
    ]

    static var anchoredQuantityIds: Set<String> {
        Set(anchoredQuantityTypes.map { $0.0.rawValue })
    }

    @MainActor
    private func syncQuantityTypeAnchored(typeId: HKQuantityTypeIdentifier, unit: HKUnit) async {
        let anchorKey = "hk_quantity_anchor_v1_\(typeId.rawValue)"
        let anchor: HKQueryAnchor? = {
            guard let data = UserDefaults.standard.data(forKey: anchorKey) else { return nil }
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
        }()

        do {
            let (added, deletedUUIDs, newAnchor) = try await healthKitManager.fetchQuantitySamplesAnchored(
                type: typeId, unit: unit, anchor: anchor
            )

            var totalInserted = 0
            if !added.isEmpty {
                let chunks = added.chunked(into: Constants.syncBatchSize)
                let inserted = try await postChunksInParallel(chunks) { chunk in
                    try await self.apiClient.postSamples(chunk)
                }
                totalInserted = inserted
                totalSamplesSynced += inserted
            }

            var deletedCount = 0
            if !deletedUUIDs.isEmpty {
                deletedCount = try await apiClient.deleteSamples(uuids: deletedUUIDs)
            }

            // Persist the new anchor on success — but if the device is locked
            // skip the persist when HK returned zero samples AND zero
            // deletions, because protected types are silently masked then. If
            // we advanced the anchor we'd skip the real samples forever once
            // the device unlocks. With data accessible 0/0 truly means
            // "nothing new", so advance normally.
            let locked = isProtectedDataInaccessible()
            let didAnything = !added.isEmpty || !deletedUUIDs.isEmpty
            if let newAnchor, (didAnything || !locked) {
                if let data = try? NSKeyedArchiver.archivedData(withRootObject: newAnchor, requiringSecureCoding: true) {
                    UserDefaults.standard.set(data, forKey: anchorKey)
                }
            }

            if totalInserted > 0 || deletedCount > 0 {
                let msg = "\(typeId.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")): \(totalInserted) synced, \(deletedCount) removed (anchored)"
                syncLog.append(msg)
                logger.info("\(msg)")
            }
        } catch {
            if isProtectedDataError(error) { hadProtectedDataErrorThisSync = true }
            let msg = "\(typeId.rawValue): anchored fetch failed - \(error.localizedDescription)"
            syncLog.append(msg)
            logger.error("\(msg)")
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
        var deferred = 0
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
                // Distinguish TRANSIENT errors (worth retrying next sync) from
                // PERMANENT failures (no point retrying). The most common
                // transient case is HKError.errorDatabaseInaccessible (code 8)
                // = "Protected health data is inaccessible" returned by
                // HealthKit when the iPhone is locked. HK allows puntuali
                // *writes* even when locked, but `delete()` is forbidden, so
                // background-triggered syncs while the phone is locked produce
                // a stream of false "failed" deletions.
                //
                // For transient errors we leave the row in `pending` status
                // (no API call) so the next sync — when the phone is hopefully
                // unlocked — picks it up and retries.
                let nsErr = error as NSError
                let isTransient =
                    nsErr.domain == HKError.errorDomain
                    && nsErr.code == HKError.Code.errorDatabaseInaccessible.rawValue
                if isTransient {
                    deferred += 1
                    continue
                }
                try? await apiClient.failDeletion(id: item.id, error: error.localizedDescription)
                failed += 1
            }
        }

        typeProgress = 1.0
        syncLog.append("Deletions: \(ok) ok, \(failed) failed, \(deferred) deferred")
        logger.info("Deletions processed: \(ok) ok, \(failed) failed, \(deferred) deferred")
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
