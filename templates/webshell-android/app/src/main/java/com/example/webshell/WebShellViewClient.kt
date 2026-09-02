package com.example.webshell

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.net.toUri

open class WebShellViewClient(
    private val context: Context,
    private val scopeHostProvider: () -> String,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val url = request.url
        val scheme = url.scheme ?: return false

        // Never intercept subframe (iframe) navigation — this breaks
        // embedded SDKs like Privy that use cross-origin iframes.
        if (!request.isForMainFrame) return false

        return when (scheme) {
            "solana-wallet" -> {
                if (launchExternal(Intent(Intent.ACTION_VIEW, url))) {
                    // The wallet protocol library uses window.blur to detect that the
                    // wallet app opened.  In a WebView the blur event never fires
                    // naturally, so we dispatch a synthetic one to unblock the
                    // detection promise (3-second timeout in startSession.ts).
                    view.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null)
                }
                true
            }

            "intent" -> {
                handleIntentScheme(url.toString())
                true
            }

            "blob", "javascript" -> {
                false
            }

            "http", "https" -> {
                if (url.host.equals(scopeHostProvider.invoke(), ignoreCase = true)) {
                    false
                } else {
                    launchExternal(Intent(Intent.ACTION_VIEW, url))
                    true
                }
            }

            else -> {
                launchExternal(Intent(Intent.ACTION_VIEW, url))
                true
            }
        }
    }

    private fun handleIntentScheme(url: String) {
        try {
            val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            // Sanitize the page-controlled intent: only implicit, browsable
            // targets may launch — never explicit components, selector
            // intents, or URI permission grants.
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.component = null
            intent.selector = null
            intent.removeFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
            if (!launchExternal(intent)) {
                val fallback = intent.getStringExtra("browser_fallback_url")?.toUri()
                if (fallback != null) {
                    // Only honor http/https fallback URLs — anything else
                    // (javascript:, intent:, file:) is an injection vector.
                    val fallbackScheme = fallback.scheme?.lowercase()
                    if (fallbackScheme == "http" || fallbackScheme == "https") {
                        launchExternal(Intent(Intent.ACTION_VIEW, fallback))
                    }
                }
            }
        } catch (_: Exception) {
            // Malformed intent URL — silently ignore
        }
    }

    private fun launchExternal(intent: Intent): Boolean {
        if (context !is Activity) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "No activity found to handle URL with scheme: ${intent.data?.scheme}")
            false
        }
    }

    private companion object {
        const val TAG = "WebShell"
    }
}
