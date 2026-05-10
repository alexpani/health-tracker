import SwiftUI
import SwiftData
import os

@main
struct HealthTrackerApp: App {
    nonisolated private static let logger = Logger(subsystem: "com.healthtracker", category: "app")
    private let syncService = SyncService()
    @Environment(\.scenePhase) private var scenePhase
    private let healthKitManager = HealthKitManager()

    let modelContainer: ModelContainer

    init() {
        Self.logger.info("App init: starting")
        do {
            modelContainer = try ModelContainer(for: SyncState.self)
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }

        // Register the BGAppRefreshTask handler. MUST happen synchronously in
        // App.init (before app finished launching) per iOS rules.
        BackgroundTaskManager.shared.register(syncService: syncService)
        Self.logger.info("App init: BGAppRefreshTask handler registered")

        // CRITICAL: HKObserverQuery + HK background delivery only work if the
        // observers are registered on every launch — including BACKGROUND
        // launches that iOS performs to deliver new HealthKit samples. The
        // SwiftUI `.task { }` modifier on a View only fires when the View
        // actually appears (i.e. foreground launch), so registering observers
        // there silently kills the realtime channel when the app is closed.
        // Register them here at App init so every process start (fg or bg)
        // wires them up.
        let hkm = healthKitManager
        let svc = syncService
        let mc = modelContainer
        Task.detached(priority: .userInitiated) {
            Self.logger.info("App init: requesting HK authorization")
            do {
                try await hkm.requestAuthorization()
                Self.logger.info("App init: HK authorization done")
            } catch {
                Self.logger.error("App init: HK authorization FAILED: \(error.localizedDescription)")
            }
            await MainActor.run { svc.setModelContainer(mc) }
            BackgroundTaskManager.shared.scheduleNextSync()
            Self.logger.info("App init: scheduleNextSync called from app launch")
            await hkm.startObservingNewSamples { [svc] in
                await svc.performQuickSync()
            }
            Self.logger.info("App init: HKObserverQuery setup completed")

            // Start Significant Location Changes as an additional wake-up
            // signal: iOS launches/wakes the app on cell-tower changes even
            // when BGAppRefreshTask is throttled / the app is suspended.
            await MainActor.run {
                LocationWakeManager.shared.start { [svc] in
                    await svc.performQuickSync()
                }
            }
            Self.logger.info("App init: SLC monitoring started")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(syncService)
                .task {
                    // Foreground launch: kick off an immediate auto-sync once
                    // the UI is ready (throttled to 10 min).
                    autoSyncIfNeeded()
                }
        }
        .modelContainer(modelContainer)
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                autoSyncIfNeeded()
            }
        }
    }

    /// Auto-sync: runs in background if one isn't already running and
    /// at least 10 minutes have passed since the last sync.
    private func autoSyncIfNeeded() {
        guard !syncService.isSyncing else { return }
        let minInterval: TimeInterval = 600 // 10 minutes
        if let last = syncService.lastSyncDate, Date().timeIntervalSince(last) < minInterval {
            return
        }
        Task.detached(priority: .utility) {
            await syncService.performQuickSync()
        }
    }
}
