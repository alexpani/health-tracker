import SwiftUI
import SwiftData

@main
struct HealthTrackerApp: App {
    private let syncService = SyncService()
    @Environment(\.scenePhase) private var scenePhase
    private let healthKitManager = HealthKitManager()

    let modelContainer: ModelContainer

    init() {
        do {
            modelContainer = try ModelContainer(for: SyncState.self)
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }

        // Register the BGAppRefreshTask handler. MUST happen synchronously in
        // App.init (before app finished launching) per iOS rules.
        BackgroundTaskManager.shared.register(syncService: syncService)

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
            try? await hkm.requestAuthorization()
            await MainActor.run { svc.setModelContainer(mc) }
            BackgroundTaskManager.shared.scheduleNextSync()
            await hkm.startObservingNewSamples { [svc] in
                await svc.performQuickSync()
            }
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
