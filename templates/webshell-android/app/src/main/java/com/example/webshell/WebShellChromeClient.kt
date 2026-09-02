package com.example.webshell

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Message
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class WebShellChromeClient(
    private val onProgressChanged: (Int) -> Unit,
    private val isDebug: Boolean,
) : WebChromeClient() {
    override fun onProgressChanged(
        view: WebView,
        newProgress: Int,
    ) {
        onProgressChanged.invoke(newProgress)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        // Console messages are page-controlled and may contain sensitive
        // data — never write them to logcat in release builds.
        if (!isDebug) {
            return true
        }
        val level =
            when (consoleMessage.messageLevel()) {
                ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                else -> Log.INFO
            }
        Log.println(
            level,
            TAG,
            "${consoleMessage.message()} — ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}",
        )
        return true
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        // Handle window.open() and target="_blank" links (used by OAuth
        // flows like Privy, social logins, etc.).  Open the URL in the
        // system browser so the user can complete the flow there.  The
        // temporary WebView exists only to capture the popup's target URL
        // and is destroyed once the URL has been handed off.
        val newWebView = WebView(view.context)
        newWebView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // The popup URL is page-controlled: only browsable http(s) targets may launch,
                    // matching the main frame's intent policy in WebShellViewClient.
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme == "http" || scheme == "https") {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, request.url)
                            intent.addCategory(Intent.CATEGORY_BROWSABLE)
                            view.context.startActivity(intent)
                        } catch (_: ActivityNotFoundException) {
                            if (isDebug) {
                                Log.w(TAG, "No activity found to handle popup URL: ${request.url}")
                            }
                        }
                    }
                    view.post { view.destroy() }
                    return true
                }
            }
        newWebView.webChromeClient =
            object : WebChromeClient() {
                override fun onCloseWindow(window: WebView) {
                    window.destroy()
                }
            }
        val transport = resultMsg.obj as WebView.WebViewTransport
        transport.webView = newWebView
        resultMsg.sendToTarget()
        return true
    }

    private companion object {
        const val TAG = "WebShell"
    }
}
