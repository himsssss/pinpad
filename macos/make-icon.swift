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
  // Flat lime tile (the design system avoids gradients) with a soft macOS-style drop shadow.
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor.black.withAlphaComponent(0.22).cgColor)
  ctx.addPath(shape)
  ctx.setFillColor(NSColor(srgbRed: 0.624, green: 0.910, blue: 0.439, alpha: 1).cgColor)
  ctx.fillPath()
  ctx.restoreGState()

  // The pushpin mark, drawn in the same 32-unit, y-down space as the web logo's SVG.
  let unit: CGFloat = 824 / 32
  ctx.saveGState()
  ctx.translateBy(x: 100, y: 924)
  ctx.scaleBy(x: unit, y: -unit)
  ctx.translateBy(x: 16, y: 16)
  ctx.rotate(by: 35 * .pi / 180)
  ctx.translateBy(x: -16, y: -16)
  let forest = NSColor(srgbRed: 0.086, green: 0.2, blue: 0, alpha: 1).cgColor
  ctx.setFillColor(forest)
  ctx.addPath(CGPath(roundedRect: CGRect(x: 10.5, y: 5, width: 11, height: 3), cornerWidth: 1.5, cornerHeight: 1.5, transform: nil))
  ctx.move(to: CGPoint(x: 13.2, y: 8))
  ctx.addLine(to: CGPoint(x: 18.8, y: 8))
  ctx.addLine(to: CGPoint(x: 19.8, y: 14.5))
  ctx.addLine(to: CGPoint(x: 12.2, y: 14.5))
  ctx.closePath()
  ctx.addPath(CGPath(roundedRect: CGRect(x: 7.75, y: 14.5, width: 16.5, height: 3.5), cornerWidth: 1.75, cornerHeight: 1.75, transform: nil))
  ctx.fillPath()
  ctx.setStrokeColor(forest)
  ctx.setLineWidth(1.8)
  ctx.setLineCap(.round)
  ctx.move(to: CGPoint(x: 16, y: 18))
  ctx.addLine(to: CGPoint(x: 16, y: 27.5))
  ctx.strokePath()
  ctx.restoreGState()

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
  try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
  try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
