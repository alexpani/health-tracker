import Foundation
import CoreLocation
import os

/// Uses CoreLocation Significant Location Changes (SLC) as a wake-up signal
/// in the background. iOS launches/wakes the app whenever the device crosses
/// a cell-tower boundary (~500m+), giving us a short window to trigger a
/// quick sync.
///
/// SLC is the cheapest CoreLocation mode (no GPS, just cell-tower changes
/// the system already tracks) and works even after a device reboot. We use
/// it ONLY as a trigger — we don't read or persist the actual coordinates.
@MainActor
final class LocationWakeManager: NSObject {
    static let shared = LocationWakeManager()

    private let logger = Logger(subsystem: "com.healthtracker", category: "location")
    private let manager = CLLocationManager()
    private var onWake: (@Sendable () async -> Void)?

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// Starts SLC monitoring. Idempotent — safe to call from app init on
    /// every launch, including BG launches triggered by SLC itself.
    /// - Parameter onWake: callback invoked when iOS delivers a significant
    ///   location change (i.e. wakes the app). Should kick off a quick sync.
    func start(onWake: @escaping @Sendable () async -> Void) {
        self.onWake = onWake

        // Request "Always" so SLC can wake the app while suspended/terminated.
        // iOS first prompts for "When In Use"; the upgrade to "Always" is
        // surfaced on a later foreground request.
        switch manager.authorizationStatus {
        case .notDetermined:
            logger.info("Location auth: notDetermined; requesting Always")
            manager.requestAlwaysAuthorization()
        case .authorizedWhenInUse:
            logger.info("Location auth: whenInUse; requesting upgrade to Always")
            manager.requestAlwaysAuthorization()
        case .authorizedAlways:
            logger.info("Location auth: alwaysAuthorized")
        case .denied, .restricted:
            logger.warning("Location auth: denied/restricted - SLC won't wake the app")
        @unknown default:
            logger.warning("Location auth: unknown status")
        }

        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else {
            logger.warning("SLC monitoring not available on this device")
            return
        }
        manager.startMonitoringSignificantLocationChanges()
        logger.info("Started monitoring significant location changes")
    }
}

extension LocationWakeManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let count = locations.count
        Task { @MainActor in
            self.logger.info("SLC fired: \(count) location(s)")
            guard let onWake = self.onWake else { return }
            await onWake()
            self.logger.info("SLC sync callback completed")
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus.rawValue
        Task { @MainActor in
            self.logger.info("Location auth changed: \(status)")
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            self.logger.error("Location error: \(message)")
        }
    }
}
