import Foundation
import IOKit.hid
import ApplicationServices
import AppKit

struct MTPoint {
  var x: Float
  var y: Float
}

struct MTVector {
  var position: MTPoint
  var velocity: MTPoint
}

struct MTTouch {
  var frame: Int32
  var timestamp: Double
  var pathIndex: Int32
  var state: UInt32
  var fingerID: Int32
  var handID: Int32
  var normalizedVector: MTVector
  var zTotal: Float
  var field9: Int32
  var angle: Float
  var majorAxis: Float
  var minorAxis: Float
  var absoluteVector: MTVector
  var field14: Int32
  var field15: Int32
  var zDensity: Float
}

typealias MTDeviceRef = UnsafeMutableRawPointer
typealias MTFrameCallback = @convention(c) (
  MTDeviceRef,
  UnsafeMutableRawPointer,
  Int,
  Double,
  Int
) -> Void

@_silgen_name("MTDeviceCreateList")
func MTDeviceCreateList() -> CFArray?

@_silgen_name("MTRegisterContactFrameCallback")
func MTRegisterContactFrameCallback(_ device: MTDeviceRef, _ callback: MTFrameCallback)

@_silgen_name("MTDeviceStart")
func MTDeviceStart(_ device: MTDeviceRef, _ flags: Int32) -> Int32

@_silgen_name("MTDeviceGetSensorSurfaceDimensions")
func MTDeviceGetSensorSurfaceDimensions(
  _ device: MTDeviceRef,
  _ width: UnsafeMutablePointer<Int32>,
  _ height: UnsafeMutablePointer<Int32>
) -> Int32

@_silgen_name("MTDeviceGetDeviceID")
func MTDeviceGetDeviceID(
  _ device: MTDeviceRef,
  _ deviceId: UnsafeMutablePointer<UInt64>
) -> Int32

final class StandardOutput {
  private let lock = NSLock()

  func write(_ object: [String: Any]) {
    guard
      JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object),
      let line = String(data: data, encoding: .utf8)
    else {
      return
    }

    lock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    lock.unlock()
  }
}

let output = StandardOutput()
let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
var inputReportContexts: [String: InputReportContext] = [:]
var multitouchDeviceList: CFArray?
var multitouchDevices: [MTDeviceRef] = []
var registeredMultitouchDeviceIds = Set<UInt64>()
var multitouchScanTimer: Timer?
var pointerAssistTimer: Timer?
var pointerAssistRecentTargets: [String: (payload: [String: Any], seenAt: TimeInterval)] = [:]
var pointerAssistLastScanMouse: CGPoint?
var pointerAssistLastScanAt: TimeInterval = 0

let remoteProductIds = [0x0266, 0x026d, 0x0314, 0x0315]
let pointerAssistScanRadius: CGFloat = 520
let pointerAssistMaxTargets = 420
let pointerAssistRoles = Set([
  kAXButtonRole as String,
  kAXCheckBoxRole as String,
  kAXRadioButtonRole as String,
  kAXPopUpButtonRole as String,
  kAXTextFieldRole as String,
  kAXTextAreaRole as String,
  kAXMenuItemRole as String,
  kAXCellRole as String,
  kAXRowRole as String,
  "AXScrollBar",
  "AXLink",
  "AXImage",
  "AXIcon",
])
let pointerAssistActionCandidateRoles = Set([
  "AXGroup",
  "AXImage",
  "AXStaticText",
  "AXUnknown",
])

let pointerAssistMode = CommandLine.arguments.contains("--pointer-assist")

let remoteHidUsagePagesToOpen = [12, 32, 65280]
let remoteHidMatchingDictionaries = remoteProductIds.flatMap { productId in
  remoteHidUsagePagesToOpen.map { usagePage -> [String: Any] in
    [
      kIOHIDVendorIDKey as String: 0x004c,
      kIOHIDProductIDKey as String: productId,
      kIOHIDPrimaryUsagePageKey as String: usagePage,
    ]
  }
}

func integerProperty(_ device: IOHIDDevice, _ key: String) -> Int {
  IOHIDDeviceGetProperty(device, key as CFString) as? Int ?? 0
}

func stringProperty(_ device: IOHIDDevice, _ key: String) -> String {
  IOHIDDeviceGetProperty(device, key as CFString) as? String ?? ""
}

final class InputReportContext {
  let device: IOHIDDevice
  let buffer: UnsafeMutablePointer<UInt8>
  let size: CFIndex

