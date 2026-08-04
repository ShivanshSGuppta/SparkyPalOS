import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let appName = "SparkyPalOS"
        let configuredURL = Bundle.main.object(forInfoDictionaryKey: "SparkyPalURL") as? String
        let appURL = URL(string: configuredURL ?? "https://sparkypalos.vercel.app")!

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = appName
        window.minSize = NSSize(width: 900, height: 640)
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        self.window = window

        buildMenu(appName: appName)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: appURL, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 30))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func buildMenu(appName: String) {
        let menu = NSMenu()
        let appMenuItem = NSMenuItem()
        menu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu

        let viewMenuItem = NSMenuItem()
        menu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r"))
        viewMenu.addItem(NSMenuItem(title: "Back", action: #selector(goBack), keyEquivalent: "["))
        viewMenu.addItem(NSMenuItem(title: "Forward", action: #selector(goForward), keyEquivalent: "]"))
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = menu
    }

    @objc private func reloadPage() {
        webView?.reload()
    }

    @objc private func goBack() {
        if webView?.canGoBack == true {
            webView?.goBack()
        }
    }

    @objc private func goForward() {
        if webView?.canGoForward == true {
            webView?.goForward()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
