// Vision text detection only. No click, keyboard event, network, or app state.
// Input: exact window screenshot PNG path. Output: one bounded JSON object.
import Foundation
import ImageIO
import Vision

struct Row: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}
struct Result: Encodable {
    let width: Int
    let height: Int
    let rows: [Row]
}

guard CommandLine.arguments.count == 2,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Native OCR: unreadable screenshot\n", stderr)
    exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: image, options: [:])
do { try handler.perform([request]) }
catch { fputs("Native OCR failed: \(error)\n", stderr); exit(3) }
let rows: [Row] = (request.results ?? []).prefix(300).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let rect = observation.boundingBox
    return Row(text: candidate.string, confidence: candidate.confidence,
               x: Double(rect.minX) * Double(image.width),
               y: (1 - Double(rect.maxY)) * Double(image.height),
               width: Double(rect.width) * Double(image.width),
               height: Double(rect.height) * Double(image.height))
}
do {
    let output = try JSONEncoder().encode(Result(width: image.width, height: image.height, rows: rows))
    FileHandle.standardOutput.write(output)
} catch { fputs("Native OCR JSON failed: \(error)\n", stderr); exit(4) }
