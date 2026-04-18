import SwiftUI

private func formatDuration(_ seconds: Double) -> String {
    let s = Int(seconds)
    let h = s / 3600
    let m = (s % 3600) / 60
    let sec = s % 60
    if h > 0 { return "\(h)h \(m)m \(sec)s" }
    if m > 0 { return "\(m)m \(sec)s" }
    return "\(sec)s"
}

struct SyncStatusView: View {
    @Environment(SyncService.self) private var syncService
    @State private var serverConnected = false
    @State private var checkingConnection = false

    var body: some View {
        NavigationStack {
            List {
                Section("Server") {
                    HStack {
                        Text("Status")
                        Spacer()
                        if checkingConnection {
                            ProgressView()
                        } else {
                            Text(serverConnected ? "Connected" : "Disconnected")
                                .foregroundStyle(serverConnected ? .green : .red)
                        }
                    }
                    Button("Check Connection") {
                        Task {
                            checkingConnection = true
                            serverConnected = await APIClient().checkConnection()
                            checkingConnection = false
                        }
                    }
                }

                Section("Sync") {
                    if syncService.isSyncing {
                        VStack(alignment: .leading, spacing: 10) {
                            // Overall progress (across types)
                            HStack {
                                Text("Generale")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(Int(syncService.progress * 100))%")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            ProgressView(value: syncService.progress)
                                .tint(.blue)

                            Divider()

                            // Type progress
                            HStack {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .foregroundStyle(.blue)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(syncService.currentType)
                                        .font(.subheadline.weight(.medium))
                                    if let windowDate = syncService.currentWindowDate {
                                        Text("Arrivato a: \(windowDate.formatted(.dateTime.day().month().year()))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .monospacedDigit()
                                    }
                                }
                                Spacer()
                                Text("\(Int(syncService.typeProgress * 100))%")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            ProgressView(value: syncService.typeProgress)
                                .tint(.green)

                            Divider()

                            HStack {
                                Text("Campioni inviati")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(syncService.totalSamplesSynced.formatted())
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }

                            Button(role: .destructive) {
                                syncService.requestStop()
                            } label: {
                                Label("Ferma sync", systemImage: "stop.circle.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .padding(.top, 4)
                        }
                    } else {
                        Button("Sync Now") {
                            Task {
                                await syncService.performFullSync()
                            }
                        }
                    }

                    if let lastSync = syncService.lastSyncDate {
                        HStack {
                            Text("Ultima sync")
                            Spacer()
                            Text(lastSync, style: .relative)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let error = syncService.lastError {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }

                if syncService.isSyncing {
                    // Live log during an active sync
                    if !syncService.syncLog.isEmpty {
                        Section("Attivita'") {
                            ForEach(syncService.syncLog, id: \.self) { entry in
                                Text(entry)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    // Persistent summary of the last completed sync
                    if syncService.lastSyncLog.isEmpty && syncService.lastSyncDate == nil {
                        Section("Ultima sync") {
                            Text("Nessuna sync effettuata in questa sessione.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Section("Ultima sync") {
                            if syncService.lastSyncWasInterrupted {
                                HStack {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundStyle(.orange)
                                    Text("Interrotta")
                                        .foregroundStyle(.orange)
                                }
                            }
                            if let started = syncService.lastSyncStartedAt {
                                HStack {
                                    Text("Iniziata")
                                    Spacer()
                                    Text(started, format: .dateTime.day().month().year().hour().minute())
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                            if let duration = syncService.lastSyncDurationSeconds {
                                HStack {
                                    Text("Durata")
                                    Spacer()
                                    Text(formatDuration(duration))
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                            HStack {
                                Text("Campioni inviati")
                                Spacer()
                                Text(syncService.lastSyncTotalSamples.formatted())
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }

                        if !syncService.lastSyncLog.isEmpty {
                            Section("Log ultima sync") {
                                ForEach(syncService.lastSyncLog, id: \.self) { entry in
                                    Text(entry)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Sync")
            .task {
                checkingConnection = true
                serverConnected = await APIClient().checkConnection()
                checkingConnection = false
            }
        }
    }
}
