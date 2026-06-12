import SwiftUI

struct SettingsView: View {
    @AppStorage(Constants.serverURLKey) private var serverURL = Constants.defaultServerURL
    @Environment(SyncService.self) private var syncService
    @State private var editingURL: String = ""
    @State private var showSaved = false
    @State private var reimportStarted = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Manutenzione") {
                    Button("Re-importa segmenti workout") {
                        reimportStarted = true
                        Task { await syncService.reimportWorkoutSegments() }
                    }
                    .disabled(syncService.isSyncing)

                    if reimportStarted {
                        Text(syncService.isSyncing
                             ? "Re-import in corso… tieni l'app aperta"
                             : "Avviato. Ri-scarica tutti i workout e i loro segmenti.")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }

                Section("Server Configuration") {
                    TextField("Server URL", text: $editingURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    Button("Save") {
                        serverURL = editingURL
                        showSaved = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            showSaved = false
                        }
                    }

                    if showSaved {
                        Text("Saved!")
                            .foregroundStyle(.green)
                            .font(.caption)
                    }
                }

                Section("Info") {
                    HStack {
                        Text("Device ID")
                        Spacer()
                        let deviceId = UserDefaults.standard.string(forKey: Constants.deviceIDKey) ?? "Not set"
                        Text(String(deviceId.prefix(8)) + "...")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }

                    HStack {
                        Text("API Docs")
                        Spacer()
                        Text("\(serverURL)/docs")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                editingURL = serverURL
            }
        }
    }
}
