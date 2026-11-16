import SwiftUI
import WidgetKit

/// The widget extension's entry point: no home-screen widgets, one Live Activity (the demo job).
@main
struct CapystackWidgetsBundle: WidgetBundle {
    var body: some Widget {
        JobLiveActivity()
    }
}
