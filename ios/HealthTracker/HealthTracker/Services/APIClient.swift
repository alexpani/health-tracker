import Foundation

struct BatchResult: Codable {
    let inserted: Int
    let duplicatesSkipped: Int

    enum CodingKeys: String, CodingKey {
        case inserted
        case duplicatesSkipped = "duplicates_skipped"
    }
}

struct SamplePayload: Codable {
    let uuid: String
    let type: String
    let value: Double
    let unit: String
    let startDate: String
    let endDate: String
    let sourceName: String?
    let sourceBundleId: String?
    let device: String?
    let metadata: [String: String]?

    enum CodingKeys: String, CodingKey {
        case uuid, type, value, unit
        case startDate = "start_date"
        case endDate = "end_date"
        case sourceName = "source_name"
        case sourceBundleId = "source_bundle_id"
        case device, metadata
    }
}

struct CategoryPayload: Codable {
    let uuid: String
    let type: String
    let value: Int
    let startDate: String
    let endDate: String
    let sourceName: String?
    let sourceBundleId: String?
    let metadata: [String: String]?

    enum CodingKeys: String, CodingKey {
        case uuid, type, value
        case startDate = "start_date"
        case endDate = "end_date"
        case sourceName = "source_name"
        case sourceBundleId = "source_bundle_id"
        case metadata
    }
}

struct WorkoutActivityPayload {
    let n: Int
    let kind: String       // "work" | "rest" | "lap" | "segment" | "pause"
    let name: String?
    let activityType: Int?    // HKWorkoutActivityType.rawValue of this sub-activity
    let activityName: String? // display name of the activityType (e.g., "Corsa", "Camminata")
    let start: String
    let end: String
    let durationS: Double
    let distanceM: Double?
    let avgHr: Double?
    let maxHr: Double?
    let kcal: Double?
    let paceSPerKm: Double?
    let metadata: [String: String]?  // raw per-interval HKWorkoutActivity / HKWorkoutEvent metadata

    func toDict() -> [String: Any] {
        var d: [String: Any] = [
            "n": n,
            "kind": kind,
            "start": start,
            "end": end,
            "duration_s": durationS,
        ]
        if let v = name { d["name"] = v }
        if let v = activityType { d["activity_type"] = v }
        if let v = activityName { d["activity_name"] = v }
        if let v = distanceM { d["distance_m"] = v }
        if let v = avgHr { d["avg_hr"] = v }
        if let v = maxHr { d["max_hr"] = v }
        if let v = kcal { d["kcal"] = v }
        if let v = paceSPerKm { d["pace_s_per_km"] = v }
        if let v = metadata, !v.isEmpty { d["metadata"] = v }
        return d
    }
}

/// Un punto giornaliero di `HKStatisticsCollectionQuery`. La data e' il
/// midnight locale del bucket; il valore e' il totale aggregato HK.
struct DailyStatPoint {
    let date: Date
    let value: Double
}

struct WorkoutPayload {
    let uuid: String
    let activityType: Int
    let activityName: String?
    let duration: Double?
    let totalEnergyBurned: Double?
    let totalDistance: Double?
    let startDate: String
    let endDate: String
    let sourceName: String?
    let metadata: [String: String]?
    let title: String?
    let activities: [WorkoutActivityPayload]?
}

