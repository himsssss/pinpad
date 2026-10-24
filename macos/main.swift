// Native macOS shell for the Milanote clone: an AppKit window hosting a WKWebView that
// loads the built web app from the bundle's Resources/web folder.

import Cocoa
import UniformTypeIdentifiers
import WebKit

/// Pages are served from a custom scheme so they get a stable origin (IndexedDB and
/// localStorage persist between launches) without running a local server.
let appScheme = "milanote"
let startURL = URL(string: "\(appScheme)://app/index.html")!

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private let root: URL

  init(root: URL) {
    self.root = root.standardizedFileURL
  }

  private static let mimeTypes = [
    "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
    "svg": "image/svg+xml", "png": "image/png", "woff2": "font/woff2", "woff": "font/woff",
  ]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
    let file = root.appendingPathComponent(path).standardizedFileURL
    // Only serve files inside the web folder.
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
      task.didReceive(Data())
      task.didFinish()
      return
    }
    let ext = file.pathExtension.lowercased()
    let mime = Self.mimeTypes[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Forwards the page's console errors and uncaught exceptions to the system log (Console.app).
final class ConsoleLogger: NSObject, WKScriptMessageHandler {
  static let script = """
    (() => {
      const send = (level, args) => {
        try { window.webkit.messageHandlers.console.postMessage(level + ': ' + args.map(String).join(' ')); } catch {}
      };
      for (const level of ['error', 'warn', 'log']) {
        const original = console[level];
        console[level] = (...args) => { send(level, args); original.apply(console, args); };
      }
      window.addEventListener('error', (e) => send('uncaught', [e.message, e.filename + ':' + e.lineno]));
      window.addEventListener('unhandledrejection', (e) => send('unhandled rejection', [e.reason && (e.reason.stack || e.reason)]));
    })();
    """

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    NSLog("[web] %@", String(describing: message.body))
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var titleObservation: NSKeyValueObservation?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMainMenu()

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
    config.setURLSchemeHandler(BundleSchemeHandler(root: webRoot), forURLScheme: appScheme)
    config.userContentController.add(ConsoleLogger(), name: "console")
    config.userContentController.addUserScript(
      WKUserScript(source: ConsoleLogger.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))

    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isInspectable = true
    webView.allowsMagnification = false

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Milanote Clone"
    window.minSize = NSSize(width: 640, height: 480)
    window.tabbingMode = .disallowed
    window.contentView = webView
    window.setFrameAutosaveName("MainWindow")
    if !window.setFrameUsingName("MainWindow") { window.center() }

    titleObservation = webView.observe(\.title, options: [.new]) { [weak self] webView, _ in
      MainActor.assumeIsolated {
        if let title = webView.title, !title.isEmpty { self?.window.title = title }
      }
    }

    webView.load(URLRequest(url: startURL))
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  /// Gives the page a moment to write its last pending change to IndexedDB before quitting.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let webView else { return .terminateNow }
    var replied = false
    let reply = {
      if replied { return }
      replied = true
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    webView.callAsyncJavaScript("await window.__flushSave?.()", arguments: [:], in: nil, in: .page) { _ in reply() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { reply() }
    return .terminateLater
  }

  // MARK: Navigation

  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    if action.shouldPerformDownload {
      decisionHandler(.download)
    } else if let url = action.request.url, url.scheme != appScheme, action.targetFrame?.isMainFrame ?? true {
      // Links to the web open in the default browser.
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  /// `target="_blank"` links.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  // MARK: Downloads (workspace export)

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping @MainActor (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.canCreateDirectories = true
    panel.beginSheetModal(for: window) { response in
      guard response == .OK, let url = panel.url else { return completionHandler(nil) }
      // WebKit refuses to overwrite, so clear the way for a confirmed replace.
      try? FileManager.default.removeItem(at: url)
      completionHandler(url)
    }
  }

  // MARK: File pickers and dialogs

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor () -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor (Bool) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
  }

  // MARK: Menu

  @objc private func undoInPage(_ sender: Any?) {
    webView.evaluateJavaScript("window.__undo?.()")
  }

  @objc private func redoInPage(_ sender: Any?) {
    webView.evaluateJavaScript("window.__redo?.()")
  }

  private func makeMainMenu() -> NSMenu {
    let main = NSMenu()
    let name = "Milanote Clone"

    func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      let holder = NSMenuItem()
      holder.submenu = menu
      main.addItem(holder)
      return menu
    }
    func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      return i
    }

    _ = submenu(name, [
      item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"),
    ])
    _ = submenu("File", [
      item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
    ])
    // Standard editing items give the web view ⌘C/⌘V/⌘X/⌘A. The page handles ⌘Z itself;
    // Undo/Redo chosen from the menu are forwarded to its board-level history.
    _ = submenu("Edit", [
      item("Undo", #selector(undoInPage(_:)), "z"),
      item("Redo", #selector(redoInPage(_:)), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select All", #selector(NSText.selectAll(_:)), "a"),
    ])
    _ = submenu("View", [
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    let windowMenu = submenu("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
    ])
    NSApp.windowsMenu = windowMenu
    return main
  }
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  let delegate = AppDelegate()
  app.delegate = delegate
  app.setActivationPolicy(.regular)
  app.run()
}
