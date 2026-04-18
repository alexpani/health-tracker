import SwiftUI
import SwiftData

@main
struct HealthTrackerApp: App {
    @State private var syncService = SyncService()
    @Environment(\.scenePhase) private var scenePhase
    private let healthKitManager = HealthKitManager()

    let modelContainer: ModelContainer

    init() {
        do {
            modelContainer = try ModelContainer(for: SyncState.self)
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }

        // Register background task
        BackgroundTaskManager.shared.register(syncService: syncService)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(syncService)
                .task {
                    // Request HealthKit authorization on first launch
                    try? await healthKitManager.requestAuthorization()
                    syncService.setModelContainer(modelContainer)

                    // Schedule background sync
                    BackgroundTaskManager.shared.scheduleNextSync()

                    // Start real-time HealthKit observers
                    await healthKitManager.startObservingNewSamples { [syncService] in
                        await syncService.performQuickSync()
                    }

                    // Initial auto-sync on launch (throttled)
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