actor APIClient {
    private let session: URLSession
    private let dateFormatter: ISO8601DateFormatter

    var serverURL: String {
        UserDefaults.standard.string(forKey: Constants.serverURLKey) ?? Constants.defaultServerURL
    }

    var deviceID: String {
        if let id = UserDefaults.standard.string(forKey: Constants.deviceIDKey) {
            return id
        }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: Constants.deviceIDKey)
        return id
    }

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
        self.dateFormatter = ISO8601DateFormatter()
        self.dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func postSamples(_ samples: [SamplePayload]) async throws -> BatchResult {
        let body: [String: Any] = [
            "device_id": deviceID,
            "samples": samples.map { s in
                var dict: [String: Any] = [
                    "uuid": s.uuid,
                    "type": s.type,
                    "value": s.value,
                    "unit": s.unit,
                    "start_date": s.startDate,
                    "end_date": s.endDate,
                ]
                if let v = s.sourceName { dict["source_name"] = v }
                if let v = s.sourceBundleId { dict["source_bundle_id"] = v }
                if let v = s.device { dict["device"] = v }
                if let v = s.metadata { dict["metadata"] = v }
                return dict
            }
        ]
        return try await post(path: "/api/v1/samples/batch", body: body)
    }

    func postCategories(_ samples: [CategoryPayload]) async throws -> BatchResult {
        let body: [String: Any] = [
            "device_id": deviceID,
            "samples": samples.map { s in
                var dict: [String: Any] = [
                    "uuid": s.uuid,
                    "type": s.type,
                    "value": s.value,
                    "start_date": s.startDate,
                    "end_date": s.endDate,
                ]
                if let v = s.sourceName { dict["source_name"] = v }
                if let v = s.sourceBundleId { dict["source_bundle_id"] = v }
                if let v = s.metadata { dict["metadata"] = v }
                return dict
            }
        ]
        return try await post(path: "/api/v1/categories/batch", body: body)
    }

    func postWorkouts(_ workouts: [WorkoutPayload]) async throws -> BatchResult {
        let body: [String: Any] = [
            "device_id": deviceID,
            "workouts": workouts.map { w in
                var dict: [String: Any] = [
                    "uuid": w.uuid,
                    "start_date": w.startDate,
                    "end_date": w.endDate,
                    "activity_type": w.activityType,
                ]
                if let v = w.activityName { dict["activity_name"] = v }
                if let v = w.duration { dict["duration"] = v }
                if let v = w.totalEnergyBurned { dict["total_energy_burned"] = v }
                if let v = w.totalDistance { dict["total_distance"] = v }
                if let v = w.sourceName { dict["source_name"] = v }
                if let v = w.metadata { dict["metadata"] = v }
                if let v = w.title { dict["title"] = v }
                if let acts = w.activities, !acts.isEmpty {
                    dict["activities"] = acts.map { $0.toDict() }
                }
                return dict
            }
        ]
        return try await post(path: "/api/v1/workouts/batch", body: body)
    }

    // MARK: - Pending writes (web app -> HealthKit)

    struct PendingWrite: Codable {
        let id: Int
        let type: String
        let value: Double
        let unit: String
        let startDate: String
        let endDate: String
        let sourceName: String?
        let notes: String?
        let status: String

        enum CodingKeys: String, CodingKey {
            case id, type, value, unit
            case startDate = "start_date"
            case endDate = "end_date"
            case sourceName = "source_name"
            case notes, status
        }
    }

    func fetchPendingWrites() async throws -> [PendingWrite] {
        guard let url = URL(string: "\(serverURL)/api/v1/write/pending") else {
            throw APIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError.serverError(statusCode: statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode([PendingWrite].self, from: data)
    }

    func confirmWrite(id: Int, hkUuid: UUID) async throws {
        let body: [String: Any] = ["hk_uuid": hkUuid.uuidString]
        let _: PendingWrite = try await post(path: "/api/v1/write/\(id)/confirm", body: body)
    }

    func failWrite(id: Int, error: String) async throws {
        let body: [String: Any] = ["error": error]
        let _: PendingWrite = try await post(path: "/api/v1/write/\(id)/fail", body: body)
    }

    // MARK: - Pending deletions

    struct PendingDeletion: Codable {
        let id: Int
        let hkUuid: String
        let type: String
        let status: String

        enum CodingKeys: String, CodingKey {
            case id
            case hkUuid = "hk_uuid"
            case type, status
        }
    }

    func fetchPendingDeletions() async throws -> [PendingDeletion] {
        guard let url = URL(string: "\(serverURL)/api/v1/delete/pending?limit=500") else {
            throw APIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError.serverError(statusCode: code, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode([PendingDeletion].self, from: data)
    }

    func confirmDeletion(id: Int) async throws {
        let body: [String: Any] = [:]
        let _: PendingDeletion = try await post(path: "/api/v1/delete/\(id)/confirm", body: body)
    }

    func failDeletion(id: Int, error: String) async throws {
        let body: [String: Any] = ["error": error]
        let _: PendingDeletion = try await post(path: "/api/v1/delete/\(id)/fail", body: body)
    }

    /// Tells the backend to delete the given workout UUIDs (matching HKWorkouts
    /// that the user deleted on Apple Health). The PG trigger will add them to
    /// the ingest blacklist automatically.
    func deleteWorkouts(uuids: [UUID]) async throws -> Int {
        if uuids.isEmpty { return 0 }
        struct Resp: Decodable { let deleted: Int }
        let body: [String: Any] = ["uuids": uuids.map { $0.uuidString }]
        let resp: Resp = try await post(path: "/api/v1/workouts/bulk-delete", body: body)
        return resp.deleted
    }

    /// Deletes health samples by UUID (used by the anchored quantity sync path
    /// to propagate Apple Health deletions for body-metric types). The PG
    /// trigger on health_samples auto-populates the ingest blacklist.
    func deleteSamples(uuids: [UUID]) async throws -> Int {
        if uuids.isEmpty { return 0 }
        struct Resp: Decodable { let deleted: Int }
        let body: [String: Any] = ["uuids": uuids.map { $0.uuidString }]
        let resp: Resp = try await post(path: "/api/v1/samples/bulk-delete-by-uuids", body: body)
        return resp.deleted
    }

    /// Upsert dei totali giornalieri pre-calcolati da HKStatisticsCollectionQuery
    /// nella tabella backend `daily_stats`. Idempotente.
    func postDailyStats(type: String, points: [(date: String, value: Double)]) async throws -> Int {
        if points.isEmpty { return 0 }
        struct Resp: Decodable { let upserted: Int }
        let body: [String: Any] = [
            "items": points.map { ["type": type, "date": $0.date, "value": $0.value] }
        ]
        let resp: Resp = try await post(path: "/api/v1/daily-stats/batch", body: body)
        return resp.upserted
    }

    func checkConnection() async -> Bool {
        guard let url = URL(string: "\(serverURL)/health") else { return false }
        do {
            let (_, response) = try await session.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func post<T: Decodable>(path: String, body: [String: Any]) async throws -> T {
        guard let url = URL(string: "\(serverURL)\(path)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        // Retry up to 3 times with exponential backoff for transient errors
        let maxAttempts = 3
        var lastError: Error?

        for attempt in 1...maxAttempts {
            do {
                let (data, response) = try await session.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
                    let bodyStr = String(data: data, encoding: .utf8) ?? ""
                    // 5xx errors are retryable, 4xx are not
                    if statusCode >= 500 && attempt < maxAttempts {
                        try await Task.sleep(for: .seconds(Double(attempt * 2)))
                        continue
                    }
                    throw APIError.serverError(statusCode: statusCode, body: bodyStr)
                }

                let decoder = JSONDecoder()
                return try decoder.decode(T.self, from: data)
            } catch let error as URLError {
                lastError = error
                // Retryable network errors
                let retryableCodes: [URLError.Code] = [
                    .networkConnectionLost, .timedOut, .notConnectedToInternet,
                    .cannotConnectToHost, .dataNotAllowed
                ]
                if retryableCodes.contains(error.code) && attempt < maxAttempts {
                    try await Task.sleep(for: .seconds(Double(attempt * 2)))
                    continue
                }
                throw error
            } catch {
                throw error
            }
        }

        throw lastError ?? APIError.invalidURL
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case serverError(statusCode: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .serverError(let code, let body):
            return "Server error \(code): \(body)"
        }
    }
}
