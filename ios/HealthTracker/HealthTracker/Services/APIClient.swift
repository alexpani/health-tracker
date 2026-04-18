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

struct WorkoutPayload: Codable {
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

    enum CodingKeys: String, CodingKey {
        case uuid
        case activityType = "activity_type"
        case activityName = "activity_name"
        case duration
        case totalEnergyBurned = "total_energy_burned"
        case totalDistance = "total_distance"
        case startDate = "start_date"
        case endDate = "end_date"
        case sourceName = "source_name"
        case metadata
        case title
    }
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