  init(device: IOHIDDevice, size: Int) {
    self.device = device
    self.size = CFIndex(max(1, size))
    self.buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: max(1, size))
    self.buffer.initialize(repeating: 0, count: max(1, size))
  }

  deinit {
    buffer.deallocate()
  }
}

func deviceIdentifier(_ device: IOHIDDevice) -> String {
  let vendorId = integerProperty(device, kIOHIDVendorIDKey)
  let productId = integerProperty(device, kIOHIDProductIDKey)
  let serial = stringProperty(device, kIOHIDSerialNumberKey)
  return "\(String(vendorId, radix: 16)):\(String(productId, radix: 16)):\(serial)"
}

func serviceIdentifier(_ device: IOHIDDevice) -> String {
  let vendorId = integerProperty(device, kIOHIDVendorIDKey)
  let productId = integerProperty(device, kIOHIDProductIDKey)
  let serial = stringProperty(device, kIOHIDSerialNumberKey)
  let locationId = integerProperty(device, kIOHIDLocationIDKey)
  return "\(String(vendorId, radix: 16)):\(String(productId, radix: 16)):\(serial):\(String(locationId, radix: 16))"
}

func devicePayload(_ device: IOHIDDevice) -> [String: Any] {
  let product = stringProperty(device, kIOHIDProductKey)
  let serial = stringProperty(device, kIOHIDSerialNumberKey)
  let productId = integerProperty(device, kIOHIDProductIDKey)
  let displayName = product == serial || product.isEmpty ? "Apple TV Remote" : product

  return [
    "id": deviceIdentifier(device),
    "serviceId": serviceIdentifier(device),
    "name": displayName,
    "vendorId": integerProperty(device, kIOHIDVendorIDKey),
    "productId": productId,
    "serialNumber": serial,
    "locationId": integerProperty(device, kIOHIDLocationIDKey),
    "primaryUsagePage": integerProperty(device, kIOHIDPrimaryUsagePageKey),
    "primaryUsage": integerProperty(device, kIOHIDPrimaryUsageKey),
  ]
}

func remoteDeviceIdentifierForLocation(_ locationId: Int) -> String? {
  for context in inputReportContexts.values {
    if integerProperty(context.device, kIOHIDLocationIDKey) == locationId {
      return deviceIdentifier(context.device)
    }
  }

  return nil
}

func topLeftMouseLocation() -> CGPoint {
  let mouse = NSEvent.mouseLocation
  let referenceMaxY =
    NSScreen.main?.frame.maxY ??
    NSScreen.screens.first?.frame.maxY ??
    0
  return CGPoint(x: mouse.x, y: referenceMaxY - mouse.y)
}

func squaredDistanceToRect(_ point: CGPoint, _ rect: CGRect) -> CGFloat {
  let closestX = min(max(point.x, rect.minX), rect.maxX)
  let closestY = min(max(point.y, rect.minY), rect.maxY)
  let deltaX = point.x - closestX
  let deltaY = point.y - closestY
  return deltaX * deltaX + deltaY * deltaY
}

func rectIsUsableTarget(_ rect: CGRect) -> Bool {
  if rect.isNull || rect.isEmpty {
    return false
  }

  if rect.width < 4 || rect.height < 4 || rect.width > 1400 || rect.height > 1000 {
    return false
  }

  return true
}

func rectIsNearPoint(_ rect: CGRect, _ point: CGPoint, radius: CGFloat) -> Bool {
  guard rectIsUsableTarget(rect) else {
    return false
  }

  return squaredDistanceToRect(point, rect) <= radius * radius
}

func windowRectIsNearPoint(_ rect: CGRect, _ point: CGPoint, radius: CGFloat) -> Bool {
  if rect.isNull || rect.isEmpty {
    return false
  }

  return squaredDistanceToRect(point, rect) <= radius * radius
}

func rectPayload(
  _ rect: CGRect,
  id: String,
  kind: String,
  role: String,
  priority: Double,
  actionable: Bool = false
) -> [String: Any] {
  return [
    "id": id,
    "kind": kind,
    "role": role,
    "x": Double(rect.origin.x),
    "y": Double(rect.origin.y),
    "width": Double(rect.width),
    "height": Double(rect.height),
    "priority": priority,
    "actionable": actionable,
  ]
}

func copyAXAttribute(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
  var value: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  guard result == .success else {
    return nil
  }

  return value as AnyObject?
}

func axStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  copyAXAttribute(element, attribute) as? String
}

func axBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
  copyAXAttribute(element, attribute) as? Bool
}

func axActionNames(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  let result = AXUIElementCopyActionNames(element, &names)
  guard result == .success else {
    return []
  }

  return names as? [String] ?? []
}

func axChildren(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
  copyAXAttribute(element, attribute) as? [AXUIElement] ?? []
}

func axFrame(_ element: AXUIElement) -> CGRect? {
  guard
    let positionValue = copyAXAttribute(element, kAXPositionAttribute as String),
    let sizeValue = copyAXAttribute(element, kAXSizeAttribute as String)
  else {
    return nil
  }

  var position = CGPoint.zero
  var size = CGSize.zero

  guard
    AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
  else {
    return nil
  }

  return CGRect(origin: position, size: size)
}

func collectAXTargets(
  from element: AXUIElement,
  mouse: CGPoint,
  depth: Int,
  maxDepth: Int = 32,
  targets: inout [[String: Any]]
) {
  if depth > maxDepth || targets.count >= pointerAssistMaxTargets {
    return
  }

  let role = axStringAttribute(element, kAXRoleAttribute as String) ?? ""
  let supportedRole = pointerAssistRoles.contains(role)
  let actionable =
    !supportedRole &&
    pointerAssistActionCandidateRoles.contains(role) &&
    axActionNames(element).contains(kAXPressAction as String)
  let frame = axFrame(element)
  if
    (supportedRole || actionable),
    axBoolAttribute(element, kAXEnabledAttribute as String) ?? true,
    !(axBoolAttribute(element, "AXHidden") ?? false),
    let frame,
    rectIsUsableTarget(frame),
    rectIsNearPoint(frame, mouse, radius: pointerAssistScanRadius)
  {
    let priority = role == (kAXButtonRole as String)
      ? 1.25
      : actionable
        ? 1.18
        : 1.0
    targets.append(
      rectPayload(
        frame,
        id: "ax:\(role):\(Int(frame.origin.x)):\(Int(frame.origin.y)):\(Int(frame.width)):\(Int(frame.height))",
        kind: "accessibility",
        role: role,
        priority: priority,
        actionable: actionable
      )
    )
  }

  var children = axChildren(element, kAXVisibleChildrenAttribute as String)
  if children.isEmpty {
    children = axChildren(element, kAXChildrenAttribute as String)
  }

  for child in children.prefix(180) {
    collectAXTargets(
      from: child,
      mouse: mouse,
      depth: depth + 1,
      maxDepth: maxDepth,
      targets: &targets
    )
    if targets.count >= pointerAssistMaxTargets {
      return
    }
  }
}

func axParent(_ element: AXUIElement) -> AXUIElement? {
  guard let parent = copyAXAttribute(element, kAXParentAttribute as String) else {
    return nil
  }

  guard CFGetTypeID(parent) == AXUIElementGetTypeID() else {
    return nil
  }

  return (parent as! AXUIElement)
}

func windowOwnerProcessIdentifier(_ windowInfo: [String: Any]) -> pid_t? {
  let ownerPid = windowInfo[kCGWindowOwnerPID as String]

  if let processIdentifier = ownerPid as? pid_t {
    return processIdentifier
  }

  if let processIdentifier = ownerPid as? Int {
    return pid_t(processIdentifier)
  }

  if let processIdentifier = ownerPid as? NSNumber {
    return processIdentifier.int32Value
  }

  return nil
}

func collectApplicationAXTargets(processIdentifier: pid_t, mouse: CGPoint) -> [[String: Any]] {
  guard AXIsProcessTrusted() else {
    return []
  }

  let appElement = AXUIElementCreateApplication(processIdentifier)
  var roots = axChildren(appElement, kAXWindowsAttribute as String)

  if roots.isEmpty, let focusedWindow = copyAXAttribute(appElement, kAXFocusedWindowAttribute as String) {
    roots = [focusedWindow as! AXUIElement]
  }

  var targets: [[String: Any]] = []
  for root in roots.prefix(8) {
    collectAXTargets(from: root, mouse: mouse, depth: 0, targets: &targets)
    if targets.count >= pointerAssistMaxTargets {
      break
    }
  }

  return targets
}

