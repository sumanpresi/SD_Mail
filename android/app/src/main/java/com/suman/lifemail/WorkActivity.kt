package com.suman.lifemail

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/**
 * WORK — Government Workplace (workplace.mgovcloud.in) shown INSIDE LifeMail in a real browser view.
 *
 * Security rules this screen follows:
 *  • It is a plain browser for the Government site. Sign-in, password, MFA/TOTP, cookies and mail are
 *    handled entirely by the Government website. LifeMail adds no scripts to these pages, reads nothing
 *    from them, and stores no passwords, codes or tokens.
 *  • It runs in its own Android process with its own WebView data folder (see LifeMailApp), so the
 *    Government session is completely separate from Personal mail.
 *  • Certificate errors are never ignored; https only; no file:// access.
 */
class WorkActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var hostView: TextView
    private lateinit var lockView: ImageView
    private lateinit var progress: ProgressBar
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton
    private lateinit var toolbar: View
    private val files = FileChooser(this)
    private val prefs by lazy { getSharedPreferences("work", MODE_PRIVATE) }
    private var defaultUa = ""
    private var clearHistoryOnLoad = false
    private var fullScreen = false
    private lateinit var btnExitFull: ImageButton

    private val home: String get() = BuildConfig.WORK_HOME

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_work)
        Web.applyInsets(findViewById(R.id.root))

        web = findViewById(R.id.web)
        hostView = findViewById(R.id.host)
        lockView = findViewById(R.id.lock)
        progress = findViewById(R.id.progress)
        errorPanel = findViewById(R.id.errorPanel)
        errorText = findViewById(R.id.errorText)
        btnBack = findViewById(R.id.btnBack)
        btnForward = findViewById(R.id.btnForward)
        toolbar = findViewById(R.id.toolbar)
        btnExitFull = findViewById(R.id.btnExitFull)
        setupExitFullButton()

        findViewById<ImageButton>(R.id.btnPersonal).setOnClickListener { goPersonal() }
        btnBack.setOnClickListener { if (web.canGoBack()) web.goBack() }
        btnForward.setOnClickListener { if (web.canGoForward()) web.goForward() }
        findViewById<ImageButton>(R.id.btnReload).setOnClickListener { reload() }
        findViewById<ImageButton>(R.id.btnMore).setOnClickListener { showMenu(it) }
        findViewById<View>(R.id.btnRetry).setOnClickListener { reload() }
        findViewById<View>(R.id.btnOpenBrowser).setOnClickListener { Web.openInBrowser(this, web.url ?: home) }

        with(web.settings) {
            javaScriptEnabled = true          // the Government Workplace is a JavaScript app
            domStorageEnabled = true          // …and keeps its own state in the browser
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(false)  // links that open "new windows" stay in this Work browser
            javaScriptCanOpenWindowsAutomatically = true
        }
        defaultUa = web.settings.userAgentString
        applyDesktopMode(prefs.getBoolean("desktop", false), reloadPage = false)

        CookieManager.getInstance().apply {
            setAcceptCookie(true)                     // needed to stay signed in to Workplace
            setAcceptThirdPartyCookies(web, false)    // not needed: Workplace and its sign-in are both on mgovcloud.in
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                return when (u.scheme) {
                    "https" -> false                           // Workplace, Government sign-in, MFA: stay inside
                    "http" -> { view.loadUrl(u.buildUpon().scheme("https").build().toString()); true } // never plain http
                    else -> { Web.openSafeIntent(this@WorkActivity, u.toString()); true } // mailto:, tel:, intent:
                }
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                errorPanel.visibility = View.GONE
                updateBar(url)
            }
            override fun onPageFinished(view: WebView, url: String?) {
                updateBar(url)
                if (clearHistoryOnLoad) { clearHistoryOnLoad = false; view.clearHistory(); updateBar(url) }
                CookieManager.getInstance().flush() // keep the Government session across app restarts
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError(if (Web.isOnline(this@WorkActivity)) getString(R.string.unreachable) else getString(R.string.offline))
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { updateBar(url) }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, p: Int) {
                progress.progress = p
                progress.visibility = if (p in 1..99) View.VISIBLE else View.GONE
            }
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams) = files.show(this@WorkActivity, cb, p)
        }
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ -> download(url, userAgent, contentDisposition, mimeType) }

        onBackPressedDispatcher.addCallback(this) {
            when {
                web.canGoBack() -> web.goBack()       // Back always steps back through Workplace pages first
                fullScreen -> setFullScreen(false)
                else -> goPersonal()
            }
        }

        if (prefs.getBoolean("fullscreen", false)) setFullScreen(true, remember = false)

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else load(intent.getStringExtra(EXTRA_URL))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.getStringExtra(EXTRA_URL)
        // Tapping Work again just returns to where you were; a different shortcut opens that page.
        if (url != null && url != home && url != web.url) load(url)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private fun load(url: String?) {
        val target = url?.takeIf { Web.isGovernment(it) } ?: home
        if (!Web.isOnline(this)) { showError(getString(R.string.offline)); updateBar(target); return }
        web.loadUrl(target)
    }

    private fun reload() {
        if (!Web.isOnline(this)) return showError(getString(R.string.offline))
        errorPanel.visibility = View.GONE
        if (web.url.isNullOrBlank()) web.loadUrl(home) else web.reload()
    }

    private fun showError(msg: String) {
        errorText.text = msg
        errorPanel.visibility = View.VISIBLE
        progress.visibility = View.GONE
    }

    /** Shows only the site name (never the full address, which can contain sign-in parameters). */
    private fun updateBar(url: String?) {
        val u = try { Uri.parse(url ?: "") } catch (e: Exception) { null }
        hostView.text = u?.host ?: ""
        lockView.alpha = if (u?.scheme == "https") 1f else 0.3f
        btnBack.isEnabled = web.canGoBack(); btnBack.alpha = if (web.canGoBack()) 1f else 0.35f
        btnForward.isEnabled = web.canGoForward(); btnForward.alpha = if (web.canGoForward()) 1f else 0.35f
    }

    private fun goPersonal() {
        startActivity(Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(MainActivity.EXTRA_FROM_WORK, true))
    }

    // ---------------- downloads ----------------
    private fun download(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        if (!url.startsWith("https://")) {
            Toast.makeText(this, getString(R.string.download_unsupported), Toast.LENGTH_LONG).show()
            return
        }
        try {
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val req = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .addRequestHeader("User-Agent", userAgent ?: web.settings.userAgentString)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            // The Government site's own session cookie is attached so the file downloads as you.
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            getSystemService(DownloadManager::class.java).enqueue(req)
            Toast.makeText(this, getString(R.string.downloading, name), Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, getString(R.string.download_unsupported), Toast.LENGTH_LONG).show()
        }
    }

    // ---------------- menu ----------------
    private fun showMenu(anchor: View) {
        val menu = PopupMenu(this, anchor)
        menu.menu.add(0, 8, 0, R.string.forward).isEnabled = web.canGoForward()
        menu.menu.add(0, 1, 0, R.string.reload)
        menu.menu.add(0, 2, 1, R.string.home)
        menu.menu.add(0, 3, 2, R.string.desktop_site).apply { isCheckable = true; isChecked = prefs.getBoolean("desktop", false) }
        menu.menu.add(0, 4, 3, if (fullScreen) R.string.exit_full_screen else R.string.full_screen)
        menu.menu.add(0, 5, 4, R.string.open_browser)
        menu.menu.add(0, 6, 5, R.string.clear_session)
        menu.menu.add(0, 7, 6, R.string.personal)
        menu.setOnMenuItemClickListener {
            when (it.itemId) {
                1 -> reload()
                2 -> { clearHistoryOnLoad = false; load(home) }
                3 -> { val on = !prefs.getBoolean("desktop", false); prefs.edit().putBoolean("desktop", on).apply(); applyDesktopMode(on, reloadPage = true) }
                4 -> setFullScreen(!fullScreen)
                8 -> if (web.canGoForward()) web.goForward()
                5 -> Web.openInBrowser(this, web.url ?: home)
                6 -> confirmClearSession()
                7 -> goPersonal()
            }
            true
        }
        menu.show()
    }

    /** "Desktop site": the same switch Chrome has — asks the site for its computer layout. */
    private fun applyDesktopMode(on: Boolean, reloadPage: Boolean) {
        web.settings.userAgentString = if (on)
            defaultUa.replace(Regex("\\(Linux; Android [^)]*\\)"), "(X11; Linux x86_64)").replace(" Mobile", "")
        else defaultUa
        if (reloadPage) reload()
    }

    /**
     * Full screen gives the Workplace page the whole display: LifeMail's bar and the phone's status and
     * navigation bars are hidden. A small round button stays on top to bring the bar back (it can be
     * dragged out of the way). The choice is remembered.
     */
    private fun setFullScreen(on: Boolean, remember: Boolean = true) {
        fullScreen = on
        toolbar.visibility = if (on) View.GONE else View.VISIBLE
        btnExitFull.visibility = if (on) View.VISIBLE else View.GONE
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        } else c.show(WindowInsetsCompat.Type.systemBars())
        if (remember) {
            if (on && !prefs.getBoolean("fullscreenHintShown", false)) {
                Toast.makeText(this, R.string.full_screen_hint, Toast.LENGTH_LONG).show()
                prefs.edit().putBoolean("fullscreenHintShown", true).apply()
            }
            prefs.edit().putBoolean("fullscreen", on).apply()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupExitFullButton() {
        var downX = 0f; var downY = 0f; var startTx = 0f; var startTy = 0f; var moved = false
        btnExitFull.translationX = prefs.getFloat("exitBtnX", 0f)
        btnExitFull.translationY = prefs.getFloat("exitBtnY", 0f)
        btnExitFull.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startTx = v.translationX; startTy = v.translationY; moved = false; true }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (moved || kotlin.math.abs(dx) + kotlin.math.abs(dy) > 12) {
                        moved = true
                        val parent = v.parent as View
                        v.translationX = (startTx + dx).coerceIn(-v.left.toFloat(), (parent.width - v.right).toFloat())
                        v.translationY = (startTy + dy).coerceIn(-v.top.toFloat(), (parent.height - v.bottom).toFloat())
                    }
                    true
                }
                android.view.MotionEvent.ACTION_UP -> {
                    if (moved) prefs.edit().putFloat("exitBtnX", v.translationX).putFloat("exitBtnY", v.translationY).apply()
                    else { v.performClick(); setFullScreen(false) }
                    true
                }
                else -> false
            }
        }
    }

    /** Signs out of Workplace on this phone: wipes ONLY the Work browser's data (this process). */
    private fun confirmClearSession() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.clear_session)
            .setMessage(R.string.clear_session_q)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.clear) { _, _ ->
                CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush() }
                WebStorage.getInstance().deleteAllData()
                web.clearCache(true)
                web.clearFormData()
                clearHistoryOnLoad = true
                load(home)
                Toast.makeText(this, R.string.session_cleared, Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    companion object {
        const val EXTRA_URL = "url"
    }
}
