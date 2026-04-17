import BackgroundTasks
import os

final class BackgroundTaskManager {
    static let shared = BackgroundTaskManager()
    private let logger = Logger(subsystem: "com.healthtracker", category: "background")

    private init() {}

    func register(syncService: SyncService) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Constants.backgroundTaskIdentifier,
            using: nil
        ) { task in
            self.handleSync(task: task as! BGAppRefreshTask, syncService: syncService)
        }
        logger.info("Background task registered")
    }

    func scheduleNextSync() {
        let request = BGAppRefreshTaskRequest(identifier: Constants.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3600) // 1 hour
        do {
            try BGTaskScheduler.shared.submit(request)
            logger.info("Next background sync scheduled")
        } catch {
            logger.error("Failed to schedule background sync: \(error.localizedDescription)")
        }
    }

    private func handleSync(task: BGAppRefreshTask, syncService: SyncService) {
        logger.info("Background sync started")

        // Schedule the next sync
        scheduleNextSync()

        let syncTask = Task {
            await syncService.performFullSync()
        }

        task.expirationHandler = {
            syncTask.cancel()
            self.logger.warning("Background sync expired")
        }

        Task {
            await syncTask.value
            task.setTaskCompleted(success: true)
            self.logger.info("Background sync completed")
        }
    }
}
