import SwiftUI

/// A placeholder block that breathes while something loads (skeletons instead of spinners). Still under Reduce Motion.
struct Skeleton: View {
    var width: CGFloat?
    var height: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous)
            .fill(Tokens.Color.surfaceRaised)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .opacity(dim ? 0.45 : 1)
            .onAppear { breathe() }
            .accessibilityHidden(true)
    }

    private func breathe() {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
    }
}

/// A few row-shaped skeletons: a list that is loading.
struct SkeletonList: View {
    var rows = 5

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            ForEach(0..<rows, id: \.self) { index in
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    Skeleton(width: index.isMultiple(of: 2) ? 180 : 140, height: 16)
                    Skeleton(height: 12)
                }
            }
        }
        .padding(Tokens.Space.s5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
