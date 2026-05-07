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

        // Always schedule the next sync FIRST. iOS only re-runs the task if
        // it's been re-submitted; doing it here (not after the await) means
        // that even if this run crashes or is killed, the next slot is queued.
        scheduleNextSync()

        // Guard: setTaskCompleted must be called exactly once. Both the
        // normal completion path and the expirationHandler can fire, and
        // calling it twice is a hard crash on iOS.
        let completed = OSAllocatedUnfairLock(initialState: false)
        let finish: (Bool) -> Void = { success in
            completed.withLock { done in
                if done { return }
                done = true
                task.setTaskCompleted(success: success)
            }
        }

        let syncTask = Task {
            await syncService.performFullSync()
        }

        task.expirationHandler = {
            // iOS gives BGAppRefreshTask ~30s. When it expires we MUST mark
            // the task completed, otherwise iOS treats the run as "hung"
            // and demotes the app's background priority — fewer (or zero)
            // future BG launches.
            self.logger.warning("Background sync expired (>30s)")
            syncTask.cancel()
            finish(false)
        }

        Task {
            await syncTask.value
            self.logger.info("Background sync completed")
            finish(true)
        }
    }
}
