// Designer Job Search for Mac: a window for the app, with its own Dock icon.
// It runs the app's code from the folder it was built from (DJSAppDir in Info.plist), starts the
// local server if it is not already running, and shows http://localhost:4340/ in a window.
// Anything that is not the app itself (job postings, LinkedIn, Google) opens in your browser.
// Built by scripts/make-app.mjs (npm run app). Needs only the Mac's own frameworks.
import Cocoa
import WebKit

let info = Bundle.main.infoDictionary ?? [:]
let appDir = info["DJSAppDir"] as? String ?? ""
let bakedNode = info["DJSNode"] as? String ?? ""

// Node.js, found the way a Terminal would: the path saved at build time, then the usual install
// places, then the login shell (for nvm, which moves Node with each version). The shell's own
// startup text is fenced off with markers so only the path is read.
func findNode() -> String? {
  let fm = FileManager.default
  for c in [bakedNode, "/opt/homebrew/bin/node", "/usr/local/bin/node"] where !c.isEmpty && fm.isExecutableFile(atPath: c) { return c }
  let p = Process(), out = Pipe()
  p.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
  p.arguments = ["-ilc", "printf __DJS__; command -v node; printf __DJS__"]
  p.standardOutput = out; p.standardError = Pipe()
  guard (try? p.run()) != nil else { return nil }
  p.waitUntilExit()
  let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let parts = text.components(separatedBy: "__DJS__")
  let path = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
  return fm.isExecutableFile(atPath: path) ? path : nil
}
let port = 4340
let home = URL(string: "http://localhost:\(port)/")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var server: Process?

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()
    web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    web.navigationDelegate = self
    web.uiDelegate = self
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 880),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Designer Job Search"
    window.minSize = NSSize(width: 720, height: 520)
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("DesignerJobSearchMain")
    window.isReleasedWhenClosed = false
    page("Starting…", "Getting Designer Job Search ready.")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    startServerIfNeeded { ok in
      if ok { self.web.load(URLRequest(url: home)) }
      else { self.page("Designer Job Search could not start", "Check that Node.js 20 or later is installed, and that the app folder is still at \(appDir). The log is in your Library, Logs, designer-job-search folder.") }
    }
  }

  // Closing the window keeps the app (and its automatic checks) running; the Dock icon reopens it.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { window.makeKeyAndOrderFront(nil) }
    return true
  }

  // Quitting stops the server, but only if this app started it.
  func applicationWillTerminate(_ note: Notification) { server?.terminate() }

  /* ---------- The local server ---------- */

  func ping(_ done: @escaping (Bool) -> Void) {
    var req = URLRequest(url: home)
    req.timeoutInterval = 1
    URLSession.shared.dataTask(with: req) { _, res, _ in
      done((res as? HTTPURLResponse)?.statusCode == 200)
    }.resume()
  }

  func startServerIfNeeded(_ done: @escaping (Bool) -> Void) {
    ping { up in
      if up { DispatchQueue.main.async { done(true) }; return }
      DispatchQueue.global().async {
        guard let node = findNode() else { DispatchQueue.main.async { done(false) }; return }
        DispatchQueue.main.async { self.launchServer(node, done) }
      }
    }
  }

  func launchServer(_ node: String, _ done: @escaping (Bool) -> Void) {
    do {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = ["\(appDir)/server.mjs"]
        p.currentDirectoryURL = URL(fileURLWithPath: appDir)
        let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/designer-job-search")
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let logFile = logs.appendingPathComponent("app.log")
        if !FileManager.default.fileExists(atPath: logFile.path) { FileManager.default.createFile(atPath: logFile.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: logFile) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
        try p.run()
        self.server = p
        self.waitForServer(tries: 360, done)
    } catch { done(false) }
  }

  func waitForServer(tries: Int, _ done: @escaping (Bool) -> Void) {
    ping { up in
      DispatchQueue.main.async {
        if up { done(true); return }
        // macOS asks once before a new app may read files in Documents (or Desktop, or Downloads),
        // and the server waits on that question. Say so, instead of looking stuck.
        if tries == 348 { self.page("Starting…", "If macOS asks to let Designer Job Search use files in a folder, click Allow. The app reads its own files from the folder it was installed in, and keeps your data there.") }
        if tries <= 0 || !(self.server?.isRunning ?? false) { done(false) }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(tries: tries - 1, done) } }
      }
    }
  }

  /* ---------- The window ---------- */

  func page(_ title: String, _ text: String) {
    let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    web.loadHTMLString("""
      <!doctype html><meta charset="utf-8"><style>
      body { margin: 0; height: 100vh; display: grid; place-items: center; background: #F0EEE9; color: #2D3436; font: 16px -apple-system, system-ui, sans-serif; }
      main { max-width: 520px; padding: 24px; } h1 { font-size: 22px; margin: 0 0 8px; } p { margin: 0; color: #545B5A; line-height: 1.5; }
      @media (prefers-color-scheme: dark) { body { background: #111111; color: #FFFFFF; } p { color: #8A8F8C; } }
      </style><main><h1>\(esc(title))</h1><p>\(esc(text))</p></main>
      """, baseURL: nil) // ds-allow: SDC paper-cloud, ink-charcoal and their dark pairs, before the app's own CSS loads
  }

  func isApp(_ url: URL) -> Bool {
    (url.host == "localhost" || url.host == "127.0.0.1") && url.port == port
  }

  // Only the app itself shows in this window. Every other address opens in the default browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { decisionHandler(.cancel); return }
    if url.scheme == "about" || url.scheme == "data" || isApp(url) { decisionHandler(.allow); return }
    if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }

  // Links that open a new tab (target="_blank") go to the browser too.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url {
      if isApp(url) { webView.load(URLRequest(url: url)) } else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  // The file picker, for giving the app its Google key.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message; a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  /* ---------- Menus ---------- */
  // Without an Edit menu, copy and paste do not work in the window.

  @objc func reload() { web.reload() }
  @objc func showWindow() { window.makeKeyAndOrderFront(nil) }
  @objc func openSite() { NSWorkspace.shared.open(URL(string: "https://stevendesignco.com")!) }

  func buildMenu() {
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let top = NSMenuItem(); let m = NSMenu(title: title)
      items.forEach { m.addItem($0) }
      top.submenu = m; main.addItem(top)
    }
    func item(_ t: String, _ a: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
    }
    let about = item("About Designer Job Search", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), "")
    let site = item("Steven Design Co. Website", #selector(openSite), ""); site.target = self
    add("Designer Job Search", [about, site, .separator(),
      item("Hide Designer Job Search", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:)), ""), .separator(),
      item("Quit Designer Job Search", #selector(NSApplication.terminate(_:)), "q")])
    add("Edit", [item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a")])
    let reloadItem = item("Reload", #selector(reload), "r"); reloadItem.target = self
    add("View", [reloadItem])
    let showItem = item("Designer Job Search", #selector(showWindow), "1"); showItem.target = self
    add("Window", [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:)), ""), item("Close", #selector(NSWindow.performClose(_:)), "w"), .separator(), showItem])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
