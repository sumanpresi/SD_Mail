package com.suman.lifemail

import android.accounts.Account
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import org.json.JSONArray
import org.json.JSONObject

/**
 * PERSONAL — the LifeMail app (Gmail) shown full-screen.
 *
 * Google does not allow its sign-in page inside an embedded WebView, so Gmail sign-in uses Android's
 * own Google account system (Google Play services). The page asks for sign-in through a small,
 * origin-locked message channel ("LifeMailAndroid") that ONLY the LifeMail web address can use.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val files = FileChooser(this)
    private var proxy: JavaScriptReplyProxy? = null
    private var pendingAuthId: Int = -1
    private val lifemailOrigin = BuildConfig.LIFEMAIL_URL.trimEnd('/')
    private val lifemailHost = Web.host(BuildConfig.LIFEMAIL_URL)

    private val authLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        val id = pendingAuthId; pendingAuthId = -1
        if (res.resultCode != RESULT_OK) return@registerForActivityResult reply(id, error = "access_denied")
        try {
            val r = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(res.data)
            replyToken(id, r)
        } catch (e: ApiException) {
            reply(id, error = authError(e))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        Web.applyInsets(findViewById(R.id.root))
        web = findViewById(R.id.web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(true) // so window.open() links can be sent to the browser
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "https" && u.host == lifemailHost) return false   // LifeMail itself
                if (u.scheme == "http" || u.scheme == "https") Web.openInBrowser(this@MainActivity, u.toString())
                else Web.openSafeIntent(this@MainActivity, u.toString())
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: android.webkit.ValueCallback<Array<Uri>>, p: FileChooserParams) = files.show(this@MainActivity, cb, p)
            override fun onCreateWindow(v: WebView, isDialog: Boolean, isUserGesture: Boolean, msg: android.os.Message?) = interceptNewWindow(this@MainActivity, v, msg)
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "LifeMailAndroid", setOf(lifemailOrigin)) { _, message, _, isMainFrame, replyProxy ->
                if (!isMainFrame) return@addWebMessageListener
                proxy = replyProxy
                message.data?.let { handle(it) }
            }
        }

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("$lifemailOrigin/?app=android")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_FROM_WORK, false)) event("workClosed")
    }

    // ---------------- messages from the LifeMail page ----------------
    private fun handle(raw: String) {
        val m = try { JSONObject(raw) } catch (e: Exception) { return }
        val id = m.optInt("id", -1)
        when (m.optString("type")) {
            "hello" -> reply(id, JSONObject().put("app", "android").put("version", BuildConfig.VERSION_NAME))
            "signIn" -> signIn(id, m.optString("hint"), m.optBoolean("silent"), m.optString("oldToken"))
            "openWork" -> {
                val url = m.optString("url").takeIf { Web.isGovernment(it) } ?: BuildConfig.WORK_HOME
                startActivity(Intent(this, WorkActivity::class.java).putExtra(WorkActivity.EXTRA_URL, url).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                reply(id, JSONObject())
            }
            "saveFile" -> saveFile(id, m)
            "shareText" -> {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, m.optString("title").take(200))
                    .putExtra(Intent.EXTRA_TEXT, m.optString("text").take(20000))
                startActivity(Intent.createChooser(send, m.optString("title").ifBlank { "Share" }.take(80)))
                reply(id, JSONObject())
            }
            "openExternal" -> {
                val url = m.optString("url")
                if (url.startsWith("https://")) Web.openInBrowser(this, url)
                reply(id, JSONObject())
            }
            else -> reply(id, error = "unknown_request")
        }
    }

    private fun saveFile(id: Int, m: JSONObject) {
        val b64 = m.optString("base64")
        if (b64.length > 40_000_000) return reply(id, error = "File is too large")
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { return reply(id, error = "Bad file data") }
        val name = m.optString("name", "file")
        val mime = m.optString("mime", "application/octet-stream")
        val uri = try { Web.saveToDownloads(this, name, mime, bytes) } catch (e: Exception) { null }
            ?: return reply(id, error = "Could not save to Downloads")
        when (m.optString("action")) {
            "open" -> try {
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (e: Exception) { Toast.makeText(this, "Saved to Downloads — no app here opens this file type", Toast.LENGTH_LONG).show() }
            "share" -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), name))
            else -> Toast.makeText(this, "Saved to Downloads: $name", Toast.LENGTH_SHORT).show()
        }
        reply(id, JSONObject().put("saved", true))
    }

    // ---------------- Google sign-in through Android (no password ever reaches LifeMail) ----------------
    private val scopes = listOf(
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/drive.appdata",
    )

    private fun signIn(id: Int, hint: String, silent: Boolean, oldToken: String) {
        Thread {
            // A token Gmail rejected is removed from Android's cache so a fresh one is issued.
            if (oldToken.isNotBlank()) try { GoogleAuthUtil.clearToken(applicationContext, oldToken) } catch (_: Exception) { }
            runOnUiThread { authorize(id, hint, silent) }
        }.start()
    }

    private fun authorize(id: Int, hint: String, silent: Boolean) {
        val builder = AuthorizationRequest.builder().setRequestedScopes(scopes.map { Scope(it) })
        if (hint.contains("@")) builder.setAccount(Account(hint, "com.google"))
        Identity.getAuthorizationClient(this).authorize(builder.build())
            .addOnSuccessListener { r ->
                if (r.hasResolution()) {
                    if (silent) return@addOnSuccessListener reply(id, error = "interaction_required")
                    val pi = r.pendingIntent ?: return@addOnSuccessListener reply(id, error = "no_resolution")
                    pendingAuthId = id
                    authLauncher.launch(IntentSenderRequest.Builder(pi.intentSender).build())
                } else replyToken(id, r)
            }
            .addOnFailureListener { e -> reply(id, error = authError(e)) }
    }

    private fun replyToken(id: Int, r: AuthorizationResult) {
        val token = r.accessToken ?: return reply(id, error = "no_token")
        reply(id, JSONObject()
            .put("accessToken", token)
            .put("scopes", JSONArray(r.grantedScopes))
            .put("email", r.toGoogleSignInAccount()?.email ?: ""))
    }

    private fun authError(e: Exception): String {
        val code = (e as? ApiException)?.statusCode
        return when (code) {
            10 -> "android_not_configured" // DEVELOPER_ERROR: Android OAuth client / SHA-1 not registered
            7 -> "network"
            16, 12501 -> "access_denied"
            else -> e.message ?: "sign_in_failed"
        }
    }

    // ---------------- replies back to the page ----------------
    private fun reply(id: Int, data: JSONObject = JSONObject(), error: String? = null) {
        val p = proxy ?: return
        data.put("id", id).put("ok", error == null)
        if (error != null) data.put("error", error)
        runOnUiThread { try { p.postMessage(data.toString()) } catch (_: Exception) { } }
    }

    private fun event(name: String) {
        val p = proxy ?: return
        runOnUiThread { try { p.postMessage(JSONObject().put("event", name).toString()) } catch (_: Exception) { } }
    }

    companion object {
        const val EXTRA_FROM_WORK = "fromWork"
    }
}
