import Foundation
import EventKit

let store = EKEventStore()
let requestedLimit = Int(CommandLine.arguments.dropFirst().first ?? "100") ?? 100
let limit = max(1, min(100, requestedLimit))

func fail(_ message: String, code: Int32) -> Never {
    fputs(message + "\n", stderr)
    exit(code)
}

func requestPermission() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    if #available(macOS 14.0, *) {
        store.requestFullAccessToReminders { success, error in
            granted = success

            if let error = error {
                fputs("EVENTKIT_PERMISSION_ERROR: \(error)\n", stderr)
            }

            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .reminder) { success, error in
            granted = success

            if let error = error {
                fputs("EVENTKIT_PERMISSION_ERROR: \(error)\n", stderr)
            }

            semaphore.signal()
        }
    }

    if semaphore.wait(timeout: .now() + 10) == .timedOut {
        fail("EVENTKIT_PERMISSION_TIMEOUT", code: 4)
    }

    return granted
}

guard requestPermission() else {
    fail("REMINDERS_PERMISSION_DENIED", code: 2)
}

let predicate = store.predicateForReminders(in: nil)
let semaphore = DispatchSemaphore(value: 0)

var output: [[String: Any]] = []
var fetchFailed = false

store.fetchReminders(matching: predicate) { reminders in
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]

    let active = (reminders ?? [])
        .filter { !$0.isCompleted }
        .prefix(limit)

    output = active.map { reminder in
        var dueAt: Any = NSNull()

        if let components = reminder.dueDateComponents {
            let calendar = components.calendar ?? Calendar.current

            if let date = calendar.date(from: components) {
                dueAt = formatter.string(from: date)
            }
        }

        return [
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? "",
            "dueAt": dueAt,
            "completed": false
        ]
    }

    semaphore.signal()
}

if semaphore.wait(timeout: .now() + 5) == .timedOut {
    fetchFailed = true
}

if fetchFailed {
    fail("EVENTKIT_FETCH_TIMEOUT", code: 3)
}

do {
    let data = try JSONSerialization.data(withJSONObject: output, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("EVENTKIT_JSON_ERROR: \(error)", code: 5)
}
