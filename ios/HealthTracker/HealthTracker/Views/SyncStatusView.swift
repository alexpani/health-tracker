import SwiftUI

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

                if !syncService.syncLog.isEmpty {
                    Section("Log") {
                        ForEach(syncService.syncLog, id: \.self) { entry in
                            Text(entry)
                                .font(.caption)
                                .foregroundStyle(.secondary)
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
