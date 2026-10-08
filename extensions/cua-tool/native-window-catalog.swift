import AppKit
import CoreGraphics
import Foundation

// Read-only supplement for real application panels omitted by the driver's
// layer-zero window list. Never synthesize IDs, traverse user documents, or
// treat menus/system overlays as normal windows.
let requestedPid = CommandLine.arguments.dropFirst().first.flatMap(Int.init)
let rows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
var windows: [[String: Any]] = []
for (index, row) in rows.enumerated() {
    guard let layer = row[kCGWindowLayer as String] as? Int, layer > 0,
          let pid = row[kCGWindowOwnerPID as String] as? Int,
          requestedPid == nil || requestedPid == pid,
          let app = NSRunningApplication(processIdentifier: pid_t(pid)),
          app.activationPolicy == .regular,
          let number = row[kCGWindowNumber as String] as? Int,
          let title = row[kCGWindowName as String] as? String, !title.isEmpty,
          let bounds = row[kCGWindowBounds as String] as? [String: Any],
          let x = bounds["X"] as? Double, let y = bounds["Y"] as? Double,
          let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
          width > 1, height > 1 else { continue }
    windows.append([
        "pid": pid, "window_id": number,
        "app_name": row[kCGWindowOwnerName as String] as? String ?? app.localizedName ?? "",
        "title": title, "layer": layer, "is_on_screen": true, "on_current_space": true,
        "bounds": ["x": x, "y": y, "width": width, "height": height],
        "z_index": rows.count - index, "catalog_source": "native-CG-elevated-panel"
    ])
}
let data = try JSONSerialization.data(withJSONObject: windows, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
