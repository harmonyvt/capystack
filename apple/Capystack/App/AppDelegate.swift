import CapystackKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Where the system's push callbacks reach the model (the delegate is made by SwiftUI before any scene).
@MainActor
enum PushBridge {
    static weak var model: AppModel?

    /// Asks for an APNs device token when signed in on a server that pushes. Silent (`content-available`) pushes need
    /// no permission prompt.
    static func registerIfWanted(_ model: AppModel) {
        guard model.wantsRemoteNotifications else { return }
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #else
        NSApplication.shared.registerForRemoteNotifications()
        #endif
    }
}

#if os(iOS)
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushBridge.model?.registerDeviceToken(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // No push on this build (simulator without a team, no entitlement): sync still runs on foreground.
    }

    /// A `device` push after a write from another device: pull now (docs/CONTRACT.md section 5).
    func application(
        _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task {
            await PushBridge.model?.remoteNotification()
            completionHandler(.newData)
        }
    }
}
#else
final class AppDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushBridge.model?.registerDeviceToken(deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {}

    func application(_ application: NSApplication, didReceiveRemoteNotification userInfo: [String: Any]) {
        Task { await PushBridge.model?.remoteNotification() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
#endif