func windowOwnerProcessIdentifiersNearMouse(mouse: CGPoint) -> [pid_t] {
  var processIdentifiers: [pid_t] = []
  var seen = Set<pid_t>()

  func append(_ processIdentifier: pid_t) {
    guard processIdentifier > 0, !seen.contains(processIdentifier) else {
      return
    }

    seen.insert(processIdentifier)
    processIdentifiers.append(processIdentifier)
  }

  let frontmostProcessIdentifier =
    NSWorkspace.shared.frontmostApplication?.processIdentifier

  guard
    let windowList = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements],
      kCGNullWindowID
    ) as? [[String: Any]]
  else {
    return processIdentifiers
  }

  var containingProcessIdentifier: pid_t?
  var nearestProcessIdentifier: pid_t?
  var nearestDistanceSquared = CGFloat.greatestFiniteMagnitude

  for windowInfo in windowList.prefix(120) {
    let layer = windowInfo[kCGWindowLayer as String] as? Int ?? 0
    let alpha = windowInfo[kCGWindowAlpha as String] as? Double ?? 1
    guard layer == 0 && alpha > 0.05 else {
      continue
    }

    guard let boundsValue = windowInfo[kCGWindowBounds as String] else {
      continue
    }

    let boundsDictionary = boundsValue as! CFDictionary
    guard
      let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
      let ownerPid = windowOwnerProcessIdentifier(windowInfo)
    else {
      continue
    }

    if bounds.contains(mouse) {
      containingProcessIdentifier = ownerPid
      break
    }

    let distanceSquared = squaredDistanceToRect(mouse, bounds)
    if
      distanceSquared <= pointerAssistScanRadius * pointerAssistScanRadius,
      distanceSquared < nearestDistanceSquared
    {
      nearestDistanceSquared = distanceSquared
      nearestProcessIdentifier = ownerPid
    }
  }

  if let containingProcessIdentifier {
    append(containingProcessIdentifier)
  }
  if let frontmostProcessIdentifier {
    append(frontmostProcessIdentifier)
  }
  if containingProcessIdentifier == nil, let nearestProcessIdentifier {
    append(nearestProcessIdentifier)
  }

  return Array(processIdentifiers.prefix(3))
}

func pointerAssistSampleOffsets(dense: Bool) -> [CGPoint] {
  if !dense {
    let sparseOffsets: [CGFloat] = [-200, -90, 0, 90, 200]
    return sparseOffsets.flatMap { offsetX in
      sparseOffsets.map { offsetY in
        CGPoint(x: offsetX, y: offsetY)
      }
    }
  }

  // A grid spaced at 24 points cannot skip over the 30-40 point controls that
  // benefit most from pointer magnetism. Wider rings retain look-ahead without
  // paying for a dense grid across the whole scan radius.
  let localOffsets: [CGFloat] = [-48, -24, 0, 24, 48]
  var samples = localOffsets.flatMap { offsetX in
    localOffsets.map { offsetY in
      CGPoint(x: offsetX, y: offsetY)
    }
  }
  let diagonalScale = CGFloat(0.70710678118)
  for distance in [CGFloat(88), CGFloat(144), CGFloat(200)] {
    let diagonal = distance * diagonalScale
    samples.append(contentsOf: [
      CGPoint(x: -distance, y: 0),
      CGPoint(x: distance, y: 0),
      CGPoint(x: 0, y: -distance),
      CGPoint(x: 0, y: distance),
      CGPoint(x: -diagonal, y: -diagonal),
      CGPoint(x: diagonal, y: -diagonal),
      CGPoint(x: -diagonal, y: diagonal),
      CGPoint(x: diagonal, y: diagonal),
    ])
  }
  return samples
}

func collectHitTestAXTargets(processIdentifiers: [pid_t], mouse: CGPoint) -> [[String: Any]] {
  guard AXIsProcessTrusted() else {
    return []
  }

  var targets: [[String: Any]] = []

  for (processIndex, processIdentifier) in processIdentifiers.prefix(3).enumerated() {
    let appElement = AXUIElementCreateApplication(processIdentifier)
    var visitedElements = Set<CFHashCode>()
    let sampleOffsets = pointerAssistSampleOffsets(dense: processIndex == 0)

    for sampleOffset in sampleOffsets {
      var element: AXUIElement?
      let result = AXUIElementCopyElementAtPosition(
        appElement,
        Float(mouse.x + sampleOffset.x),
        Float(mouse.y + sampleOffset.y),
        &element
      )

      guard result == .success, let hitElement = element else {
        continue
      }

      var currentElement: AXUIElement? = hitElement
      for _ in 0..<3 {
        guard let current = currentElement else {
          break
        }

        let elementHash = CFHash(current)
        if !visitedElements.contains(elementHash) {
          visitedElements.insert(elementHash)
          collectAXTargets(
            from: current,
            mouse: mouse,
            depth: 0,
            maxDepth: 1,
            targets: &targets
          )
        }
        if targets.count >= pointerAssistMaxTargets {
          return targets
        }

        currentElement = axParent(current)
      }
    }
  }

  return targets
}

