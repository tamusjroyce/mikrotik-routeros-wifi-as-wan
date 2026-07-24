import SwiftUI
import WebKit

struct WebAppView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "routerBackend")

        let bridgeScript = """
        window.__routerBackendCallbacks = {};
        window.__routerBackendInvoke = (action, payload) => new Promise((resolve, reject) => {
          const id = `router-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          window.__routerBackendCallbacks[id] = { resolve, reject };
          window.webkit.messageHandlers.routerBackend.postMessage({ id, action, payload });
        });
        window.__routerBackendResolve = (id, result) => {
          const callback = window.__routerBackendCallbacks[id];
          if (!callback) return;
          callback.resolve(result);
          delete window.__routerBackendCallbacks[id];
        };
        window.__routerBackendReject = (id, message) => {
          const callback = window.__routerBackendCallbacks[id];
          if (!callback) return;
          callback.reject(new Error(message));
          delete window.__routerBackendCallbacks[id];
        };
        """
        let script = WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        controller.addUserScript(script)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let backend = RouterBackend()

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "routerBackend",
                  let body = message.body as? [String: Any],
                  let id = body["id"] as? String,
                  let action = body["action"] as? String,
                  let payload = body["payload"] as? [String: Any] else {
                return
            }

            Task {
                do {
                    let result = try await backend.invoke(action: action, payload: payload)
                    let jsonData = try JSONSerialization.data(withJSONObject: result)
                    let jsonText = String(data: jsonData, encoding: .utf8) ?? "{}"
                    await MainActor.run {
                        self.webView?.evaluateJavaScript("window.__routerBackendResolve(\(quote(id)), \(jsonText));")
                    }
                } catch {
                    let message = (error as NSError).localizedDescription
                    await MainActor.run {
                        self.webView?.evaluateJavaScript("window.__routerBackendReject(\(quote(id)), \(quote(message)));")
                    }
                }
            }
        }

        private func quote(_ value: String) -> String {
            let encoded = try? JSONSerialization.data(withJSONObject: [value], options: [])
            let text = encoded.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
            return String(text.dropFirst().dropLast())
        }
    }
}
