package com.suman.lifemail

import android.app.Application
import android.os.Build
import android.webkit.WebView
import java.io.File

/**
 * Work runs in its own process (":work"). Giving that process its own WebView data directory means
 * the Government Workplace cookies, storage and cache live in a completely separate folder from
 * Personal (LifeMail/Gmail) — they can never mix, and "Clear Work session" never touches Personal.
 *
 * If the app ever stops unexpectedly, the technical error (no personal data) is saved on the phone
 * and shown the next time LifeMail opens, with a Share button, so it can be reported and fixed.
 */
class LifeMailApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val process = getProcessName() ?: ""
        if (process.endsWith(":work")) WebView.setDataDirectorySuffix("work")

        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val report = buildString {
                    appendLine("LifeMail ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}")
                    appendLine("Process: $process · Thread: ${thread.name}")
                    appendLine(error.stackTraceToString().take(12000))
                }
                File(filesDir, CRASH_FILE).writeText(report)
            } catch (_: Throwable) { }
            previous?.uncaughtException(thread, error)
        }
    }

    companion object { const val CRASH_FILE = "last_crash.txt" }
}
