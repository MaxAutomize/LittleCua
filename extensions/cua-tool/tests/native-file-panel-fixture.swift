import AppKit
import Foundation

let app=NSApplication.shared
app.setActivationPolicy(.regular)
let panel=NSOpenPanel()
panel.title="Open"
panel.level = .modalPanel
panel.canChooseDirectories=false
panel.canChooseFiles=true
panel.allowsMultipleSelection=false
panel.directoryURL=URL(fileURLWithPath:NSTemporaryDirectory())
panel.begin { _ in app.terminate(nil) }
app.activate(ignoringOtherApps:true)
panel.makeKeyAndOrderFront(nil)
app.run()
