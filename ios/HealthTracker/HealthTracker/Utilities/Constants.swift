import Foundation

enum Constants {
    static let defaultServerURL = "http://192.168.1.100:8000"
    static let serverURLKey = "server_url"
    static let deviceIDKey = "device_id"
    static let syncBatchSize = 1000
    static let syncConcurrency = 4
    static let backgroundTaskIdentifier = "com.healthtracker.sync"
}
