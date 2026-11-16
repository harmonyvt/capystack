import SwiftUI
#if os(iOS)
@preconcurrency import PostHog
#endif

extension View {
    /// Hides this view in session replays (docs/CONTRACT.md section 9). Every view that draws the owner's content wears
    /// it: note titles and text, chat messages, key tokens. A no-op on the Mac (PostHog has no Mac replay).
    @ViewBuilder
    func privacyMask() -> some View {
        #if os(iOS)
        self.postHogMask()
        #else
        self
        #endif
    }
}
