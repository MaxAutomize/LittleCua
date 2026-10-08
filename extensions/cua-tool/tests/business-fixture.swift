import Cocoa
import Darwin

private let processID = Int(getpid())
private var oraclePath: String?
private var businessController: BusinessWindowController?

private func jsonText(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return "{}" }
    return text
}

private func writeOracle() {
    guard let oraclePath, let businessController else { return }
    let payload: [String: Any] = [
        "version": 1,
        "pid": processID,
        "source": "LittleCua self-owned business workflow oracle",
        "variation": businessController.variation.number,
        "targetRecord": businessController.variation.targetID,
        "expected": businessController.variation.expectedPayload(),
        "initialRecords": businessController.initialRecordStates(),
        "state": businessController.oracleState(),
        "events": businessController.events,
    ]
    try? jsonText(payload).data(using: .utf8)?.write(to: URL(fileURLWithPath: oraclePath), options: .atomic)
}

struct ShippingOption {
    let name: String
    let price: Int
    let eta: String
    let eligibility: String
    let eligible: Bool

    func display() -> String {
        "\(name) · $\(price) · \(eta) · \(eligibility)"
    }
}

struct BusinessVariation {
    let number: Int
    let project: String
    let requester: String
    let cycle: String
    let deadline: String
    let budget: Int
    let signatureRequired: Bool
    let dockRequired: Bool
    let targetID: String
    let targetDelivery: [String: String]
    let targetQuantities: [String: Int]
    let targetShipping: String
    let options: [ShippingOption]
    let recordOrder: [String]

    func expectedPayload() -> [String: Any] {
        [
            "delivery": targetDelivery,
            "quantities": targetQuantities,
            "shipping": targetShipping,
            "billing": "unchanged",
        ]
    }
}

final class BusinessRecord {
    let id: String
    let project: String
    let requester: String
    let cycle: String
    let status: String
    let direction: String
    let type: String
    let summary: String
    let isTarget: Bool
    let initialDelivery: [String: String]
    let initialQuantities: [String: Int]
    let initialBilling: String
    var delivery: [String: String]
    var quantities: [String: Int]
    var shipping: String?
    var billing: String

    init(id: String, project: String, requester: String, cycle: String, status: String, direction: String, type: String, summary: String, isTarget: Bool, delivery: [String: String], quantities: [String: Int], billing: String) {
        self.id = id
        self.project = project
        self.requester = requester
        self.cycle = cycle
        self.status = status
        self.direction = direction
        self.type = type
        self.summary = summary
        self.isTarget = isTarget
        self.initialDelivery = delivery
        self.initialQuantities = quantities
        self.initialBilling = billing
        self.delivery = delivery
        self.quantities = quantities
        self.billing = billing
    }

    func oracleState() -> [String: Any] {
        [
            "id": id,
            "project": project,
            "requester": requester,
            "cycle": cycle,
            "status": status,
            "direction": direction,
            "type": type,
            "delivery": delivery,
            "quantities": quantities,
            "shipping": shipping ?? "",
            "billing": billing,
        ]
    }

    func unchangedState() -> [String: Any] {
        [
            "id": id,
            "delivery": initialDelivery,
            "quantities": initialQuantities,
            "shipping": "",
            "billing": initialBilling,
        ]
    }
}

final class BusinessTextField: NSTextField {
    var onFixtureValueChange: (() -> Void)?

    override func accessibilitySetValue(_ value: Any?, forAttribute attribute: NSAccessibility.Attribute) {
        super.accessibilitySetValue(value, forAttribute: attribute)
        onFixtureValueChange?()
    }
}

final class BusinessWindowController: NSObject {
    let variation: BusinessVariation
    let window: NSWindow
    var events: [[String: Any]] = []
    private var records: [BusinessRecord]
    private var selectedRecord: BusinessRecord?
    private var stage = "inbox"
    private var generation = 0
    private var validationAttempts = 0
    private var validationErrors = 0
    private var ambiguousAttempts = 0
    private var incorrectRecordSelections = 0
    private var saveCount = 0
    private var reviewAcknowledged = false
    private var totalsReady = false
    private var deliveryShipping: String?
    private var dockAppointmentRequired = false
    private var deliveryVerified = false
    private var shippingReviewed = false
    private var currentFields: [String: BusinessTextField] = [:]
    private var currentButtons: [String: NSButton] = [:]
    private var currentRadioButtons: [String: NSButton] = [:]
    private var validationLabel: NSTextField?
    private var lastFieldEvent: String?
    private var root: NSView