func deduplicateTargets(_ targets: [[String: Any]]) -> [[String: Any]] {
  var seen = Set<String>()
  var uniqueTargets: [[String: Any]] = []

  for target in targets {
    guard let id = target["id"] as? String else {
      uniqueTargets.append(target)
      continue
    }

    if seen.contains(id) {
      continue
    }

    seen.insert(id)
    uniqueTargets.append(target)
  }

  return uniqueTargets
}

func collectWindowEdgeTargets(mouse: CGPoint) -> [[String: Any]] {
  guard
    let windowList = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements],
      kCGNullWindowID
    ) as? [[String: Any]]
  else {
    return []
  }

  var targets: [[String: Any]] = []
  let edgeThickness: CGFloat = 8

  for windowInfo in windowList.prefix(120) {
    let layer = windowInfo[kCGWindowLayer as String] as? Int ?? 0
    let alpha = windowInfo[kCGWindowAlpha as String] as? Double ?? 1
    guard layer == 0 && alpha > 0.05 else {
      continue
    }

    guard let boundsValue = windowInfo[kCGWindowBounds as String] else {
      continue
    }

    let boundsDictionary = boundsValue as! CFDictionary
    guard let bounds = CGRect(dictionaryRepresentation: boundsDictionary) else {
      continue
    }

    guard bounds.width > 80 && bounds.height > 60 else {
      continue
    }

    let windowId = windowInfo[kCGWindowNumber as String] as? Int ?? 0
    let edges = [
      ("top", CGRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: edgeThickness)),
      ("bottom", CGRect(x: bounds.minX, y: bounds.maxY - edgeThickness, width: bounds.width, height: edgeThickness)),
      ("left", CGRect(x: bounds.minX, y: bounds.minY, width: edgeThickness, height: bounds.height)),
      ("right", CGRect(x: bounds.maxX - edgeThickness, y: bounds.minY, width: edgeThickness, height: bounds.height)),
    ]

    for (edgeName, edgeRect) in edges where rectIsNearPoint(edgeRect, mouse, radius: pointerAssistScanRadius) {
      targets.append(
        rectPayload(
          edgeRect,
          id: "window-edge:\(windowId):\(edgeName)",
          kind: "window-edge",
          role: "window-edge",
          priority: 0.7
        )
      )
    }
  }

  return targets
}

func emitPointerAssistTargets() {
  let mouse = topLeftMouseLocation()
  let scanStartedAt = Date().timeIntervalSinceReferenceDate
  if
    let lastMouse = pointerAssistLastScanMouse,
    squaredDistanceToRect(mouse, CGRect(x: lastMouse.x, y: lastMouse.y, width: 1, height: 1)) < 9,
    scanStartedAt - pointerAssistLastScanAt < 0.75
  {
    return
  }
  pointerAssistLastScanMouse = mouse
  pointerAssistLastScanAt = scanStartedAt
  let processIdentifiers = windowOwnerProcessIdentifiersNearMouse(mouse: mouse)
  var targets = collectWindowEdgeTargets(mouse: mouse)

  if targets.count < pointerAssistMaxTargets {
    targets.append(
      contentsOf: collectHitTestAXTargets(
        processIdentifiers: processIdentifiers,
        mouse: mouse
      )
    )
  }

  targets = deduplicateTargets(targets)
  let now = Date().timeIntervalSinceReferenceDate
  for target in targets {
    guard let id = target["id"] as? String else {
      continue
    }
    pointerAssistRecentTargets[id] = (payload: target, seenAt: now)
  }
  pointerAssistRecentTargets = pointerAssistRecentTargets.filter {
    now - $0.value.seenAt <= 1.2
  }
  let recentTargets = pointerAssistRecentTargets.values
    .map { $0.payload }
    .sorted {
      ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "")
    }

  output.write([
    "type": "pointer-assist-targets",
    "trusted": AXIsProcessTrusted(),
    "processIds": processIdentifiers.map { Int($0) },
    "scanDurationMs": Int(
      (Date().timeIntervalSinceReferenceDate - scanStartedAt) * 1000
    ),
    "targets": Array(recentTargets.prefix(pointerAssistMaxTargets)),
  ])
}

