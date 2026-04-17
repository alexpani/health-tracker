import SwiftUI
import SwiftData

@main
struct HealthTrackerApp: App {
    @State private var syncService = SyncService()
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
                }
        }
        .modelContainer(modelContainer)
    }
}
