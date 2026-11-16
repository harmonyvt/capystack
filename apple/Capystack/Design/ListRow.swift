import SwiftUI

/// One row of a list: an optional icon, a title, a quiet second line and something trailing.
struct ListRow<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    let trailing: Trailing

    init(_ title: String, subtitle: String? = nil, systemImage: String? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: Tokens.Space.s3) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Tokens.Color.accent)
                    .frame(width: 28, height: 28)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Tokens.Font.body)
                    .foregroundStyle(Tokens.Color.text)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Tokens.Font.caption)
                        .foregroundStyle(Tokens.Color.textMuted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Tokens.Space.s2)
            trailing
        }
        .padding(.vertical, Tokens.Space.s1)
        .contentShape(Rectangle())
    }
}

extension ListRow where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, systemImage: String? = nil) {
        self.init(title, subtitle: subtitle, systemImage: systemImage) { EmptyView() }
    }
}
