import Foundation
import SwiftData

@Model
final class SyncState {
    @Attribute(.unique) var typeIdentifier: String
    var lastSyncDate: Date?
    var lastSyncCount: Int

    init(typeIdentifier: String, lastSyncDate: Date? = nil, lastSyncCount: Int = 0) {
        self.typeIdentifier = typeIdentifier
        self.lastSyncDate = lastSyncDate
        self.lastSyncCount = lastSyncCount
    }
}
