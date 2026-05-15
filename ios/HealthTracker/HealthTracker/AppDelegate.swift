import UIKit
import UserNotifications
import os

/// Bridge UIKit per le API che SwiftUI non espone direttamente: APNs token
/// registration + silent push handler. Wire-up in `HealthTrackerApp` via
/// `@UIApplicationDelegateAdaptor(AppDelegate.self)`.
///
/// Il flusso:
/// 1. `application(_:didFinishLaunchingWithOptions:)` → richiede APNs token.
/// 2. `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` →
///    converte token in hex string e lo invia al backend
///    (`POST /api/v1/devices/register`). Idempotente lato server.
/// 3. `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)` →
///    quando arriva un silent push (`content-available: 1`), invoca
///    `pushHandler` (settato da HealthTrackerApp con un closure che chiama
///    `SyncService.performQuickSync(minInterval: 0)`). Il `minInterval: 0`
///    bypassa il throttle perche' il push e' un trigger autorevole dal backend:
///    significa che c'e' lavoro nuovo in coda, non un wake-up generico.
final class AppDelegate: NSObject, UIApplicationDelegate {
    nonisolated private static let logger = Logger(subsystem: "com.healthtracker", category: "apns")

    /// Closure invocato al ricevimento di un silent push. Settato da
    /// `HealthTrackerApp.init()` dopo l'inizializzazione del `SyncService`.
    /// Default no-op: i push ricevuti prima del wire-up vengono ignorati
    /// (caso edge: l'app e' stata launched dal push prima che il syncService
    /// fosse pronto — succede solo nel ms iniziale del cold launch).
    static var pushHandler: (@Sendable () async -> Void)?

    /// Closure invocato al ricevimento di un nuovo APNs token. Settato da
    /// `HealthTrackerApp` per inviare il token al backend.
    static var tokenHandler: (@Sendable (String) async -> Void)?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Notifications authorization (silent + alert opzionale). Anche se
        // usiamo solo silent push (`content-available: 1`), Apple ha tightened
        // il delivery: device che non hanno mai concesso authorization possono
        // ricevere silent push molto inaffidabilmente (specie su sandbox).
        // Chiediamo `.alert` come "courtesy" anche se non emetteremo mai
        // banner (il backend manda solo `content-available`); cosi' iOS
        // considera l'app "trusted" e consegna i background push.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, error in
            if let error {
                Self.logger.error("UN authorization error: \(error.localizedDescription)")
            } else {
                Self.logger.info("UN authorization granted=\(granted)")
            }
            // Procedi col register comunque (silent push tecnicamente non
            // richiede grant, ma e' piu' affidabile averlo).
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        Self.logger.info("APNs registration requested")
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // Token e' raw bytes — APNs vuole hex string lowercase.
        let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Self.logger.info("APNs token registered: \(tokenHex, privacy: .public)")
        if let handler = Self.tokenHandler {
            Task.detached(priority: .utility) {
                await handler(tokenHex)
            }
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Self.logger.error("APNs registration FAILED: \(error.localizedDescription)")
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // Verifica che sia un silent push: deve avere `content-available: 1`.
        // I push con alert/sound non rientrano in questo flow (non li
        // mandiamo dal backend), ma comunque non vogliamo svegliare il sync
        // se manca il marker.
        let aps = userInfo["aps"] as? [String: Any]
        let contentAvailable = (aps?["content-available"] as? Int) == 1
        let reason = userInfo["reason"] as? String ?? "unknown"

        guard contentAvailable else {
            Self.logger.info("Remote notification ignored (no content-available): reason=\(reason, privacy: .public)")
            completionHandler(.noData)
            return
        }

        Self.logger.info("Silent push received: reason=\(reason, privacy: .public)")

        guard let handler = Self.pushHandler else {
            Self.logger.warning("Silent push: no handler wired up yet")
            completionHandler(.noData)
            return
        }

        // Esegui il sync. Il completionHandler DEVE essere chiamato entro 30s
        // (limite imposto da iOS sui silent push background) altrimenti iOS
        // penalizza la priorita' dei nostri push successivi. Usiamo un timeout
        // di sicurezza a 25s.
        let timeout: DispatchTime = .now() + 25
        let didComplete = OSAllocatedUnfairLock<Bool>(initialState: false)

        Task.detached(priority: .userInitiated) {
            await handler()
            // Tenta di chiamare il completion solo se non e' gia' stato chiamato
            // dal timeout fallback.
            didComplete.withLock { done in
                if !done {
                    done = true
                    DispatchQueue.main.async { completionHandler(.newData) }
                }
            }
        }

        DispatchQueue.main.asyncAfter(deadline: timeout) {
            didComplete.withLock { done in
                if !done {
                    done = true
                    Self.logger.warning("Silent push handler exceeded 25s — completing as noData")
                    completionHandler(.noData)
                }
            }
        }
    }
}