func startPointerAssistSupport() {
  pointerAssistTimer?.invalidate()
  pointerAssistTimer = Timer(timeInterval: 0.1, repeats: true) { _ in
    emitPointerAssistTargets()
  }
  RunLoop.current.add(pointerAssistTimer!, forMode: .default)
}

func isLikelyRemoteTouchSurface(width: Int32, height: Int32, deviceId: UInt64) -> Bool {
  guard width > 0, height > 0 else {
    return false
  }

  let locationId = Int(deviceId)
  if remoteDeviceIdentifierForLocation(locationId) != nil {
    return true
  }

  let sizeDelta = abs(width - height)
  let squareTolerance = max(80, min(width, height) / 20)

  return width >= 1500 &&
    width <= 5000 &&
    height >= 1500 &&
    height <= 5000 &&
    sizeDelta <= squareTolerance
}

let multitouchFrameReceived: MTFrameCallback = { device, touches, touchCount, _, frame in
  guard touchCount > 0 else {
    return
  }

  var deviceId: UInt64 = 0
  _ = MTDeviceGetDeviceID(device, &deviceId)

  var width: Int32 = 0
  var height: Int32 = 0
  _ = MTDeviceGetSensorSurfaceDimensions(device, &width, &height)

  guard isLikelyRemoteTouchSurface(width: width, height: height, deviceId: deviceId) else {
    return
  }

  let remoteDeviceId = remoteDeviceIdentifierForLocation(Int(deviceId))
  let touchPointer = touches.bindMemory(to: MTTouch.self, capacity: touchCount)

  for index in 0..<touchCount {
    let touch = touchPointer[index]
    let touchId = touch.pathIndex != 0 ? touch.pathIndex : touch.fingerID

    output.write([
      "type": "touchpad",
      "deviceId": remoteDeviceId ?? "",
      "mtDeviceId": NSNumber(value: deviceId),
      "frame": frame,
      "touchId": Int(touchId),
      "state": Int(touch.state),
      "x": Double(touch.normalizedVector.position.x),
      "y": Double(touch.normalizedVector.position.y),
      "velocityX": Double(touch.normalizedVector.velocity.x),
      "velocityY": Double(touch.normalizedVector.velocity.y),
      "size": Double(touch.zTotal),
      "width": Int(width),
      "height": Int(height),
    ])
  }
}

func startMultitouchSupport() {
  guard let devices = MTDeviceCreateList() else {
    output.write([
      "type": "touchpad-error",
      "message": "MTDeviceCreateList returned no devices",
    ])
    return
  }

  multitouchDeviceList = devices

  let count = CFArrayGetCount(devices)
  for index in 0..<count {
    guard let rawDevice = CFArrayGetValueAtIndex(devices, index) else {
      continue
    }

    let device = UnsafeMutableRawPointer(mutating: rawDevice)
    var deviceId: UInt64 = 0
    _ = MTDeviceGetDeviceID(device, &deviceId)

    var width: Int32 = 0
    var height: Int32 = 0
    _ = MTDeviceGetSensorSurfaceDimensions(device, &width, &height)

    guard isLikelyRemoteTouchSurface(width: width, height: height, deviceId: deviceId) else {
      continue
    }

    guard registeredMultitouchDeviceIds.insert(deviceId).inserted else {
      continue
    }

    MTRegisterContactFrameCallback(device, multitouchFrameReceived)
    let startResult = MTDeviceStart(device, 0)
    multitouchDevices.append(device)

    output.write([
      "type": "touchpad-ready",
      "deviceId": remoteDeviceIdentifierForLocation(Int(deviceId)) ?? "",
      "mtDeviceId": NSNumber(value: deviceId),
      "width": Int(width),
      "height": Int(height),
      "startResult": Int(startResult),
    ])
  }
}

func startMultitouchScanTimer() {
  multitouchScanTimer?.invalidate()
  multitouchScanTimer = Timer(timeInterval: 1.0, repeats: true) { _ in
    startMultitouchSupport()
  }
  RunLoop.current.add(multitouchScanTimer!, forMode: .default)
}

