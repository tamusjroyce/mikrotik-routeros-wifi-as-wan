package com.tamus.wifiaswan

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import kotlin.concurrent.thread

class RouterBackendBridge(
    private val webView: WebView,
    private val routerClient: RouterClient,
) {
    @JavascriptInterface
    fun invoke(action: String, payloadJson: String, callbackId: String) {
        thread {
            try {
                val payload = JSONObject(payloadJson)
                val result = routerClient.invoke(action, payload)
                val script = "window.__routerBackendResolve(${quote(callbackId)}, ${result.toString()});"
                webView.post { webView.evaluateJavascript(script, null) }
            } catch (error: Exception) {
                val script = "window.__routerBackendReject(${quote(callbackId)}, ${quote(error.message ?: "Unknown error")});"
                webView.post { webView.evaluateJavascript(script, null) }
            }
        }
    }

    private fun quote(value: String): String = JSONObject.quote(value)
}
