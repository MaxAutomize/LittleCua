import Cocoa
import Darwin

private let processID = Int(getpid())
private var oraclePath: String?
private var fixtureControllers: [FixtureWindowController] = []

private func jsonString(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return "{}" }
    return text
}

private func writeOracle() {
    guard let oraclePath else { return }
    let payload: [String: Any] = [
        "version": 2,
        "pid": processID,
        "source": "LittleCua self-owned AppKit fixture state mirror",
        "windows": fixtureControllers.map { $0.oracleState() },
    ]
    try? jsonString(payload).data(using: .utf8)?.write(to: URL(fileURLWithPath: oraclePath), options: .atomic)
}

final class FixtureTextField: NSTextField {
    var onFixtureValueChange: (() -> Void)?

    override func accessibilitySetValue(_ value: Any?, forAttribute attribute: NSAccessibility.Attribute) {
        super.accessibilitySetValue(value, forAttribute: attribute)
        onFixtureValueChange?()
    }
}

final class FixtureTable: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    private let rows = ["Fixture Increment", "Fixture Ambiguous", "Fixture Ambiguous"]
    private let onIncrement: () -> Void

    init(onIncrement: @escaping () -> Void) { self.onIncrement = onIncrement }
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let text = NSTextField(labelWithString: rows[row])
        text.lineBreakMode = .byTruncatingTail
        return text
    }
    func tableViewSelectionDidChange(_ notification: Notification) {
        guard let table = notification.object as? NSTableView else { return }
        if table.selectedRow == 0 {
            onIncrement()
            table.deselectAll(nil)
        }
    }
}

final class FixtureWindowController: NSObject {
    let window: NSWindow
    let fixtureTitle: String
    private let counterLabel = NSTextField(labelWithString: "Counter: 0")
    private let statusLabel = NSTextField(labelWithString: "Fixture status: Ready")
    private let submitCountLabel = NSTextField(labelWithString: "Submit count: 0")
    private let nameField: FixtureTextField
    private let notesField: FixtureTextField
    private var cellFields: [[FixtureTextField]] = []
    private var count = 0
    private var submitCount = 0
    private var tableData: FixtureTable!
    private var jitterTimer: Timer?
    private var jitterOffset = false

    init(title: String, origin: NSPoint, jitter: Bool, armPath: String?) {
        fixtureTitle = title
        nameField = FixtureTextField(string: "\(title) initial name")
        notesField = FixtureTextField(string: "\(title) initial notes")
        window = NSWindow(
            contentRect: NSRect(x: origin.x, y: origin.y, width: 680, height: 760),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        super.init()
        window.title = title
        window.identifier = NSUserInterfaceItemIdentifier("littlecua-fixture-\(title)")
        window.isReleasedWhenClosed = false
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 680, height: 760))
        root.autoresizingMask = [.width, .height]
        window.contentView = root

        let heading = NSTextField(labelWithString: title)
        heading.font = .boldSystemFont(ofSize: 16)
        heading.frame = NSRect(x: 24, y: 716, width: 600, height: 24)
        root.addSubview(heading)

        counterLabel.frame = NSRect(x: 24, y: 682, width: 600, height: 22)
        counterLabel.identifier = NSUserInterfaceItemIdentifier("fixture-counter")
        counterLabel.setAccessibilityLabel("Fixture counter")
        root.addSubview(counterLabel)

        statusLabel.frame = NSRect(x: 24, y: 650, width: 620, height: 22)
        statusLabel.identifier = NSUserInterfaceItemIdentifier("fixture-status")
        statusLabel.setAccessibilityLabel("Fixture status")
        root.addSubview(statusLabel)

        submitCountLabel.frame = NSRect(x: 24, y: 618, width: 620, height: 22)
        submitCountLabel.identifier = NSUserInterfaceItemIdentifier("fixture-submit-count")
        submitCountLabel.setAccessibilityLabel("Fixture submits")
        root.addSubview(submitCountLabel)

