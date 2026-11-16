import CapystackKit
import Foundation

/// Every word the app shows, in one place (docs/CONTRACT.md section 11): lowercase, short and friendly, no emoji.
enum Copy {
    static let appName = "capystack"

    enum Tabs {
        static let notes = "notes"
        static let chat = "chat"
        static let settings = "settings"
    }

    enum SignIn {
        static let title = "capystack"
        static let line = "your notes, on every device. sign in with the owner's email to start."
        static let expiredLine = "you were signed out. sign in again to pick up where you left off."
        static let button = "sign in"
        static let again = "sign in again"
        static let working = "signing in"
    }

    enum Notes {
        static let title = "notes"
        static let new = "new note"
        static let untitled = "untitled"
        static let emptyTitle = "no notes yet"
        static let emptyLine = "write the first one. it saves on this device and syncs when you're online."
        static let titlePlaceholder = "title"
        static let bodyPlaceholder = "write something"
        static let delete = "delete note"
        static let deleteConfirm = "delete this note?"
        static let deleteLine = "it goes from every device."
        static let summarize = "summarize"
        static let summaryTitle = "summary"
        static let summaryWorking = "reading your note"
        static let syncing = "syncing"
        static func waiting(_ count: Int) -> String { count == 1 ? "1 change waiting to sync" : "\(count) changes waiting to sync" }
        static let offline = "offline. changes wait on this device."
        static let refresh = "sync now"
        static let missing = "this note is gone"
    }

    enum Chat {
        static let title = "chat"
        static let new = "new chat"
        static let untitled = "new chat"
        static let emptyTitle = "no chats yet"
        static let emptyLine = "ask about your notes. the assistant can read, write and tidy them for you."
        static let offTitle = "chat is off"
        static let offLine = "this server has no model key. add one and chat turns on."
        static let placeholder = "ask anything"
        static let send = "send"
        static let thinking = "thinking"
        static let threadEmpty = "say hello"
        static let failed = "that didn't send. try again."
    }

    enum Settings {
        static let title = "settings"
        static let account = "account"
        static let thisDevice = "this device"
        static let devices = "signed-in devices"
        static let signOutDevice = "sign out this device"
        static let signedOutDevice = "signed out"
        static let keys = "keys for tools"
        static let keysLine = "for mcp clients and scripts. a key works until you revoke it."
        static let newKey = "new key"
        static let keyName = "name"
        static let keyNamePlaceholder = "claude code"
        static let createKey = "create key"
        static let keyMadeTitle = "your new key"
        static let keyMadeLine = "copy it now. it won't be shown again."
        static let copy = "copy"
        static let copied = "copied"
        static let revoke = "revoke"
        static let revoked = "key revoked"
        static let noKeys = "no keys yet"
        static let demo = "live activity"
        static let demoLine = "starts a 20 second job on the server and shows it on the lock screen and in the island."
        static let demoStart = "start demo job"
        static let demoRunning = "running"
        static let demoDone = "done"
        static let demoFailed = "didn't finish"
        static let haptics = "haptics"
        static let gallery = "design gallery"
        static let about = "about"
        static let server = "server"
        static let version = "version"
        static let signOut = "sign out"
        static let signOutConfirm = "sign out of capystack?"
        static let signOutLine = "notes on this device are removed. they stay on the server."
        static let lastUsed = "last used"
        static let never = "never used"
    }

    enum Gallery {
        static let title = "design gallery"
        static let buttons = "buttons"
        static let primary = "primary"
        static let secondary = "secondary"
        static let ghost = "ghost"
        static let danger = "danger"
        static let icons = "icon buttons"
        static let rows = "list rows"
        static let rowTitle = "a list row"
        static let rowSubtitle = "with a quiet second line"
        static let empty = "empty state"
        static let skeleton = "skeleton"
        static let toast = "toast"
        static let showToast = "show a toast"
        static let toastText = "saved"
        static let field = "text field"
        static let fieldLabel = "label"
        static let fieldPlaceholder = "type here"
        static let signInCard = "sign-in card"
        static let colors = "colours"
        static let sheet = "sheet"
        static let openSheet = "open a sheet"
        static let sheetLine = "sheets close at the top right."
    }

    enum Common {
        static let close = "close"
        static let cancel = "cancel"
        static let done = "done"
        static let retry = "try again"
        static let loadFailed = "couldn't load this. pull to try again."
    }

    /// What to say about an error, or nil when there is nothing to say (a closed sheet).
    static func message(for error: any Error) -> String? {
        if let signIn = error as? SignInError {
            switch signIn {
            case .cancelled: return nil
            case .badCallback: return "sign-in didn't finish. try again."
            case .couldNotSave: return "couldn't keep you signed in on this device."
            case .failed(let api): return message(for: api)
            }
        }
        if let api = error as? APIError {
            switch api {
            case .signedOut: return "you're signed out. sign in again."
            case .network: return "you're offline. try again when you're connected."
            case .invalidResponse: return "the server sent something unexpected."
            case .server(let code, let status, _):
                if code == APIError.aiOff { return "ai is off on this server." }
                if status == 404 { return "that's gone." }
                if status == 429 { return "too many requests. wait a moment." }
                if status >= 500 { return "the server had a problem. try again." }
                return "that didn't work (\(code))."
            }
        }
        return "something went wrong."
    }

    /// "2 min ago", "yesterday".
    static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date()).lowercased()
    }
}
