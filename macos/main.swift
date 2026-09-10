import AppKit
import WebKit
import Foundation
import Darwin

private let productName = "八奈见的小卖部"
private let serviceMarker = "yanami-snack-club-v1"

struct LauncherConfiguration {
    let port: Int
    let dataFile: URL
    let distribution: URL
    let resources: URL
    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    init() throws {
        let environment = ProcessInfo.processInfo.environment
        let requestedPort = environment["YANAMI_PORT"] ?? "17653"
        guard let value = Int(requestedPort), (1...65535).contains(value) else {
            throw LauncherError.message("本地端口设置无效，请使用 1 到 65535 之间的数字。")
        }
        guard let resourceURL = Bundle.main.resourceURL else {
            throw LauncherError.message("找不到应用资源，请重新构建应用。")
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("YanamiSnackClub", isDirectory: true)
        self.port = value
        self.resources = resourceURL
        self.dataFile = environment["YANAMI_DATA_FILE"].map(Self.fileURL)
            ?? support.appendingPathComponent("state.json")
        self.distribution = environment["YANAMI_DIST_DIR"].map(Self.fileURL)
            ?? resourceURL.appendingPathComponent("companion/dist", isDirectory: true)
    }

    private static func fileURL(_ path: String) -> URL {
        URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
    }

    func isLocal(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == port
    }
}

enum LauncherError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): return message }
    }
}

enum ServiceState {
    case starting
    case ready(reused: Bool)
    case failed(String)
}

private enum ProbeResult {
    case matching
    case differentService
    case unhealthy(String)
    case unavailable
}

final class ServiceController {
    let configuration: LauncherConfiguration
    var onChange: ((ServiceState) -> Void)?
    private(set) var isReady = false
    private(set) var isStarting = false
    private var process: Process?
    private var logHandle: FileHandle?
    private var generation = 0
    private var shuttingDown = false
    private let session: URLSession

    init(configuration: LauncherConfiguration) {
        self.configuration = configuration
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        sessionConfiguration.timeoutIntervalForRequest = 1
        sessionConfiguration.timeoutIntervalForResource = 2
        sessionConfiguration.connectionProxyDictionary = [:]
        self.session = URLSession(configuration: sessionConfiguration)
    }

    func start() {
        guard !isReady, !isStarting, !shuttingDown else { return }
        isStarting = true
        generation += 1
        let token = generation
        onChange?(.starting)
        stopOwnedProcess { [weak self] in
            guard let self = self, self.generation == token, !self.shuttingDown else { return }
            self.probe { [weak self] result in
                guard let self = self, self.generation == token, !self.shuttingDown else { return }
                switch result {
                case .matching: self.ready(reused: true)
                case .differentService: self.fail(self.portConflictMessage)
                case .unhealthy(let message): self.fail(message)
                case .unavailable: self.launch(token: token)
                }
            }
        }
    }

    func ensureReady() {
        guard isReady else {
            start()
            return
        }
        guard !isStarting, !shuttingDown else { return }
        isStarting = true
        let token = generation
        probe { [weak self] result in
            guard let self = self, self.generation == token, !self.shuttingDown else { return }
            self.isStarting = false
            switch result {
            case .matching: self.ready(reused: self.process?.isRunning != true)
            case .differentService: self.fail(self.portConflictMessage)
            case .unhealthy(let message): self.fail(message)
            case .unavailable:
                self.isReady = false
                self.start()
            }
        }
    }

    private var portConflictMessage: String {
        "本地入口 \(configuration.port) 正被其他服务使用。请按启动说明选择另一个端口后重试。"
    }