        // A native NSTableView exposes unpressable AXRow/static-text content.
        // Selecting its first row changes the observable counter.
        let table = NSTableView(frame: NSRect(x: 0, y: 0, width: 620, height: 108))
        let tableColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("fixture-action-table-column"))
        tableColumn.width = 620
        table.addTableColumn(tableColumn)
        table.headerView = nil
        table.rowHeight = 30
        table.intercellSpacing = NSSize(width: 0, height: 3)
        table.allowsEmptySelection = true
        tableData = FixtureTable { [weak self] in
            guard let self else { return }
            self.count += 1
            self.counterLabel.stringValue = "Counter: \(self.count)"
            writeOracle()
        }
        table.dataSource = tableData
        table.delegate = tableData
        let scroll = NSScrollView(frame: NSRect(x: 24, y: 522, width: 620, height: 112))
        scroll.hasVerticalScroller = false
        scroll.borderType = .bezelBorder
        scroll.documentView = table
        root.addSubview(scroll)

        let gridHeading = NSTextField(labelWithString: "Spreadsheet-like grid (editable cells)")
        gridHeading.frame = NSRect(x: 24, y: 486, width: 500, height: 22)
        root.addSubview(gridHeading)

        let columns = ["A", "B", "C", "D"]
        let columnX = [24, 180, 336, 492]
        for (columnIndex, column) in columns.enumerated() {
            let header = NSTextField(labelWithString: column)
            header.alignment = .center
            header.frame = NSRect(x: columnX[columnIndex], y: 452, width: 140, height: 22)
            root.addSubview(header)
        }

        let initial: [[String]] = [
            ["\(title)-old-A1", "\(title)-old-B1", "\(title)-old-C1", "\(title)-old-D1"],
            ["\(title)-old-A2", "\(title)-old-B2", "\(title)-old-C2", "\(title)-old-D2"],
            ["\(title)-old-A3", "\(title)-old-B3", "\(title)-old-C3", "\(title)-old-D3"],
        ]
        for rowIndex in 0..<3 {
            var fields: [FixtureTextField] = []
            for columnIndex in 0..<4 {
                let field = FixtureTextField(string: initial[rowIndex][columnIndex])
                field.onFixtureValueChange = { writeOracle() }
                NotificationCenter.default.addObserver(forName: NSControl.textDidChangeNotification, object: field, queue: .main) { _ in writeOracle() }
                field.frame = NSRect(x: columnX[columnIndex], y: 410 - rowIndex * 48, width: 140, height: 32)
                field.identifier = NSUserInterfaceItemIdentifier("fixture-cell-\(columns[columnIndex])\(rowIndex + 1)")
                field.setAccessibilityLabel("Grid \(columns[columnIndex])\(rowIndex + 1)")
                field.isEditable = true
                field.isSelectable = true
                fields.append(field)
                root.addSubview(field)
            }
            cellFields.append(fields)
        }
        let orderedFields = cellFields.flatMap { $0 }
        for index in 0..<orderedFields.count {
            orderedFields[index].nextKeyView = index + 1 < orderedFields.count ? orderedFields[index + 1] : nameField
        }

        let formHeading = NSTextField(labelWithString: "Native form")
        formHeading.frame = NSRect(x: 24, y: 298, width: 300, height: 22)
        root.addSubview(formHeading)

        nameField.onFixtureValueChange = { writeOracle() }
        NotificationCenter.default.addObserver(forName: NSControl.textDidChangeNotification, object: nameField, queue: .main) { _ in writeOracle() }
        nameField.frame = NSRect(x: 150, y: 258, width: 494, height: 32)
        nameField.identifier = NSUserInterfaceItemIdentifier("fixture-name")
        nameField.setAccessibilityLabel("Fixture Name")
        nameField.isEditable = true
        root.addSubview(nameField)
        let nameLabel = NSTextField(labelWithString: "Name")
        nameLabel.frame = NSRect(x: 24, y: 263, width: 110, height: 22)
        root.addSubview(nameLabel)

        notesField.onFixtureValueChange = { writeOracle() }
        NotificationCenter.default.addObserver(forName: NSControl.textDidChangeNotification, object: notesField, queue: .main) { _ in writeOracle() }
        notesField.frame = NSRect(x: 150, y: 214, width: 494, height: 32)
        notesField.identifier = NSUserInterfaceItemIdentifier("fixture-notes")
        notesField.setAccessibilityLabel("Fixture Notes")
        notesField.isEditable = true
        root.addSubview(notesField)
        let notesLabel = NSTextField(labelWithString: "Notes")
        notesLabel.frame = NSRect(x: 24, y: 219, width: 110, height: 22)
        root.addSubview(notesLabel)

        let submit = NSButton(title: "Fixture Submit", target: self, action: #selector(submitForm))
        submit.frame = NSRect(x: 24, y: 164, width: 180, height: 32)
        submit.identifier = NSUserInterfaceItemIdentifier("fixture-submit")
        submit.setAccessibilityLabel("Fixture Submit")
        submit.bezelStyle = .rounded
        root.addSubview(submit)

        let commit = NSButton(title: "Fixture Commit Check", target: self, action: #selector(commitCheck))
        commit.frame = NSRect(x: 224, y: 164, width: 220, height: 32)
        commit.identifier = NSUserInterfaceItemIdentifier("fixture-commit")
        commit.setAccessibilityLabel("Fixture Commit Check")
        commit.bezelStyle = .rounded
        root.addSubview(commit)

        let disabled = NSButton(title: "Fixture Disabled", target: nil, action: nil)
        disabled.frame = NSRect(x: 24, y: 116, width: 420, height: 30)
        disabled.identifier = NSUserInterfaceItemIdentifier("fixture-disabled")
        disabled.setAccessibilityLabel("Fixture Disabled")
        disabled.isEnabled = false
        root.addSubview(disabled)

        window.makeKeyAndOrderFront(nil)
        if jitter, let armPath {
            // The test creates this private arm file immediately before a mouse
            // route. Move once after grounding starts to prove fail-before-dispatch.
            jitterTimer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] timer in
                guard let self, FileManager.default.fileExists(atPath: armPath) else { return }
                timer.invalidate()
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(350)) {
                    self.window.setFrameOrigin(NSPoint(x: origin.x + 12, y: origin.y))
                }
            }
        }
    }

    @objc private func submitForm() {
        submitCount += 1
        submitCountLabel.stringValue = "Submit count: \(submitCount)"
        statusLabel.stringValue = "Fixture status: Submitted \(nameField.stringValue) | \(notesField.stringValue)"
        writeOracle()
    }

    @objc private func commitCheck() {
        statusLabel.stringValue = "Fixture status: Commit check \(nameField.stringValue)"
        writeOracle()
    }

    func oracleState() -> [String: Any] {
        [
            "title": fixtureTitle,
            "pid": processID,
            "counter": count,
            "submitCount": submitCount,
            "cells": cellFields.enumerated().reduce(into: [String: String]()) { result, row in
                let columns = ["A", "B", "C", "D"]
                for (columnIndex, field) in row.element.enumerated() { result["\(columns[columnIndex])\(row.offset + 1)"] = field.stringValue }
            },
            "fields": ["name": nameField.stringValue, "notes": notesField.stringValue],
            "status": statusLabel.stringValue,
        ]
    }
}

let arguments = CommandLine.arguments
let jitter = arguments.contains("--jitter")
let oraclePathArgument = arguments.firstIndex(of: "--oracle-path").flatMap { index in
    arguments.indices.contains(index + 1) ? arguments[index + 1] : nil
}
oraclePath = oraclePathArgument
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let first = FixtureWindowController(title: "LittleCua Fixture A", origin: NSPoint(x: 18, y: 38), jitter: jitter, armPath: arguments.firstIndex(of: "--arm-path").flatMap { index in arguments.indices.contains(index + 1) ? arguments[index + 1] : nil })
let second = FixtureWindowController(title: "LittleCua Fixture B", origin: NSPoint(x: 710, y: 38), jitter: false, armPath: nil)
fixtureControllers = [first, second]
writeOracle()
app.activate(ignoringOtherApps: true)
app.run()