    init(variation: BusinessVariation) {
        self.variation = variation
        self.records = BusinessWindowController.makeRecords(variation)
        self.window = NSWindow(contentRect: NSRect(x: 130, y: 42, width: 1120, height: 790), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        self.root = NSView(frame: NSRect(x: 0, y: 0, width: 1120, height: 790))
        super.init()
        window.title = "Task Review · \(variation.project) · Variation \(variation.number)"
        window.identifier = NSUserInterfaceItemIdentifier("business-workflow-fixture")
        window.isReleasedWhenClosed = false
        root.autoresizingMask = [.width, .height]
        window.contentView = root
        window.makeKeyAndOrderFront(nil)
        showInbox()
    }

    static func makeVariation(_ number: Int) -> BusinessVariation {
        let n = max(1, min(3, number))
        if n == 1 {
            return BusinessVariation(
                number: 1, project: "Northstar Lab", requester: "Maya Chen", cycle: "Cycle 2026-Q3", deadline: "Friday 2026-09-18", budget: 24, signatureRequired: false, dockRequired: true, targetID: "EQ-NS-2741",
                targetDelivery: ["recipient": "Maya Chen", "street": "700 Orbit Way", "city": "San Mateo", "region": "CA", "postal": "94401", "contact": "receiving@northstar.test", "instructions": "Dock B before 16:00", "dockCode": "NS-B-16"],
                targetQuantities: ["Sensor kit": 4, "Cable pack": 2, "Mount bracket": 1, "Spare fuse": 3, "Label roll": 2, "Glove pair": 6, "Battery pack": 5, "Tamper seal": 4], targetShipping: "Ground",
                options: [ShippingOption(name: "Ground", price: 14, eta: "3–5 business days", eligibility: "eligible under $24; arrives by Friday", eligible: true), ShippingOption(name: "Two-Day", price: 22, eta: "2 business days", eligibility: "eligible but not lowest cost", eligible: true), ShippingOption(name: "Overnight", price: 72, eta: "1 business day", eligibility: "restricted for this request", eligible: false), ShippingOption(name: "Freight", price: 35, eta: "7 business days", eligibility: "misses deadline", eligible: false)], recordOrder: ["EQ-NS-2741", "EQ-NS-2688", "SR-NS-9012", "EQ-OR-1180", "RT-NS-3304", "EQ-NS-2710"]
            )
        }
        if n == 2 {
            return BusinessVariation(
                number: 2, project: "Orion Field Ops", requester: "Rafael Ortiz", cycle: "Cycle 2026-Q4", deadline: "Thursday 2026-09-17", budget: 40, signatureRequired: true, dockRequired: false, targetID: "EQ-OR-4118",
                targetDelivery: ["recipient": "Rafael Ortiz", "street": "18 Meridian Road", "city": "Boulder", "region": "CO", "postal": "80301", "contact": "field-desk@orion.test", "instructions": "Signature at field desk", "dockCode": "OLD-00"],
                targetQuantities: ["Thermal probe": 2, "Battery case": 5, "Tripod": 1, "Adapter": 4, "Weather sleeve": 3, "Safety tag": 2, "Cable gland": 3, "Route card": 1], targetShipping: "Two-Day",
                options: [ShippingOption(name: "Ground", price: 18, eta: "5–7 business days", eligibility: "misses Thursday deadline", eligible: false), ShippingOption(name: "Two-Day", price: 31, eta: "2 business days", eligibility: "eligible under $40; meets deadline", eligible: true), ShippingOption(name: "Overnight", price: 65, eta: "1 business day", eligibility: "eligible but exceeds budget", eligible: false), ShippingOption(name: "Courier", price: 39, eta: "same day", eligibility: "eligible only with local dispatch", eligible: true)], recordOrder: ["SR-OR-5200", "EQ-NS-2741", "EQ-OR-4118", "EQ-OR-4099", "RT-OR-7001", "EQ-OR-4140"]
            )
        }
        return BusinessVariation(
            number: 3, project: "Cedar Systems", requester: "Priya Nair", cycle: "Cycle 2027-Q1", deadline: "Monday 2026-09-21", budget: 18, signatureRequired: false, dockRequired: true, targetID: "EQ-CD-8820",
            targetDelivery: ["recipient": "Priya Nair", "street": "55 Cedar Loop", "city": "Portland", "region": "OR", "postal": "97205", "contact": "lab-intake@cedar.test", "instructions": "Appointment at receiving dock", "dockCode": "CD-R-09"],
            targetQuantities: ["Optical head": 3, "Fiber lead": 3, "Clamp": 2, "Calibration card": 1, "Clean-room wipe": 8, "Seal ring": 4, "Lens cap": 5, "Ground strap": 2], targetShipping: "Ground",
            options: [ShippingOption(name: "Ground", price: 12, eta: "3–5 business days", eligibility: "eligible under $18; arrives by Monday", eligible: true), ShippingOption(name: "Two-Day", price: 19, eta: "2 business days", eligibility: "exceeds budget", eligible: false), ShippingOption(name: "Overnight", price: 55, eta: "1 business day", eligibility: "restricted", eligible: false), ShippingOption(name: "Freight", price: 16, eta: "6 business days", eligibility: "eligible by cost but misses deadline", eligible: false)], recordOrder: ["EQ-CD-8701", "EQ-CD-8820", "SR-CD-1102", "EQ-CD-8812", "RT-CD-7780", "EQ-NS-2741"]
        )
    }

    static func makeRecords(_ v: BusinessVariation) -> [BusinessRecord] {
        let target = BusinessRecord(id: v.targetID, project: v.project, requester: v.requester, cycle: v.cycle, status: "Approved", direction: "Inbound", type: "Equipment request", summary: "Current approved inbound equipment request for the active project and named requester.", isTarget: true, delivery: ["recipient": "Old Receiving", "street": "1 Archive Street", "city": "Oakland", "region": "CA", "postal": "00000", "contact": "old-desk@example.test", "instructions": "Replace delivery details", "dockCode": "OLD-00"], quantities: v.targetQuantities.mapValues { max(1, $0 - 1) }, billing: "Billing account ORIG-\(v.number) · unchanged")
        let decoys: [BusinessRecord] = [
            BusinessRecord(id: v.number == 1 ? "EQ-NS-2688" : v.number == 2 ? "EQ-OR-4099" : "EQ-CD-8701", project: v.project, requester: v.requester, cycle: "Previous cycle", status: "Approved", direction: "Inbound", type: "Equipment request", summary: "Similar requester and project, but archived previous-cycle approval.", isTarget: false, delivery: ["recipient": "Archive", "street": "9 Old Road", "city": "Oldtown", "region": "CA", "postal": "11111", "contact": "archive@example.test", "instructions": "Do not edit archived request", "dockCode": "ARC"], quantities: ["Sensor kit": 9], billing: "Billing account ARCHIVE-\(v.number) · unchanged"),
            BusinessRecord(id: v.number == 1 ? "SR-NS-9012" : v.number == 2 ? "SR-OR-5200" : "SR-CD-1102", project: v.project, requester: v.requester, cycle: v.cycle, status: "Approved", direction: "Inbound", type: "Service request", summary: "Current approved service request with a similar title, not equipment.", isTarget: false, delivery: ["recipient": "Service", "street": "2 Service Road", "city": "Denver", "region": "CO", "postal": "22222", "contact": "service@example.test", "instructions": "Leave untouched", "dockCode": "SVC"], quantities: ["Labor hour": 8], billing: "Billing account SERVICE-\(v.number) · unchanged"),
            BusinessRecord(id: v.number == 1 ? "EQ-OR-1180" : v.number == 2 ? "RT-OR-7001" : "EQ-CD-8812", project: v.project == "Northstar Lab" ? "Orion Lab" : v.project == "Orion Field Ops" ? "Orion Field Ops" : "Cedar Systems", requester: v.requester, cycle: v.cycle, status: "Approved", direction: "Outbound", type: "Equipment request", summary: "Current approved equipment record, but outbound direction conflicts with inbound task.", isTarget: false, delivery: ["recipient": "Outbound", "street": "3 Dispatch Road", "city": "Austin", "region": "TX", "postal": "33333", "contact": "outbound@example.test", "instructions": "Leave untouched", "dockCode": "OUT"], quantities: ["Crate": 2], billing: "Billing account OUTBOUND-\(v.number) · unchanged"),
            BusinessRecord(id: v.number == 1 ? "RT-NS-3304" : v.number == 2 ? "EQ-OR-4140" : "RT-CD-7780", project: v.project, requester: v.requester, cycle: v.cycle, status: "Draft", direction: "Inbound", type: "Return request", summary: "Current draft return record; Edit and Continue actions are not this task.", isTarget: false, delivery: ["recipient": "Draft", "street": "4 Draft Road", "city": "Seattle", "region": "WA", "postal": "44444", "contact": "draft@example.test", "instructions": "Leave untouched", "dockCode": "DRF"], quantities: ["Return box": 1], billing: "Billing account DRAFT-\(v.number) · unchanged"),
            BusinessRecord(id: v.number == 1 ? "EQ-NS-2710" : v.number == 2 ? "EQ-OR-4141" : "EQ-NS-2741", project: v.project, requester: v.requester == "Maya Chen" ? "Maya Cheng" : v.requester == "Rafael Ortiz" ? "Rafael Ortez" : "Priya Nairr", cycle: v.cycle, status: "Approved", direction: "Inbound", type: "Equipment request", summary: "Current approved equipment decoy with a near-matching requester spelling.", isTarget: false, delivery: ["recipient": "Near Match", "street": "5 Similar Road", "city": "San Jose", "region": "CA", "postal": "55555", "contact": "near@example.test", "instructions": "Leave untouched", "dockCode": "NEAR"], quantities: ["Near item": 2], billing: "Billing account NEAR-\(v.number) · unchanged"),
        ]
        let byID = Dictionary(uniqueKeysWithValues: ([target] + decoys).map { ($0.id, $0) })
        return v.recordOrder.compactMap { byID[$0] }
    }

    func log(_ kind: String, _ fields: [String: Any] = [:]) {
        var event: [String: Any] = ["kind": kind, "stage": stage, "generation": generation]
        for (key, value) in fields { event[key] = value }
        events.append(event)
        writeOracle()
    }

    func initialRecordStates() -> [[String: Any]] {
        records.map { $0.unchangedState() }
    }

    func oracleState() -> [String: Any] {
        [
            "stage": stage,
            "generation": generation,
            "selectedRecord": selectedRecord?.id ?? "",
            "validationErrors": validationErrors,
            "validationAttempts": validationAttempts,
            "ambiguousAttempts": ambiguousAttempts,
            "incorrectRecordSelections": incorrectRecordSelections,
            "saveCount": saveCount,
            "reviewAcknowledged": reviewAcknowledged,
            "records": records.map { $0.oracleState() },
        ]
    }

    private func resetStage() {
        generation += 1
        currentFields.removeAll(); currentButtons.removeAll(); currentRadioButtons.removeAll(); lastFieldEvent = nil
        for child in root.subviews { child.removeFromSuperview() }
    }

    private func addLabel(_ text: String, to view: NSView, frame: NSRect, label: String? = nil, bold: Bool = false) -> NSTextField {
        // Keep static text's own value in AX. Long/newline-bearing labels are
        // split into short native labels so compact AX output cannot collapse a
        // whole clue into an empty accessibility node.
        let lines = text.components(separatedBy: "\n")
        let lineHeight = max(16, min(20, frame.height / CGFloat(max(1, lines.count))))
        var first: NSTextField?
        for (index, line) in lines.enumerated() {
            let field = NSTextField(labelWithString: line)
            field.frame = NSRect(x: frame.minX, y: frame.maxY - CGFloat(index + 1) * lineHeight, width: frame.width, height: lineHeight)
            if bold { field.font = .boldSystemFont(ofSize: 14) }
            view.addSubview(field)
            if first == nil { first = field }
        }
        _ = label
        return first ?? NSTextField(labelWithString: "")
    }

    private func addPanel(_ title: String, frame: NSRect, to parent: NSView = NSView()) -> (NSBox, NSView) {
        let box = NSBox(frame: frame)
        box.title = title
        box.titlePosition = .atTop
        box.boxType = .primary
        // NSBox titles are visually rendered but may be omitted from compact AX
        // lines. Give the group an explicit accessible context so `within` can
        // distinguish duplicate Edit/Review/Continue/Save controls.
        box.setAccessibilityLabel(title)
        box.contentViewMargins = NSSize(width: 12, height: 12)
        parent.addSubview(box)
        return (box, box.contentView ?? box)
    }

    private func addButton(_ title: String, to view: NSView, frame: NSRect, key: String, enabled: Bool = true, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.frame = frame
        button.identifier = NSUserInterfaceItemIdentifier("business-control-\(generation)-\(currentButtons.count + currentRadioButtons.count + 1)")
        button.isEnabled = enabled
        view.addSubview(button)
        currentButtons[key] = button
        return button
    }

    private func addField(_ value: String, to view: NSView, frame: NSRect, key: String, accessibilityLabel: String) -> BusinessTextField {
        let field = BusinessTextField(string: value)
        field.frame = frame
        field.identifier = NSUserInterfaceItemIdentifier("business-control-\(generation)-\(currentFields.count + 1)")
        field.setAccessibilityLabel(accessibilityLabel)
        field.isEditable = true
        field.isSelectable = true
        field.onFixtureValueChange = { [weak self, weak field] in
            guard let self, let field else { return }
            self.fieldChanged(key: key, value: field.stringValue)
        }
        NotificationCenter.default.addObserver(forName: NSControl.textDidChangeNotification, object: field, queue: .main) { [weak self, weak field] _ in
            guard let self, let field else { return }
            self.fieldChanged(key: key, value: field.stringValue)
        }
        view.addSubview(field); currentFields[key] = field
        return field
    }

    private func fieldChanged(key: String, value: String) {
        guard stage == "delivery" || stage == "lineItems" else { return }
        if stage == "delivery", let selectedRecord { selectedRecord.delivery[key] = value }
        if stage == "lineItems", let selectedRecord { selectedRecord.quantities[key] = Int(value) ?? -1 }
        let signature = "\(stage)|\(key)|\(value)"
        if signature != lastFieldEvent {
            lastFieldEvent = signature
            log("field_changed", ["field": key, "value": value])
        }
        updateEnabledState()
    }

    private func taskBriefText() -> String {
        let signature = variation.signatureRequired ? "required" : "not required"
        let dock = variation.dockRequired ? "required" : "not required"
        return "CURRENT TASK: Find the CURRENT approved EQUIPMENT request.\nProject: \"\(variation.project)\" · Requester: \"\(variation.requester)\".\nMatch status Approved, type Equipment request, direction Inbound, cycle \(variation.cycle).\nLeave draft, previous-cycle, outbound, service, and near-name records untouched.\nEdit DELIVERY details only; do not edit billing.\nDeadline: \(variation.deadline) · budget cap: $\(variation.budget).\nRequirements: signature \(signature); dock appointment \(dock).\nUse read-only reference notes for quantities; choose the lowest-cost eligible shipping option.\nSave exactly one simulated LOCAL DRAFT after final totals review; do not purchase or submit."
    }

    func showInbox() {
        stage = "inbox"; selectedRecord = nil; resetStage()
        addLabel("Document Review / Task Inbox", to: root, frame: NSRect(x: 24, y: 744, width: 1000, height: 28), bold: true)
        let (brief, briefContent) = addPanel("Current-cycle task brief · read before selecting a record", frame: NSRect(x: 24, y: 540, width: 1050, height: 180), to: root)
        _ = brief
        addLabel(taskBriefText(), to: briefContent, frame: NSRect(x: 8, y: 8, width: 1010, height: 150), label: "Task instructions")
        let (filters, filterContent) = addPanel("Request queue controls · not the record review", frame: NSRect(x: 24, y: 484, width: 1050, height: 48), to: root)
        _ = filters
        _ = addButton("Continue", to: filterContent, frame: NSRect(x: 10, y: 5, width: 130, height: 28), key: "inboxContinue", enabled: false, action: #selector(inertButton(_:)))
        addLabel("Choose one Review action from the record whose complete context matches the task brief.", to: filterContent, frame: NSRect(x: 160, y: 9, width: 820, height: 22))
        let scroll = NSScrollView(frame: NSRect(x: 24, y: 34, width: 1050, height: 440))
        scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        let document = NSView(frame: NSRect(x: 0, y: 0, width: 1010, height: CGFloat(records.count * 156)))
        document.autoresizingMask = [.width]
        for (index, record) in records.enumerated() {
            let y = CGFloat(records.count - index - 1) * 150 + 8
            let (panel, content) = addPanel("\(record.id) · \(record.cycle) · \(record.status) · \(record.type)", frame: NSRect(x: 8, y: y, width: 990, height: 138), to: document)
            _ = panel
            addLabel("Project: \(record.project)\nRequester: \(record.requester)\nDirection: \(record.direction)\nSummary: \(record.summary)", to: content, frame: NSRect(x: 8, y: 34, width: 760, height: 72), label: "Record context")
            let button = addButton("Review", to: content, frame: NSRect(x: 790, y: 45, width: 150, height: 32), key: "review-\(index)", action: #selector(reviewRecord(_:)))
            button.tag = index
        }
        scroll.documentView = document; root.addSubview(scroll)
        log("show_inbox", ["recordCount": records.count, "variation": variation.number])
    }

    @objc private func inertButton(_ sender: NSButton) { log("inert_button", ["title": sender.title]) }

    @objc private func reviewRecord(_ sender: NSButton) {
        let index = sender.tag
        guard index >= 0, index < records.count else { return }
        let record = records[index]
        log("review_record", ["recordID": record.id])
        if !record.isTarget { incorrectRecordSelections += 1; log("wrong_record_selected", ["recordID": record.id]) }
        showReviewModal(record)
    }

    private func showReviewModal(_ record: BusinessRecord) {
        stage = "modal"; resetStage()
        let (panel, content) = addPanel("Review confirmation modal · selected record context", frame: NSRect(x: 180, y: 220, width: 760, height: 320), to: root)
        _ = panel
        addLabel("You selected:\n\(record.id)\n\(record.cycle) · \(record.status) · \(record.type)\nProject: \(record.project)\nRequester: \(record.requester)\nDirection: \(record.direction)\n\nConfirm only if this is the current approved inbound equipment request named in the task brief.", to: content, frame: NSRect(x: 20, y: 92, width: 710, height: 176), label: "Selected record confirmation")
        _ = addButton("Continue", to: content, frame: NSRect(x: 20, y: 38, width: 160, height: 34), key: "modalContinue", action: #selector(continueModal(_:)))
        _ = addButton("Cancel", to: content, frame: NSRect(x: 205, y: 38, width: 160, height: 34), key: "modalCancel", action: #selector(cancelModal(_:)))
        log("show_modal", ["recordID": record.id])
    }

    @objc private func cancelModal(_ sender: NSButton) { log("cancel_modal"); showInbox() }
    @objc private func continueModal(_ sender: NSButton) {
        guard let selected = records.first(where: { $0.id == selectedRecord?.id }) ?? records.first(where: { $0.id == variation.targetID }) else { return }
        // Review button carries the selected record through the modal using the
        // generation-independent button tag/event; recover by last review event.
        let selectedID = (events.last(where: { $0["kind"] as? String == "review_record" })?["recordID"] as? String) ?? selected.id
        let chosen = records.first(where: { $0.id == selectedID }) ?? selected
        selectedRecord = chosen
        log("continue_modal", ["recordID": chosen.id])
        showDetail(chosen)
    }

    private func showDetail(_ record: BusinessRecord) {
        stage = "detail"; resetStage()
        addLabel("Request detail · inspect context before choosing an Edit", to: root, frame: NSRect(x: 24, y: 744, width: 1000, height: 28), bold: true)
        let (context, contextContent) = addPanel("Record context · approved status and routing", frame: NSRect(x: 24, y: 592, width: 1050, height: 132), to: root)
        _ = context
        addLabel("\(record.id) · \(record.cycle) · \(record.status)\nProject: \(record.project) · Requester: \(record.requester)\nType: \(record.type) · Direction: \(record.direction)\nThis record is the one currently under review.", to: contextContent, frame: NSRect(x: 8, y: 20, width: 850, height: 86), label: "Current record context")
        let (billing, billingContent) = addPanel("Billing details · read-only / do not edit", frame: NSRect(x: 24, y: 424, width: 510, height: 150), to: root)
        _ = billing
        addLabel("\(record.billing)\nBilling Edit is disabled because this task changes delivery only.", to: billingContent, frame: NSRect(x: 8, y: 48, width: 330, height: 70), label: "Billing details")
        _ = addButton("Edit", to: billingContent, frame: NSRect(x: 360, y: 70, width: 110, height: 32), key: "billingEdit", enabled: false, action: #selector(inertButton(_:)))
        let (delivery, deliveryContent) = addPanel("Delivery details · editable section", frame: NSRect(x: 564, y: 424, width: 510, height: 150), to: root)
        _ = delivery
        addLabel("Current delivery values are shown after entering this section. Delivery Edit is the only enabled Edit action.", to: deliveryContent, frame: NSRect(x: 8, y: 48, width: 330, height: 70), label: "Delivery details")
        _ = addButton("Edit", to: deliveryContent, frame: NSRect(x: 360, y: 70, width: 110, height: 32), key: "deliveryEdit", action: #selector(editDelivery(_:)))
        let (items, itemsContent) = addPanel("Line items · quantity review section", frame: NSRect(x: 24, y: 254, width: 510, height: 150), to: root)
        _ = items
        addLabel("Displayed reference quantities must be checked in the next panel.", to: itemsContent, frame: NSRect(x: 8, y: 50, width: 330, height: 60), label: "Line items summary")
        _ = addButton("Review", to: itemsContent, frame: NSRect(x: 360, y: 70, width: 110, height: 32), key: "itemsReview", action: #selector(reviewLineItems(_:)))
        let (other, otherContent) = addPanel("Workflow controls · not final save", frame: NSRect(x: 564, y: 254, width: 510, height: 150), to: root)
        _ = other
        _ = addButton("Continue", to: otherContent, frame: NSRect(x: 20, y: 70, width: 130, height: 32), key: "detailContinue", enabled: false, action: #selector(inertButton(_:)))
        addLabel("Continue becomes available only after delivery and line-item checks.", to: otherContent, frame: NSRect(x: 170, y: 52, width: 300, height: 68), label: "Workflow control explanation")
        log("show_detail", ["recordID": record.id])
    }

    @objc private func editDelivery(_ sender: NSButton) { log("edit_delivery", ["recordID": selectedRecord?.id ?? ""]); showDelivery() }

    private func showDelivery() {
        stage = "delivery"; resetStage()
        guard let record = selectedRecord else { return }
        addLabel("Edit delivery details · billing remains unchanged", to: root, frame: NSRect(x: 24, y: 744, width: 1000, height: 28), bold: true)
        let (brief, briefContent) = addPanel("Visible delivery constraints and correction reference", frame: NSRect(x: 24, y: 628, width: 1050, height: 96), to: root)
        _ = brief
        let d = variation.targetDelivery
        addLabel("Deadline: \(variation.deadline) · Budget cap: $\(variation.budget) · \(variation.signatureRequired ? "Signature required" : "No signature required") · \(variation.dockRequired ? "Dock appointment required" : "No dock appointment required")\nRequested recipient=\(d["recipient"] ?? "") · street=\(d["street"] ?? "") · city=\(d["city"] ?? "")\nRequested region=\(d["region"] ?? "") · postal=\(d["postal"] ?? "") · contact=\(d["contact"] ?? "")\nRequested instructions=\(d["instructions"] ?? "") · dock code=\(d["dockCode"] ?? "")\nChoose the lowest-cost option marked eligible.", to: briefContent, frame: NSRect(x: 8, y: 8, width: 1010, height: 92), label: "Delivery constraints")
        let (fieldsPanel, fieldsContent) = addPanel("Delivery details · Edit", frame: NSRect(x: 24, y: 284, width: 520, height: 330), to: root)
        _ = fieldsPanel
        let keys = ["recipient", "street", "city", "region", "postal", "contact", "instructions"]
        let labels = ["Recipient", "Street", "City", "Region", "Postal code", "Contact", "Instructions"]
        for index in keys.indices {
            let y = 270 - index * 36
            addLabel(labels[index], to: fieldsContent, frame: NSRect(x: 8, y: CGFloat(y + 5), width: 102, height: 22))
            _ = addField(record.delivery[keys[index]] ?? "", to: fieldsContent, frame: NSRect(x: 118, y: CGFloat(y), width: 370, height: 28), key: keys[index], accessibilityLabel: "Delivery \(labels[index])")
        }
        let (shipping, shippingContent) = addPanel("Shipping option selection · read visible eligibility", frame: NSRect(x: 564, y: 410, width: 510, height: 204), to: root)
        _ = shipping
        for (index, option) in variation.options.enumerated() {
            let radio = NSButton(radioButtonWithTitle: option.display(), target: self, action: #selector(selectShipping(_:)))
            radio.frame = NSRect(x: 8, y: 144 - index * 32, width: 480, height: 26)
            radio.tag = index; radio.isEnabled = option.eligible
            radio.identifier = NSUserInterfaceItemIdentifier("business-control-\(generation)-shipping-\(index)")
            shippingContent.addSubview(radio); currentRadioButtons[option.name] = radio
        }
        _ = addButton("Review", to: shippingContent, frame: NSRect(x: 8, y: 4, width: 120, height: 28), key: "shippingReview", action: #selector(reviewShipping(_:)))
        let (conditional, conditionalContent) = addPanel("Conditional delivery field", frame: NSRect(x: 564, y: 284, width: 510, height: 112), to: root)
        _ = conditional
        let checkbox = NSButton(checkboxWithTitle: "Dock appointment required", target: self, action: #selector(toggleDock(_:)))
        checkbox.frame = NSRect(x: 8, y: 58, width: 250, height: 24); checkbox.state = .off; checkbox.identifier = NSUserInterfaceItemIdentifier("business-control-\(generation)-dock-checkbox")
        conditionalContent.addSubview(checkbox); currentButtons["dockCheckbox"] = checkbox
        addLabel(variation.dockRequired ? "Constraint says this must be selected; then enter the enabled code." : "Constraint says this remains unselected.", to: conditionalContent, frame: NSRect(x: 270, y: 58, width: 210, height: 24), label: "Dock conditional rule")
        _ = addField(record.delivery["dockCode"] ?? "", to: conditionalContent, frame: NSRect(x: 8, y: 18, width: 310, height: 28), key: "dockCode", accessibilityLabel: "Dock appointment code")
        currentFields["dockCode"]?.isEnabled = false
        let (actions, actionsContent) = addPanel("Delivery actions", frame: NSRect(x: 24, y: 186, width: 1050, height: 78), to: root)
        _ = actions
        _ = addButton("Save", to: actionsContent, frame: NSRect(x: 12, y: 21, width: 120, height: 32), key: "deliverySave", enabled: false, action: #selector(inertButton(_:)))
        _ = addButton("Continue", to: actionsContent, frame: NSRect(x: 150, y: 21, width: 130, height: 32), key: "deliveryContinue", enabled: false, action: #selector(continueDelivery(_:)))
        let verified = NSButton(checkboxWithTitle: "Delivery details reviewed", target: self, action: #selector(toggleDeliveryVerified(_:)))
        verified.frame = NSRect(x: 300, y: 22, width: 220, height: 28); verified.identifier = NSUserInterfaceItemIdentifier("business-control-\(generation)-delivery-verified")
        actionsContent.addSubview(verified); currentButtons["deliveryVerified"] = verified
        addLabel("Save is disabled here. Review shipping and verify delivery before Continue moves to quantity verification.", to: actionsContent, frame: NSRect(x: 530, y: 18, width: 470, height: 38), label: "Delivery action explanation")
        log("show_delivery", ["recordID": record.id])
        updateEnabledState()
    }

    @objc private func reviewShipping(_ sender: NSButton) {
        shippingReviewed = true
        log("shipping_reviewed", ["option": deliveryShipping ?? ""])
        updateEnabledState()
    }

    @objc private func toggleDeliveryVerified(_ sender: NSButton) {
        deliveryVerified = sender.state == .on
        log("delivery_verified", ["selected": deliveryVerified])
        updateEnabledState()
    }

    @objc private func selectShipping(_ sender: NSButton) {
        let option = variation.options[sender.tag]
        guard option.eligible else { return }
        deliveryShipping = option.name; selectedRecord?.shipping = option.name
        for button in currentRadioButtons.values { button.state = .off }
        sender.state = .on
        log("shipping_selected", ["option": option.name, "price": option.price])
        updateEnabledState()
    }

    @objc private func toggleDock(_ sender: NSButton) {
        dockAppointmentRequired = sender.state == .on
        currentFields["dockCode"]?.isEnabled = dockAppointmentRequired
        log("dock_requirement_toggled", ["selected": dockAppointmentRequired])
        updateEnabledState()
    }

    private func updateEnabledState() {
        guard stage == "delivery" else { return }
        let fieldsReady = ["recipient", "street", "city", "region", "postal", "contact", "instructions"].allSatisfy { !(currentFields[$0]?.stringValue ?? "").isEmpty }
        let dockReady = !variation.dockRequired || (dockAppointmentRequired && !(currentFields["dockCode"]?.stringValue ?? "").isEmpty)
        let optionReady = deliveryShipping != nil && variation.options.first(where: { $0.name == deliveryShipping })?.eligible == true
        currentButtons["deliveryContinue"]?.isEnabled = fieldsReady && dockReady && optionReady && shippingReviewed && deliveryVerified
    }

    @objc private func continueDelivery(_ sender: NSButton) {
        guard sender.isEnabled else { return }
        log("continue_delivery", ["recordID": selectedRecord?.id ?? ""])
        showLineItems()
    }

    @objc private func reviewLineItems(_ sender: NSButton) { showLineItems() }

    private func showLineItems() {
        stage = "lineItems"; resetStage()
        guard let record = selectedRecord else { return }
        addLabel("Line-item quantity verification · use displayed reference notes", to: root, frame: NSRect(x: 24, y: 744, width: 1000, height: 28), bold: true)
        let itemNames = Array(variation.targetQuantities.keys).sorted()
        let (reference, referenceContent) = addPanel("Read-only reference notes · required quantities", frame: NSRect(x: 24, y: 510, width: 1050, height: 210), to: root)
        _ = reference
        for (index, item) in itemNames.enumerated() {
            addLabel("Reference note: \(item) requires \(variation.targetQuantities[item] ?? 0) unit(s).", to: referenceContent, frame: NSRect(x: 8, y: 154 - index * 20, width: 1000, height: 20), label: "Reference \(item)")
        }
        let (quantityPanel, quantityContent) = addPanel("Current draft quantities · editable", frame: NSRect(x: 24, y: 190, width: 600, height: 320), to: root)
        _ = quantityPanel
        for (index, item) in itemNames.enumerated() {
            let y = 270 - index * 31
            addLabel(item, to: quantityContent, frame: NSRect(x: 8, y: CGFloat(y + 4), width: 250, height: 22))
            _ = addField(String(record.quantities[item] ?? -1), to: quantityContent, frame: NSRect(x: 270, y: CGFloat(y), width: 300, height: 28), key: item, accessibilityLabel: "Quantity \(item)")
        }
        let (validation, validationContent) = addPanel("Validation messages", frame: NSRect(x: 650, y: 416, width: 424, height: 128), to: root)
        _ = validation
        validationLabel = addLabel(validationAttempts == 0 ? "No validation run yet. Review all displayed notes before continuing." : "Validation error: stale scanner row. Recheck each visible quantity and press Review again.", to: validationContent, frame: NSRect(x: 8, y: 28, width: 398, height: 72), label: "Validation error")
        let (actions, actionsContent) = addPanel("Quantity verification actions", frame: NSRect(x: 24, y: 176, width: 1050, height: 78), to: root)
        _ = actions
        _ = addButton("Review", to: actionsContent, frame: NSRect(x: 12, y: 21, width: 120, height: 32), key: "lineReview", action: #selector(reviewQuantities(_:)))
        _ = addButton("Continue", to: actionsContent, frame: NSRect(x: 150, y: 21, width: 130, height: 32), key: "lineContinue", enabled: false, action: #selector(continueLineItems(_:)))
        addLabel("Review is required before Continue is enabled. A stale scanner validation is intentionally shown once.", to: actionsContent, frame: NSRect(x: 300, y: 18, width: 700, height: 38), label: "Quantity action explanation")
        log("show_line_items", ["recordID": record.id])
        updateLineActions()
    }

    private func updateLineActions() {
        let correct = variation.targetQuantities.allSatisfy { key, value in selectedRecord?.quantities[key] == value }
        currentButtons["lineContinue"]?.isEnabled = totalsReady && correct
    }

    @objc private func reviewQuantities(_ sender: NSButton) {
        validationAttempts += 1
        if validationAttempts == 1 {
            validationErrors += 1
            // Simulate a stale scanner correction: one visible draft value is
            // changed to an invalid value by the fixture after the first review.
            // The reference note remains visible, forcing a real post-error user
            // correction rather than allowing a retry to masquerade as success.
            if let item = variation.targetQuantities.keys.sorted().first {
                selectedRecord?.quantities[item] = 0
                currentFields[item]?.stringValue = "0"
            }
            validationLabel?.stringValue = "Validation error: stale scanner row. Recheck each visible quantity and press Review again."
            log("validation_error", ["reason": "stale scanner pass", "attempt": validationAttempts])
            // Rebuild only this fixture-owned panel so the failed transition
            // yields a fresh AX tree and new indices for the correction pass.
            showLineItems()
            return
        }
        let correct = variation.targetQuantities.allSatisfy { key, value in selectedRecord?.quantities[key] == value }
        if !correct {
            validationErrors += 1
            validationLabel?.stringValue = "Validation error: quantity mismatch. Correct the draft from the visible notes and press Review again."
            log("validation_error", ["reason": "quantity mismatch", "attempt": validationAttempts])
            showLineItems()
            return
        }
        totalsReady = true
        log("quantities_reviewed", ["attempt": validationAttempts])
        updateLineActions()
    }

    @objc private func continueLineItems(_ sender: NSButton) {
        guard sender.isEnabled else { return }
        log("continue_line_items", ["recordID": selectedRecord?.id ?? ""])
        showFinalReview()
    }

    private func showFinalReview() {
        stage = "finalReview"; resetStage(); reviewAcknowledged = false
        guard let record = selectedRecord else { return }
        addLabel("Final review · simulated local draft only", to: root, frame: NSRect(x: 24, y: 744, width: 1000, height: 28), bold: true)
        let (summary, summaryContent) = addPanel("Selected record summary", frame: NSRect(x: 24, y: 570, width: 510, height: 150), to: root)
        _ = summary
        addLabel("\(record.id) · \(record.status) · \(record.type)\nProject: \(record.project) · Requester: \(record.requester)\nCycle: \(record.cycle) · Direction: \(record.direction)", to: summaryContent, frame: NSRect(x: 8, y: 42, width: 470, height: 90), label: "Final record summary")
        let (delivery, deliveryContent) = addPanel("Delivery summary · changed", frame: NSRect(x: 564, y: 570, width: 510, height: 150), to: root)
        _ = delivery
        let d = record.delivery
        addLabel("\(d["recipient"] ?? "") · \(d["street"] ?? "")\n\(d["city"] ?? ""), \(d["region"] ?? "") \(d["postal"] ?? "")\nShipping: \(record.shipping ?? "")", to: deliveryContent, frame: NSRect(x: 8, y: 28, width: 470, height: 104), label: "Final delivery summary")
        let (billing, billingContent) = addPanel("Billing summary · unchanged", frame: NSRect(x: 24, y: 390, width: 510, height: 150), to: root)
        _ = billing
        addLabel("\(record.billing)\nNo billing control was edited.", to: billingContent, frame: NSRect(x: 8, y: 50, width: 470, height: 70), label: "Final billing summary")
        _ = addButton("Save", to: billingContent, frame: NSRect(x: 360, y: 74, width: 110, height: 32), key: "billingSave", enabled: false, action: #selector(inertButton(_:)))
        let (totals, totalsContent) = addPanel("Totals review · inspect before acknowledgement", frame: NSRect(x: 564, y: 390, width: 510, height: 150), to: root)
        _ = totals
        let itemTotal = variation.targetQuantities.values.reduce(0, +)
        let shipPrice = variation.options.first(where: { $0.name == record.shipping })?.price ?? 0
        addLabel("Line-item total units: \(itemTotal)\nShipping total: $\(shipPrice)\nReview the delivery, billing unchanged state, and quantities before saving.", to: totalsContent, frame: NSRect(x: 8, y: 42, width: 470, height: 90), label: "Final totals")
        let (savePanel, saveContent) = addPanel("Local draft save · final action", frame: NSRect(x: 24, y: 206, width: 1050, height: 146), to: root)
        _ = savePanel
        _ = addButton("Review", to: saveContent, frame: NSRect(x: 12, y: 54, width: 120, height: 32), key: "finalReview", action: #selector(acknowledgeReview(_:)))
        _ = addButton("Save", to: saveContent, frame: NSRect(x: 150, y: 54, width: 120, height: 32), key: "finalSave", enabled: false, action: #selector(saveDraft(_:)))
        addLabel("Review must be acknowledged before Save enables. This only creates a simulated local draft; no network or purchase exists.", to: saveContent, frame: NSRect(x: 300, y: 40, width: 700, height: 58), label: "Local draft save explanation")
        log("show_final_review", ["recordID": record.id])
    }

    @objc private func acknowledgeReview(_ sender: NSButton) {
        reviewAcknowledged = true
        currentButtons["finalSave"]?.isEnabled = saveCount == 0
        log("final_review_acknowledged")
    }

    @objc private func saveDraft(_ sender: NSButton) {
        guard sender.isEnabled, reviewAcknowledged, saveCount == 0, let record = selectedRecord else { return }
        saveCount += 1
        stage = "saved"
        sender.isEnabled = false
        log("draft_saved", ["recordID": record.id, "saveCount": saveCount])
        showSavedState()
    }

    private func showSavedState() {
        resetStage()
        addLabel("Draft saved locally · no purchase or submission", to: root, frame: NSRect(x: 24, y: 650, width: 1000, height: 28), bold: true)
        let (panel, content) = addPanel("Saved result", frame: NSRect(x: 180, y: 320, width: 760, height: 250), to: root)
        _ = panel
        addLabel("Record \(selectedRecord?.id ?? "") has exactly one simulated local draft save.\nBilling remains unchanged. Similar records remain untouched.\nNo network, payment, purchase, message, or document operation occurred.", to: content, frame: NSRect(x: 20, y: 58, width: 700, height: 130), label: "Saved result")
        // Final state is graded from stage=saved and draft_saved; no extra
        // synthetic event is counted for rendering the terminal status screen.
    }
}

let arguments = CommandLine.arguments
let variationNumber = Int(arguments.firstIndex(of: "--variation").flatMap { index in arguments.indices.contains(index + 1) ? arguments[index + 1] : nil } ?? "1") ?? 1
oraclePath = arguments.firstIndex(of: "--oracle-path").flatMap { index in arguments.indices.contains(index + 1) ? arguments[index + 1] : nil }
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let controller = BusinessWindowController(variation: BusinessWindowController.makeVariation(variationNumber))
businessController = controller
writeOracle()
app.activate(ignoringOtherApps: true)
app.run()
