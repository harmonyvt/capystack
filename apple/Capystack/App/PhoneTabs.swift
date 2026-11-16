import CapystackKit
import SwiftUI

/// iPhone: a bottom tab bar, one tab per area.
struct PhoneTabs: View {
    let model: AppModel
    @Binding var selection: AppTab

    var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.symbol, value: tab) {
                    TabScreen(model: model, tab: tab)
                }
            }
        }
        .haptic(.selection, trigger: selection)
    }
}
