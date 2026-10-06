package com.suman.lifemail

import android.app.Application
import android.webkit.WebView

/**
 * Work runs in its own process (":work"). Giving that process its own WebView data directory means
 * the Government Workplace cookies, storage and cache live in a completely separate folder from
 * Personal (LifeMail/Gmail) — they can never mix, and "Clear Work session" never touches Personal.
 */
class LifeMailApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val process = getProcessName() ?: ""
        if (process.endsWith(":work")) WebView.setDataDirectorySuffix("work")
    }
}