let inputReportReceived: IOHIDReportCallback = { context, result, _, _, reportId, report, reportLength in
  guard
    result == kIOReturnSuccess,
    let context
  else {
    return
  }

  let reportContext = Unmanaged<InputReportContext>
    .fromOpaque(context)
    .takeUnretainedValue()
  let bytes = Array(UnsafeBufferPointer(start: report, count: reportLength))

  output.write([
    "type": "raw-input",
    "deviceId": deviceIdentifier(reportContext.device),
    "serviceId": serviceIdentifier(reportContext.device),
    "reportId": Int(reportId),
    "bytes": bytes,
  ])
}

func registerInputReportCallback(_ device: IOHIDDevice) {
  let serviceId = serviceIdentifier(device)
  if inputReportContexts[serviceId] != nil {
    return
  }

  let size = integerProperty(device, kIOHIDMaxInputReportSizeKey)
  let context = InputReportContext(device: device, size: size)
  inputReportContexts[serviceId] = context

  IOHIDDeviceRegisterInputReportCallback(
    device,
    context.buffer,
    context.size,
    inputReportReceived,
    Unmanaged.passUnretained(context).toOpaque()
  )
}

let deviceMatched: IOHIDDeviceCallback = { _, _, _, device in
  registerInputReportCallback(device)
  output.write([
    "type": "device-connected",
    "device": devicePayload(device),
  ])
  startMultitouchSupport()
}

let deviceRemoved: IOHIDDeviceCallback = { _, _, _, device in
  inputReportContexts.removeValue(forKey: serviceIdentifier(device))
  output.write([
    "type": "device-disconnected",
    "deviceId": deviceIdentifier(device),
    "serviceId": serviceIdentifier(device),
  ])
}

let inputValueReceived: IOHIDValueCallback = { _, _, _, value in
  let element = IOHIDValueGetElement(value)
  let device = IOHIDElementGetDevice(element)
  let usagePage = Int(IOHIDElementGetUsagePage(element))
  let usage = Int(IOHIDElementGetUsage(element))
  let cookie = Int(IOHIDElementGetCookie(element))
  let reportId = Int(IOHIDElementGetReportID(element))
  let value = IOHIDValueGetIntegerValue(value)
  let intValue = Int(truncatingIfNeeded: value)
  let elementKey = "\(usagePage):\(usage):\(cookie):\(reportId)"

  output.write([
    "type": "input",
    "deviceId": deviceIdentifier(device),
    "serviceId": serviceIdentifier(device),
    "eventKey": elementKey,
    "usagePage": usagePage,
    "usage": usage,
    "cookie": cookie,
    "reportId": reportId,
    "value": intValue,
    "logicalMin": IOHIDElementGetLogicalMin(element),
    "logicalMax": IOHIDElementGetLogicalMax(element),
    "isRelative": IOHIDElementIsRelative(element),
  ])
}

if pointerAssistMode {
  startPointerAssistSupport()
  emitPointerAssistTargets()
  output.write(["type": "ready", "mode": "pointer-assist"])
  CFRunLoopRun()
} else {
  IOHIDManagerSetDeviceMatchingMultiple(manager, remoteHidMatchingDictionaries as CFArray)
  IOHIDManagerRegisterDeviceMatchingCallback(manager, deviceMatched, nil)
  IOHIDManagerRegisterDeviceRemovalCallback(manager, deviceRemoved, nil)
  IOHIDManagerRegisterInputValueCallback(manager, inputValueReceived, nil)
  IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

  let openResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
  if openResult != kIOReturnSuccess {
    let fallbackOpenResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
    if fallbackOpenResult != kIOReturnSuccess {
      output.write([
        "type": "error",
        "message": "IOHIDManagerOpen failed",
        "code": Int(fallbackOpenResult),
        "seizeCode": Int(openResult),
      ])
      exit(1)
    }

    output.write([
      "type": "warning",
      "message": "Apple Remote opened without exclusive access; original system media actions may still fire.",
      "code": Int(openResult),
    ])
  }

  if let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> {
    for device in devices {
      registerInputReportCallback(device)
      output.write([
        "type": "device-connected",
        "device": devicePayload(device),
      ])
    }
  }

  startMultitouchSupport()
  startMultitouchScanTimer()
  output.write(["type": "ready", "mode": "apple-remote"])
  CFRunLoopRun()
}