    private func probe(_ completion: @escaping (ProbeResult) -> Void) {
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent("api/state"))
        request.timeoutInterval = 1
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, _ in
            let result: ProbeResult
            if let response = response as? HTTPURLResponse {
                let marker = response.value(forHTTPHeaderField: "X-Yanami-Service")
                if response.statusCode == 200, marker == serviceMarker,
                   let data = data,
                   let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   payload["state"] is [String: Any],
                   payload["catalog"] != nil,
                   payload["now"] is NSNumber {
                    result = .matching
                } else if marker == serviceMarker {
                    result = .unhealthy("小卖部服务暂时无法提供记录。请查看本地启动日志，确认存档可以读取。")
                } else {
                    result = .differentService
                }
            } else {
                result = .unavailable
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    private func launch(token: Int) {
        let executable = configuration.resources.appendingPathComponent("runtime/node")
        let server = configuration.resources.appendingPathComponent("companion/server.mjs")
        let index = configuration.distribution.appendingPathComponent("index.html")
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              FileManager.default.fileExists(atPath: server.path),
              FileManager.default.fileExists(atPath: index.path) else {
            fail("应用资源不完整。请先构建网页，再重新构建 Mac 应用。")
            return
        }

        do {
            let logDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("YanamiSnackClub/logs", isDirectory: true)
            try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
            let logFile = logDirectory.appendingPathComponent("launcher.log")
            if let attributes = try? FileManager.default.attributesOfItem(atPath: logFile.path),
               let size = attributes[.size] as? NSNumber, size.intValue > 1_048_576 {
                let previous = logDirectory.appendingPathComponent("launcher.previous.log")
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: logFile, to: previous)
            }
            if !FileManager.default.fileExists(atPath: logFile.path) {
                FileManager.default.createFile(atPath: logFile.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logFile)
            try handle.seekToEnd()
            self.logHandle = handle

            let child = Process()
            child.executableURL = executable
            child.arguments = [server.path]
            child.currentDirectoryURL = server.deletingLastPathComponent()
            var environment = ProcessInfo.processInfo.environment
            environment.removeValue(forKey: "NODE_OPTIONS")
            environment.removeValue(forKey: "NODE_PATH")
            environment["YANAMI_PORT"] = String(configuration.port)
            environment["YANAMI_DATA_FILE"] = configuration.dataFile.path
            environment["YANAMI_DIST_DIR"] = configuration.distribution.path
            child.environment = environment
            child.standardInput = FileHandle.nullDevice
            child.standardOutput = handle
            child.standardError = handle
            child.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, self.generation == token, !self.shuttingDown else { return }
                    // A simultaneous launcher may already own the matching service.
                    if self.isReady {
                        self.probe { [weak self] result in
                            guard let self = self, self.generation == token, !self.shuttingDown else { return }
                            if case .matching = result {
                                self.ready(reused: true)
                            } else {
                                self.fail("小卖部服务已停止。点击“重试”重新打开；记录保存在本机。")
                            }
                        }
                    }
                }
            }
            self.process = child
            try child.run()
            self.poll(token: token, deadline: Date().addingTimeInterval(15))
        } catch {
            self.fail("无法启动小卖部：\(error.localizedDescription)")
        }
    }

    private func poll(token: Int, deadline: Date) {
        guard generation == token, !shuttingDown else { return }
        probe { [weak self] result in
            guard let self = self, self.generation == token, !self.shuttingDown else { return }
            switch result {
            case .matching:
                self.ready(reused: self.process?.isRunning != true)
            case .differentService:
                self.stopOwnedProcess { [weak self] in
                    guard let self = self, self.generation == token else { return }
                    self.fail(self.portConflictMessage)
                }
            case .unhealthy(let message):
                self.fail(message)
            case .unavailable:
                if Date() >= deadline {
                    self.stopOwnedProcess { [weak self] in
                        guard let self = self, self.generation == token else { return }
                        self.fail("小卖部暂时没有准备好。请重试；详细原因保存在启动日志中。")
                    }
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                        self?.poll(token: token, deadline: deadline)
                    }
                }
            }
        }
    }

    private func ready(reused: Bool) {
        isReady = true
        isStarting = false
        onChange?(.ready(reused: reused))
    }

    private func fail(_ message: String) {
        isReady = false
        isStarting = false
        onChange?(.failed(message))
    }

    private func stopOwnedProcess(completion: @escaping () -> Void) {
        guard let child = process else {
            completion()
            return
        }
        process = nil
        child.terminationHandler = nil
        let handle = logHandle
        logHandle = nil
        guard child.isRunning else {
            try? handle?.close()
            completion()
            return
        }
        child.terminate()
        // Restricted to the Process object created here. No process lookup by port.
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2) {
            if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
        }
        DispatchQueue.global(qos: .utility).async {
            child.waitUntilExit()
            try? handle?.close()
            DispatchQueue.main.async { completion() }
        }
    }

    func shutdown(completion: @escaping () -> Void) {
        shuttingDown = true
        generation += 1
        isReady = false
        isStarting = false
        session.invalidateAndCancel()
        stopOwnedProcess(completion: completion)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var service: ServiceController?
    private var configuration: LauncherConfiguration?
    private var statusItem: NSStatusItem?
    private var statusMenuItem: NSMenuItem?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var loadingView: NSView?
    private var messageLabel: NSTextField?
    private var spinner: NSProgressIndicator?
    private var retryButton: NSButton?
    private var loadedURL: URL?
    private var wantsBrowser = false
    private var terminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        createMenu()
        createWindow()
        do {
            let configuration = try LauncherConfiguration()
            self.configuration = configuration
            let controller = ServiceController(configuration: configuration)
            controller.onChange = { [weak self] state in self?.serviceChanged(state) }
            self.service = controller
            showWindow(nil)
            controller.start()
        } catch {
            showWindow(nil)
            showMessage(error.localizedDescription, loading: false, canRetry: false)
        }
    }

    private func createMenu() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let symbol = NSImage(systemSymbolName: "takeoutbag.and.cup.and.straw", accessibilityDescription: productName)
            ?? NSImage(systemSymbolName: "shippingbox", accessibilityDescription: productName)
        symbol?.isTemplate = true
        item.button?.image = symbol
        item.button?.toolTip = productName
        if symbol == nil { item.button?.title = "八奈见" }
        let menu = NSMenu()
        let status = NSMenuItem(title: "正在准备小卖部…", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())
        let open = NSMenuItem(title: "打开小卖部", action: #selector(showWindow(_:)), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        let browser = NSMenuItem(title: "在浏览器中打开", action: #selector(openBrowser(_:)), keyEquivalent: "")
        browser.target = self
        menu.addItem(browser)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出小卖部", action: #selector(quit(_:)), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
        statusMenuItem = status

        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        let mainQuit = NSMenuItem(title: "退出\(productName)", action: #selector(quit(_:)), keyEquivalent: "q")
        mainQuit.target = self
        applicationMenu.addItem(mainQuit)
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [
            ("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"),
            ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")
        ] {
            editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }

    private func createWindow() {
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 760),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable],
                             backing: .buffered, defer: false)
        panel.title = productName
        panel.minSize = NSSize(width: 760, height: 600)
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.center()
        let content = NSView(frame: panel.contentView?.bounds ?? .zero)
        panel.contentView = content
        let web = WKWebView(frame: content.bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        content.addSubview(web)
        let overlay = NSView(frame: content.bounds)
        overlay.autoresizingMask = [.width, .height]
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        content.addSubview(overlay)
        let title = NSTextField(labelWithString: productName)
        title.font = NSFont.systemFont(ofSize: 26, weight: .semibold)
        let message = NSTextField(wrappingLabelWithString: "正在准备小卖部…")
        message.alignment = .center
        message.font = NSFont.systemFont(ofSize: 15)
        message.textColor = .secondaryLabelColor
        message.maximumNumberOfLines = 0
        let progress = NSProgressIndicator()
        progress.style = .spinning
        progress.controlSize = .regular
        progress.startAnimation(nil)
        let retry = NSButton(title: "重试", target: self, action: #selector(retry(_:)))
        retry.bezelStyle = .rounded
        retry.isHidden = true
        let stack = NSStackView(views: [title, message, progress, retry])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 520),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 40),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -40)
        ])
        self.window = panel
        self.webView = web
        self.loadingView = overlay
        self.messageLabel = message
        self.spinner = progress
        self.retryButton = retry
    }

    @objc private func showWindow(_ sender: Any?) {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        service?.ensureReady()
    }

    @objc private func openBrowser(_ sender: Any?) {
        wantsBrowser = true
        showWindow(nil)
    }

    @objc private func retry(_ sender: Any?) {
        showMessage("正在打开小卖部…", loading: true, canRetry: false)
        service?.ensureReady()
    }

    @objc private func quit(_ sender: Any?) { NSApp.terminate(nil) }

    private func serviceChanged(_ state: ServiceState) {
        switch state {
        case .starting:
            statusMenuItem?.title = "正在准备小卖部…"
            showMessage("正在准备小卖部…", loading: true, canRetry: false)
        case .ready(let reused):
            statusMenuItem?.title = reused ? "已连接本地小卖部" : "小卖部已打开"
            guard let url = configuration?.baseURL else { return }
            if loadedURL != url || loadingView?.isHidden == false {
                loadedURL = url
                showMessage("正在打开小卖部…", loading: true, canRetry: false)
                webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
            }
            if wantsBrowser {
                wantsBrowser = false
                NSWorkspace.shared.open(url)
            }
        case .failed(let message):
            statusMenuItem?.title = "小卖部暂时无法打开"
            wantsBrowser = false
            showMessage(message, loading: false, canRetry: true)
        }
    }

    private func showMessage(_ message: String, loading: Bool, canRetry: Bool) {
        loadingView?.isHidden = false
        messageLabel?.stringValue = message
        spinner?.isHidden = !loading
        if loading { spinner?.startAnimation(nil) } else { spinner?.stopAnimation(nil) }
        retryButton?.isHidden = !canRetry
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow(nil)
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        guard let service = service else { return .terminateNow }
        service.shutdown {
            DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if service?.isReady == true {
            loadingView?.isHidden = true
            spinner?.stopAnimation(nil)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    private func navigationFailed(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        showMessage("小卖部页面暂时没有打开，请重试。", loading: false, canRetry: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        showMessage("页面需要重新打开，请重试。", loading: false, canRetry: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if configuration?.isLocal(url) == true {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated,
               ["http", "https"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
