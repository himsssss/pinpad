// Native macOS shell for Pinpad: an AppKit window hosting a WKWebView that
// loads the built web app from the bundle's Resources/web folder.

import Cocoa
import Network
import UniformTypeIdentifiers
import WebKit

/// Pages are served from a custom scheme so they get a stable origin (IndexedDB and
/// localStorage persist between launches) without running a local server. The scheme keeps
/// the app's original name: changing it would change the origin and hide saved boards.
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

/// Serves a one-line wrapper page on 127.0.0.1 that frames a media player. YouTube and other
/// players refuse to play inside the app's custom-scheme page (it sends no referrer), but play
/// fine inside an http://127.0.0.1 page. Only players from known media hosts are framed.
final class EmbedServer: @unchecked Sendable {
  /// Mirrors EMBED_HOSTS in src/media.ts.
  private static let allowedHosts: Set<String> = [
    "www.youtube-nocookie.com", "player.vimeo.com", "www.loom.com", "www.dailymotion.com", "fast.wistia.net",
    "streamable.com", "player.twitch.tv", "clips.twitch.tv", "www.facebook.com", "play.vidyard.com",
    "w.soundcloud.com", "open.spotify.com", "player-widget.mixcloud.com",
  ]
  private var listener: NWListener?
  private var reported = false

  /// Starts listening on a free loopback port and reports it once (nil if it couldn't start).
  func start(onReady: @escaping @Sendable (UInt16?) -> Void) {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
    guard let listener = try? NWListener(using: params) else { return onReady(nil) }
    self.listener = listener
    listener.newConnectionHandler = { Self.respond(on: $0) }
    listener.stateUpdateHandler = { [weak self] state in
      guard let self, !self.reported else { return }
      switch state {
      case .ready: self.reported = true; onReady(listener.port?.rawValue)
      case .failed, .cancelled: self.reported = true; onReady(nil)
      default: break
      }
    }
    listener.start(queue: .global(qos: .userInitiated))
  }

  private static func respond(on connection: NWConnection) {
    connection.start(queue: .global(qos: .userInitiated))
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, _, _ in
      let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      let target = request.split(separator: " ", maxSplits: 2).dropFirst().first.map(String.init) ?? ""
      let (status, body) = page(for: target)
      let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
      connection.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
  }

  private static func page(for target: String) -> (String, String) {
    guard let components = URLComponents(string: "http://127.0.0.1" + target), components.path == "/embed",
      let src = components.queryItems?.first(where: { $0.name == "src" })?.value,
      let url = URL(string: src), url.scheme == "https", let host = url.host?.lowercased(), allowedHosts.contains(host)
    else { return ("404 Not Found", "Not found") }
    let attr = src.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "<", with: "&lt;")
    let html = """
      <!doctype html><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">\
      <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>\
      <iframe src="\(attr)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen></iframe>
      """
    return ("200 OK", html)
  }
}

/// Fetches a web page's HTML for link previews, which the page can't read across origins.
/// Exposed to the page as `window.pinpadNative.fetchPage(url)`.
final class PageFetcher: NSObject, WKScriptMessageHandlerWithReply {
  static let script = """
    window.pinpadNative = { fetchPage: (url) => window.webkit.messageHandlers.fetchPage.postMessage(String(url)) };
    """
  private static let maxBytes = 1_500_000
  private static let userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 PinpadLinkPreview"

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    guard let string = message.body as? String, let url = URL(string: string),
      url.scheme == "https" || url.scheme == "http"
    else {
      replyHandler(nil, nil)
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
    request.setValue("text/html", forHTTPHeaderField: "Accept")
    URLSession.shared.dataTask(with: request) { data, response, _ in
      var result: [String: String]?
      if let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
        let slice = data.prefix(Self.maxBytes)
        let html = String(data: slice, encoding: .utf8) ?? String(decoding: slice, as: UTF8.self)
        result = ["url": http.url?.absoluteString ?? string, "html": html]
      }
      DispatchQueue.main.async { replyHandler(result, nil) }
    }.resume()
  }
}

/// Keeps the workspace as a JSON file in a folder the user picks (Documents/Pinpad by
/// default), so boards can live in a synced or backed-up folder. Exposed to the page as
/// `window.pinpadNative.storage`; the Windows app's preload offers the same calls.
@MainActor
final class StorageBridge: NSObject, WKScriptMessageHandlerWithReply {
  static let script = """
    (() => {
      const call = (op, arg) => window.webkit.messageHandlers.storage.postMessage({ op, arg: arg ?? null });
      window.pinpadNative = Object.assign(window.pinpadNative || {}, { storage: {
        location: () => call('location'),
        inspect: (folder) => call('inspect', folder),
        read: () => call('read'),
        write: (text) => call('write', text),
        choose: () => call('choose'),
        use: (folder) => call('use', folder),
        reveal: () => call('reveal'),
      } });
    })();
    """
  static let fileName = "Pinpad Workspace.json"
  private static let folderKey = "StorageFolder"

