// Native macOS shell for Pinpad: an AppKit window hosting a WKWebView that
// loads the built web app from the bundle's Resources/web folder.

import Cocoa
import CryptoKit
import Network
import Security
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
    "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
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

/// Keeps the workspace as files in a folder the user picks (Documents/Pinpad by default):
/// an index plus one JSON file per board, laid out by src/workspaceFiles.ts, so boards can
/// live in a synced or backed-up folder. Exposed to the page as `window.pinpadNative.storage`;
/// the Windows app's preload offers the same calls. Paths from the page are relative to the
/// folder, with / separators.
@MainActor
final class StorageBridge: NSObject, WKScriptMessageHandlerWithReply {
  static let script = """
    (() => {
      const call = (op, arg) => window.webkit.messageHandlers.storage.postMessage({ op, arg: arg ?? null });
      window.pinpadNative = Object.assign(window.pinpadNative || {}, { storage: {
        location: () => call('location'),
        inspect: (folder) => call('inspect', folder),
        read: (paths) => call('read', paths),
        write: (batch) => call('write', batch),
        list: () => call('list'),
        writeFile: (file) => call('writeFile', file),
        readFile: (path) => call('readFile', path),
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

  struct StorageError: LocalizedError {
    let errorDescription: String?
  }

  /// A page-supplied relative path inside the folder; anything else is refused.
  nonisolated private static func resolve(_ relative: String, in folder: URL) throws -> URL {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    guard relative.hasSuffix(".json"), !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." || $0.contains(":") })
    else { throw StorageError(errorDescription: "Bad workspace path \(relative)") }
    return parts.reduce(folder) { $0.appendingPathComponent(String($1)) }
  }

  /// A page-supplied path to an attached file: only inside the Attachments folder.
  nonisolated private static func resolveAttachment(_ relative: String, in folder: URL) throws -> URL {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, parts[0] == "Attachments", !parts[1].isEmpty, !parts[1].hasPrefix("."), !parts[1].contains(":")
    else { throw StorageError(errorDescription: "Bad attachment path \(relative)") }
    return folder.appendingPathComponent("Attachments").appendingPathComponent(String(parts[1]))
  }

  /// Removes folders left empty by a moved or deleted board, up to the storage folder.
  nonisolated private static func pruneEmpty(above file: URL, in folder: URL) {
    let fm = FileManager.default
    var dir = file.deletingLastPathComponent().standardizedFileURL
    let root = folder.standardizedFileURL.path
    while dir.path.hasPrefix(root + "/") {
      guard let entries = try? fm.contentsOfDirectory(atPath: dir.path),
        entries.allSatisfy({ $0 == ".DS_Store" })
      else { return }
      try? fm.removeItem(at: dir)
      dir = dir.deletingLastPathComponent()
    }
  }

  /// Every board file and folder in the storage folder with when it last changed, so the page
  /// notices changes made outside Pinpad. Files iCloud Drive has offloaded show up as
  /// ".Name.json.icloud"; they're listed as pending and asked to download. Bounded, in case the
  /// folder is a big synced one.
  nonisolated private static func list(_ folder: URL) -> [[String: Any]] {
    let fm = FileManager.default
    let keys: [URLResourceKey] = [.isDirectoryKey, .contentModificationDateKey]
    guard let walker = fm.enumerator(at: folder, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants])
    else { return [] }
    let root = folder.path.hasSuffix("/") ? folder.path : folder.path + "/"
    var out: [[String: Any]] = []
    for case let url as URL in walker {
      if out.count >= 5000 { break }
      guard url.path.hasPrefix(root) else { continue }
      let values = try? url.resourceValues(forKeys: Set(keys))
      let isDir = values?.isDirectory == true
      if isDir && walker.level >= 9 { walker.skipDescendants() }
      let name = url.lastPathComponent
      let dir = String(url.deletingLastPathComponent().path.dropFirst(root.count))
      let join = { (file: String) in dir.isEmpty ? file : "\(dir)/\(file)" }
      let modified = (values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
      if dir.isEmpty && name == "Attachments" {
        // Files attached to cards, not boards; the page reads them one at a time.
        if isDir { walker.skipDescendants() }
        continue
      } else if name.hasPrefix(".") {
        if isDir { walker.skipDescendants() }
        guard name.hasSuffix(".json.icloud") else { continue }
        let real = String(name.dropFirst().dropLast(".icloud".count))
        try? fm.startDownloadingUbiquitousItem(at: url.deletingLastPathComponent().appendingPathComponent(real))
        out.append(["path": join(real), "modified": modified, "pending": true])
      } else if name.contains(":") {
        continue
      } else if isDir {
        out.append(["path": join(name), "modified": 0, "dir": true])
      } else if name.hasSuffix(".json") {
        out.append(["path": join(name), "modified": modified])
      }
    }
    return out
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
    let raw = body["arg"]
    let arg = raw as? String
    switch op {
    case "location":
      replyHandler(location(), nil)
    case "inspect":
      let path = URL(fileURLWithPath: arg ?? folder.path).appendingPathComponent(Self.fileName).path
      replyHandler(["hasWorkspace": FileManager.default.fileExists(atPath: path)], nil)
    case "read":
      let (folder, paths) = (folder, raw as? [String] ?? [])
      onIOQueue(replyHandler) {
        var out: [String: Any] = [:]
        for path in paths {
          let url = try Self.resolve(path, in: folder)
          out[path] = FileManager.default.fileExists(atPath: url.path) ? try String(contentsOf: url, encoding: .utf8) : NSNull()
        }
        return out
      }
    case "list":
      let folder = folder
      onIOQueue(replyHandler) { Self.list(folder) }
    case "writeFile":
      // An attached file (PDF, video…), sent as base64, kept beside the boards.
      let file = raw as? [String: Any] ?? [:]
      let (folder, path, data) = (folder, file["path"] as? String ?? "", file["data"] as? String ?? "")
      onIOQueue(replyHandler) {
        let url = try Self.resolveAttachment(path, in: folder)
        guard let bytes = Data(base64Encoded: data) else { throw StorageError(errorDescription: "Bad file data") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url, options: .atomic)
        return true
      }
    case "readFile":
      let (folder, path) = (folder, arg ?? "")
      onIOQueue(replyHandler) {
        let url = try Self.resolveAttachment(path, in: folder)
        guard let bytes = try? Data(contentsOf: url) else { return NSNull() }
        return bytes.base64EncodedString()
      }
    case "write":
      let batch = raw as? [String: Any] ?? [:]
      let folder = folder
      let writes = batch["write"] as? [[String]] ?? []
      let (remove, trash) = (batch["remove"] as? [String] ?? [], batch["trash"] as? [String] ?? [])
      onIOQueue(replyHandler) {
        let fm = FileManager.default
        for pair in writes where pair.count == 2 {
          let url = try Self.resolve(pair[0], in: folder)
          try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
          try Data(pair[1].utf8).write(to: url, options: .atomic)
        }
        for path in remove {
          let url = try Self.resolve(path, in: folder)
          if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
          Self.pruneEmpty(above: url, in: folder)
        }
        for path in trash {
          let url = try Self.resolve(path, in: folder)
          if fm.fileExists(atPath: url.path) { try fm.trashItem(at: url, resultingItemURL: nil) }
          Self.pruneEmpty(above: url, in: folder)
        }
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
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      NSWorkspace.shared.open(folder)
      replyHandler(true, nil)
    default:
      replyHandler(nil, "Unknown storage request \(op)")
    }
  }
}

/// Google sign-in for saving boards to Google Drive, using Google's flow for installed apps:
/// the default browser opens Google's consent page, which redirects back to a one-off
/// loopback address with a code (PKCE). The refresh token is kept in the Keychain so later
/// launches get access tokens without asking again. Exposed as `window.pinpadNative.google`;
/// mirrors google() in desktop/main.cjs.
@MainActor
final class GoogleAuth: NSObject, WKScriptMessageHandlerWithReply {
  static let script = """
    (() => {
      const call = (op, config) => window.webkit.messageHandlers.google.postMessage({ op, config: config ?? null });
      window.pinpadNative = Object.assign(window.pinpadNative || {}, { google: {
        signIn: (config) => call('signIn', config),
        token: (config) => call('token', config),
        signOut: (config) => call('signOut', config),
      } });
    })();
    """
  nonisolated private static let scope = "https://www.googleapis.com/auth/drive.file"
  nonisolated private static let keychainService = "Pinpad Google Drive"

  struct AuthError: LocalizedError {
    let errorDescription: String?
    var code: String?
  }

  typealias Reply = @MainActor @Sendable (Any?, String?) -> Void

  private var listener: NWListener?
  private var redirectURI = ""
  private var finishSignIn: ((Result<String, Error>) -> Void)?

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
      replyHandler(nil, "Bad Google request")
      return
    }
    let config = body["config"] as? [String: Any] ?? [:]
    let clientId = config["clientId"] as? String ?? ""
    let secret = config["clientSecret"] as? String ?? ""
    // Each Google account keeps its own sign-in; a sign-in saved before accounts were kept
    // apart is used for (and moved to) the first account that asks for it.
    let account = config["account"] as? String
    switch op {
    case "signIn":
      signIn(clientId: clientId, secret: secret, reply: replyHandler)
    case "token":
      var refresh = Self.loadRefreshToken(account: account)
      if refresh == nil, let account, let legacy = Self.loadRefreshToken(account: nil) {
        Self.saveRefreshToken(legacy, account: account)
        Self.deleteRefreshToken(account: nil)
        refresh = legacy
      }
      guard let refresh else { return replyHandler(NSNull(), nil) }
      Self.tokenRequest(["grant_type": "refresh_token", "refresh_token": refresh, "client_id": clientId, "client_secret": secret]) { result in
        switch result {
        case .success(let json):
          replyHandler(Self.tokenReply(json), nil)
        case .failure(let error as AuthError) where error.code == "invalid_grant":
          // Revoked or expired: the user signs in again. Other failures (offline) are retried later.
          Self.deleteRefreshToken(account: account)
          replyHandler(NSNull(), nil)
        case .failure(let error):
          replyHandler(nil, error.localizedDescription)
        }
      }
    case "signOut":
      if let refresh = Self.loadRefreshToken(account: account) ?? Self.loadRefreshToken(account: nil),
        let url = URL(string: "https://oauth2.googleapis.com/revoke?token=\(Self.formEncode(refresh))")
      {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        URLSession.shared.dataTask(with: request).resume()
      }
      Self.deleteRefreshToken(account: account)
      Self.deleteRefreshToken(account: nil)
      replyHandler(true, nil)
    default:
      replyHandler(nil, "Unknown Google request \(op)")
    }
  }

  private func signIn(clientId: String, secret: String, reply: @escaping Reply) {
    finishSignIn?(.failure(AuthError(errorDescription: "Sign-in was restarted")))
    let verifier = Self.randomURLSafe(32)
    let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = Self.randomURLSafe(16)
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
    guard let listener = try? NWListener(using: params) else { return reply(nil, "Couldn't start Google sign-in") }
    self.listener = listener
    redirectURI = ""

    let timeout = DispatchWorkItem { [weak self] in
      self?.finishSignIn?(.failure(AuthError(errorDescription: "Sign-in timed out")))
    }
    finishSignIn = { [weak self] result in
      guard let self else { return }
      timeout.cancel()
      self.finishSignIn = nil
      self.listener?.cancel()
      self.listener = nil
      switch result {
      case .failure(let error):
        reply(nil, error.localizedDescription)
      case .success(let code):
        Self.tokenRequest([
          "grant_type": "authorization_code", "code": code, "client_id": clientId, "client_secret": secret,
          "redirect_uri": self.redirectURI, "code_verifier": verifier,
        ]) { result in
          switch result {
          case .success(let json):
            NSApp.activate(ignoringOtherApps: true)
            let access = json["access_token"] as? String ?? ""
            // Which account signed in decides where its sign-in is kept.
            Self.fetchEmail(accessToken: access) { email in
              if let refresh = json["refresh_token"] as? String { Self.saveRefreshToken(refresh, account: email) }
              var out = Self.tokenReply(json)
              out["account"] = email ?? NSNull()
              reply(out, nil)
            }
          case .failure(let error):
            reply(nil, error.localizedDescription)
          }
        }
      }
    }

    listener.newConnectionHandler = { [weak self] connection in
      guard let owner = self else { return connection.cancel() }
      Self.receiveRedirect(on: connection, state: state) { [weak owner] result in owner?.finishSignIn?(result) }
    }
    listener.stateUpdateHandler = { [weak self] listenerState in
      DispatchQueue.main.async {
        guard let self, self.listener === listener else { return }
        switch listenerState {
        case .ready:
          guard self.redirectURI.isEmpty, let port = listener.port?.rawValue else { return }
          self.redirectURI = "http://127.0.0.1:\(port)"
          var auth = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
          auth.queryItems = [
            "client_id": clientId, "redirect_uri": self.redirectURI, "response_type": "code", "scope": Self.scope,
            "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
            "access_type": "offline", "prompt": "consent",
          ].map { URLQueryItem(name: $0.key, value: $0.value) }
          NSWorkspace.shared.open(auth.url!)
          DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: timeout)
        case .failed:
          self.finishSignIn?(.failure(AuthError(errorDescription: "Couldn't start Google sign-in")))
        default:
          break
        }
      }
    }
    listener.start(queue: .global(qos: .userInitiated))
  }

  /// Answers the browser's redirect and reports the code; other requests (a favicon) get a 404.
  nonisolated private static func receiveRedirect(
    on connection: NWConnection, state: String, done: @escaping @MainActor @Sendable (Result<String, Error>) -> Void
  ) {
    connection.start(queue: .global(qos: .userInitiated))
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, _, _ in
      let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      let target = request.split(separator: " ", maxSplits: 2).dropFirst().first.map(String.init) ?? ""
      let components = URLComponents(string: "http://127.0.0.1" + target)
      let respond = { (status: String, body: String) in
        let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in connection.cancel() })
      }
      guard components?.path == "/" else { return respond("404 Not Found", "Not found") }
      let items = components?.queryItems ?? []
      let value = { (name: String) in items.first { $0.name == name }?.value }
      let code = value("state") == state ? value("code") : nil
      let message = code != nil
        ? "Signed in to Google Drive. You can close this tab and go back to Pinpad."
        : "Sign-in was cancelled. You can close this tab."
      respond("200 OK", "<!doctype html><meta charset=\"utf-8\"><title>Pinpad</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;color:#050038\">\(message)</body>")
      let cancelled = value("error") == "access_denied"
      DispatchQueue.main.async {
        if let code { done(.success(code)) }
        else { done(.failure(AuthError(errorDescription: cancelled ? "Sign-in was cancelled" : "Sign-in failed"))) }
      }
    }
  }

  nonisolated private static func tokenRequest(
    _ params: [String: String], done: @escaping @MainActor @Sendable (Result<[String: Any], Error>) -> Void
  ) {
    var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data(params.map { "\($0.key)=\(formEncode($0.value))" }.joined(separator: "&").utf8)
    URLSession.shared.dataTask(with: request) { data, response, error in
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let failure = AuthError(
        errorDescription: json["error_description"] as? String ?? json["error"] as? String ?? error?.localizedDescription
          ?? "Google sign-in failed (\(status))",
        code: json["error"] as? String)
      let result: Result<[String: Any], Error> = (200..<300).contains(status) ? .success(json) : .failure(failure)
      DispatchQueue.main.async { done(result) }
    }.resume()
  }

  /// The signed-in account's email, from Google Drive.
  nonisolated private static func fetchEmail(accessToken: String, done: @escaping @MainActor @Sendable (String?) -> Void) {
    var request = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")!, timeoutInterval: 15)
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: request) { data, _, _ in
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      let email = (json?["user"] as? [String: Any])?["emailAddress"] as? String
      DispatchQueue.main.async { done(email) }
    }.resume()
  }

  nonisolated private static func tokenReply(_ json: [String: Any]) -> [String: Any] {
    ["accessToken": json["access_token"] ?? NSNull(), "expiresIn": json["expires_in"] ?? 3600]
  }

  nonisolated private static func formEncode(_ value: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
  }

  nonisolated private static func base64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  nonisolated private static func randomURLSafe(_ count: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    return base64url(Data(bytes))
  }

  /// One Keychain item per Google account ("refresh-token" alone is the older single sign-in).
  nonisolated private static func keychainItem(account: String?) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account.map { "refresh-token:\($0)" } ?? "refresh-token",
    ]
  }

  nonisolated private static func saveRefreshToken(_ token: String, account: String?) {
    SecItemDelete(keychainItem(account: account) as CFDictionary)
    var item = keychainItem(account: account)
    item[kSecValueData as String] = Data(token.utf8)
    SecItemAdd(item as CFDictionary, nil)
  }

  nonisolated private static func loadRefreshToken(account: String?) -> String? {
    var query = keychainItem(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  nonisolated private static func deleteRefreshToken(account: String?) {
    SecItemDelete(keychainItem(account: account) as CFDictionary)
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
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
    config.userContentController.addScriptMessageHandler(GoogleAuth(), contentWorld: .page, name: "google")
    config.userContentController.addUserScript(
      WKUserScript(source: GoogleAuth.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
    window.delegate = self
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

  /// Set once the user has agreed to close (everything was saved, or they chose to close anyway).
  private var closeConfirmed = false

  /// Lets the page save what's pending, then warns if something still isn't saved (it couldn't
  /// reach Google Drive or the storage folder, or saving is taking too long).
  private func confirmClose(_ done: @escaping @MainActor (Bool) -> Void) {
    guard let webView, !closeConfirmed else { return done(true) }
    var answered = false
    let answer: @MainActor (String?) -> Void = { [weak self] reason in
      guard !answered, let self else { return }
      answered = true
      guard let reason else {
        self.closeConfirmed = true
        return done(true)
      }
      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.messageText = "Some changes aren't saved yet"
      alert.informativeText = "\(reason)\n\nIf you close Pinpad now, they may be lost."
      alert.addButton(withTitle: "Keep Pinpad Open")
      alert.addButton(withTitle: "Close Anyway")
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        let close = response == .alertSecondButtonReturn
        if close { self.closeConfirmed = true }
        done(close)
      }
      if let window = self.window, window.isVisible { alert.beginSheetModal(for: window, completionHandler: finish) }
      else { finish(alert.runModal()) }
    }
    webView.callAsyncJavaScript("return await window.__unsavedReason?.() ?? null", arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value): answer(value as? String)
      case .failure: answer(nil)
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 6) { answer("Pinpad is still saving your latest changes.") }
  }

  /// Closing the window quits the app, so it's checked here, while the window can still stay open.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if closeConfirmed { return true }
    confirmClose { ok in if ok { sender.close() } }
    return false
  }

  /// Quitting (⌘Q) gets the same check as closing the window.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if closeConfirmed || webView == nil { return .terminateNow }
    confirmClose { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
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
