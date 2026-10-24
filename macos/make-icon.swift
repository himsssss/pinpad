// Renders the app icon into an .iconset folder: `swift make-icon.swift <out.iconset>`.
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext
  let s = CGFloat(px) / 1024
  ctx.scaleBy(x: s, y: s)

  // macOS icon grid: an 824pt rounded square centered on a 1024pt canvas.
  let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  let shape = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor.black.withAlphaComponent(0.28).cgColor)
  ctx.addPath(shape)
  ctx.setFillColor(NSColor(srgbRed: 0.91, green: 0.38, blue: 0.24, alpha: 1).cgColor)
  ctx.fillPath()
  ctx.restoreGState()

  ctx.saveGState()
  ctx.addPath(shape)
  ctx.clip()
  let gradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(srgbRed: 0.96, green: 0.48, blue: 0.31, alpha: 1).cgColor,
      NSColor(srgbRed: 0.87, green: 0.32, blue: 0.19, alpha: 1).cgColor,
    ] as CFArray,
    locations: [0, 1])!
  ctx.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
  ctx.restoreGState()

  // The "M" mark from the web favicon (a 32-unit design), flipped into CoreGraphics' y-up space.
  let unit: CGFloat = 824 / 32
  func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: 100 + x * unit, y: 924 - y * unit) }
  ctx.move(to: p(8, 23))
  ctx.addLine(to: p(8, 9))
  ctx.addLine(to: p(16, 17))
  ctx.addLine(to: p(24, 9))
  ctx.addLine(to: p(24, 23))
  ctx.setStrokeColor(NSColor.white.cgColor)
  ctx.setLineWidth(3.2 * unit)
  ctx.setLineJoin(.round)
  ctx.setLineCap(.round)
  ctx.strokePath()

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
  try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
  try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
