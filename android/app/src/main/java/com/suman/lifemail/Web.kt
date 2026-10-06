package com.suman.lifemail

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/** Small shared helpers for both screens. */
object Web {

    fun host(url: String?): String = try { Uri.parse(url).host ?: "" } catch (e: Exception) { "" }

    /** Government addresses that Work is allowed to open as its home/shortcuts. */
    fun isGovernment(url: String?): Boolean {
        val u = try { Uri.parse(url) } catch (e: Exception) { return false }
        if (u.scheme != "https") return false
        val h = u.host ?: return false
        return h == "mgovcloud.in" || h.endsWith(".mgovcloud.in") || h.endsWith(".gov.in") || h.endsWith(".nic.in")
    }

    fun isOnline(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Opens a web address in the phone's browser (Custom Tab when available). */
    fun openInBrowser(ctx: Context, url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && uri.scheme != "http") return openSafeIntent(ctx, url)
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, uri)
        } catch (e: Exception) {
            try { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { }
        }
    }

    /** mailto:, tel:, intent:// … handed to Android safely (never to a hidden, non-browsable component). */
    fun openSafeIntent(ctx: Context, url: String) {
        try {
            val intent = if (url.startsWith("intent:")) {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                    component = null
                    selector = null
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
            } else Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(ctx, "No app can open this link", Toast.LENGTH_SHORT).show()
        }
    }

    /** Pads the screen so content never sits under the status bar, navigation bar or camera cut-out. */
    fun applyInsets(root: View) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    /**
     * Saves a file into the phone's Downloads folder and returns its address.
     * Used for attachments and backups from Personal mail. Nothing is uploaded anywhere.
     */
    fun saveToDownloads(ctx: Context, name: String, mime: String, bytes: ByteArray): Uri? {
        val safeName = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_").take(120).ifBlank { "file" }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = ctx.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
            values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            uri
        } else {
            @Suppress("DEPRECATION")
            val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
            val f = File(dir, safeName); f.writeBytes(bytes)
            androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
        }
    }
}

/**
 * Lets web pages use <input type="file"> (attach files in Personal compose, upload in Workplace).
 * Files go straight from the Android file picker to the page that asked — never anywhere else.
 */
class FileChooser(activity: ComponentActivity) {
    private var callback: ValueCallback<Array<Uri>>? = null
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
        callback = null
    }

    fun show(activity: Activity, cb: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        callback?.onReceiveValue(null)
        callback = cb
        return try {
            val intent = params.createIntent().apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                if (type.isNullOrBlank() || type == ".") type = "*/*"
            }
            launcher.launch(intent)
            true
        } catch (e: Exception) {
            callback = null
            Toast.makeText(activity, "Can't open the file picker", Toast.LENGTH_SHORT).show()
            false
        }
    }
}

/** Opens target=_blank / window.open() links from a page in the browser instead of inside the app. */
fun interceptNewWindow(ctx: Context, view: WebView, resultMsg: android.os.Message?): Boolean {
    val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
    val temp = WebView(ctx)
    temp.webViewClient = object : android.webkit.WebViewClient() {
        override fun shouldOverrideUrlLoading(v: WebView, request: android.webkit.WebResourceRequest): Boolean {
            Web.openInBrowser(ctx, request.url.toString())
            v.post { v.destroy() }
            return true
        }
    }
    transport.webView = temp
    resultMsg.sendToTarget()
    return true
}
