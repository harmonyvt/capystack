import CapystackKit
import SwiftUI

/// iPad and Mac: a sidebar of areas beside the selected area's screen.
struct SidebarShell: View {
    let model: AppModel
    @Binding var selection: AppTab
    @State private var picked: AppTab?

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            TabScreen(model: model, tab: selection)
        }
        .onAppear { picked = selection }
        .onChange(of: picked) { _, new in
            if let new { selection = new }
        }
        .onChange(of: selection) { _, new in
            if picked != new { picked = new }
        }
    }

    private var sidebar: some View {
        List(AppTab.allCases, selection: $picked) { tab in
            Label(tab.title, systemImage: tab.symbol)
                .font(Tokens.Font.body)
        }
        .navigationTitle(Copy.appName)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
    }
}