  private var defaultFolder: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Pinpad")
  }
  private var folder: URL {
    UserDefaults.standard.string(forKey: Self.folderKey).map { URL(fileURLWithPath: $0) } ?? defaultFolder
  }
  private var file: URL { folder.appendingPathComponent(Self.fileName) }

  private func location() -> [String: Any] {
    [
      "folder": folder.path, "file": file.path, "defaultFolder": defaultFolder.path,
      "isDefault": folder.standardizedFileURL == defaultFolder.standardizedFileURL,
      "exists": FileManager.default.fileExists(atPath: file.path),
    ]
  }

  /// Reads and writes run off the main thread, in order, so a large workspace (or macOS asking
  /// for folder access the first time) doesn't freeze the window.
  private let ioQueue = DispatchQueue(label: "pinpad.storage")

  private func onIOQueue(
    _ replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void,
    _ work: @escaping @Sendable () throws -> Any
  ) {
    ioQueue.async {
      let result = Result { try work() }
      DispatchQueue.main.async {
        switch result {
        case .success(let value): replyHandler(value, nil)
        case .failure(let error): replyHandler(nil, error.localizedDescription)
        }
      }
    }
  }

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
      replyHandler(nil, "Bad storage request")
      return
    }
    let arg = body["arg"] as? String
    switch op {
    case "location":
      replyHandler(location(), nil)
    case "inspect":
      let path = URL(fileURLWithPath: arg ?? folder.path).appendingPathComponent(Self.fileName).path
      replyHandler(["hasWorkspace": FileManager.default.fileExists(atPath: path)], nil)
    case "read":
      let file = file
      onIOQueue(replyHandler) {
        FileManager.default.fileExists(atPath: file.path) ? try String(contentsOf: file, encoding: .utf8) as Any : NSNull()
      }
    case "write":
      let (folder, file, data) = (folder, file, Data((arg ?? "").utf8))
      onIOQueue(replyHandler) {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
        return true
      }
    case "choose":
      let panel = NSOpenPanel()
      panel.canChooseDirectories = true
      panel.canChooseFiles = false
      panel.canCreateDirectories = true
      panel.prompt = "Use This Folder"
      panel.message = "Choose where Pinpad keeps your boards"
      panel.directoryURL = folder
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        replyHandler(response == .OK ? panel.url?.path as Any : NSNull(), nil)
      }
      if let window = message.webView?.window { panel.beginSheetModal(for: window, completionHandler: finish) }
      else { finish(panel.runModal()) }
    case "use":
      if let arg, URL(fileURLWithPath: arg).standardizedFileURL != defaultFolder.standardizedFileURL {
        UserDefaults.standard.set(arg, forKey: Self.folderKey)
      } else {
        UserDefaults.standard.removeObject(forKey: Self.folderKey)
      }
      replyHandler(location(), nil)
    case "reveal":
      if FileManager.default.fileExists(atPath: file.path) {
        NSWorkspace.shared.activateFileViewerSelecting([file])
      } else {
        NSWorkspace.shared.open(folder)
      }
      replyHandler(true, nil)
    default:
      replyHandler(nil, "Unknown storage request \(op)")
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var titleObservation: NSKeyValueObservation?
  private let embedServer = EmbedServer()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMainMenu()

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
    config.setURLSchemeHandler(BundleSchemeHandler(root: webRoot), forURLScheme: appScheme)
    config.userContentController.add(ConsoleLogger(), name: "console")
    config.userContentController.addScriptMessageHandler(PageFetcher(), contentWorld: .page, name: "fetchPage")
    config.userContentController.addUserScript(
      WKUserScript(source: PageFetcher.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // After PageFetcher's script, which creates window.pinpadNative.
    config.userContentController.addScriptMessageHandler(StorageBridge(), contentWorld: .page, name: "storage")
    config.userContentController.addUserScript(
      WKUserScript(source: StorageBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
    window.title = "Pinpad"
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

    // Load once the media wrapper server reports its port (the page reads it at startup).
    let controller = config.userContentController
    embedServer.start { port in
      DispatchQueue.main.async {
        if let port {
          controller.addUserScript(WKUserScript(
            source: "window.pinpadNative && (window.pinpadNative.embedBase = 'http://127.0.0.1:\(port)');",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        self.webView.load(URLRequest(url: startURL))
      }
    }
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
    let name = "Pinpad"

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
