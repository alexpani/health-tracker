import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            SyncStatusView()
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}
