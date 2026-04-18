import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            SyncStatusView()
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }

            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "heart.text.square")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}
