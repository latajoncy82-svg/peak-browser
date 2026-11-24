package com.peakbrowser.mobile

import android.content.Context
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale

class PeakShield(private val blockedHosts: Set<String>) {

  companion object {
    val TRACKING_PARAMS: Set<String> = setOf(
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "utm_id", "utm_source_platform", "utm_creative_format",
      "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid",
      "mc_cid", "mc_eid", "igshid", "_hsenc", "_hsmi", "mkt_tok",
      "vero_conv", "vero_id", "spm"
    )

    val SEARCH_ENGINES: Map<String, String> = mapOf(
      "google" to "https://www.google.com/search?q=",
      "duckduckgo" to "https://duckduckgo.com/?q=",
      "brave" to "https://search.brave.com/search?q=",
      "bing" to "https://www.bing.com/search?q="
    )

    fun loadFromAssets(context: Context): PeakShield {
      val set = HashSet<String>(110_000)
      try {
        context.assets.open("mobile-ad-hosts.txt").bufferedReader().useLines { lines ->
          lines.forEach { raw ->
            val host = raw.trim().lowercase(Locale.ROOT)
            if (host.isNotEmpty() && !host.startsWith("#")) {
              set.add(host)
            }
          }
        }
      } catch (_: Exception) {
        // Ignore if asset unreadable
      }
      return PeakShield(set)
    }

    fun normalizeInputToUrl(rawInput: String, searchEngine: String = "google"): String {
      val text = rawInput.trim()
      if (text.isEmpty()) return "https://peaklabstudio.vercel.app/#o-firmie"
      if (text.startsWith("http://", ignoreCase = true) || text.startsWith("https://", ignoreCase = true)) {
        return text
      }
      if (!text.contains(' ')) {
        val lower = text.lowercase(Locale.ROOT)
        if (lower.startsWith("localhost") || Regex("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/.*)?$").matches(text)) {
          return "http://$text"
        }
        if (Regex("^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+(:\\d+)?(/.*)?$").matches(text)) {
          return "https://$text"
        }
      }
      val base = SEARCH_ENGINES[searchEngine] ?: SEARCH_ENGINES.getValue("google")
      val encoded = URLEncoder.encode(text, StandardCharsets.UTF_8.toString())
      return "$base$encoded"
    }
  }

  val ruleCount: Int
    get() = blockedHosts.size

  fun isBlockedHost(requestHost: String?, pageHost: String? = null): Boolean {
    if (requestHost.isNullOrBlank()) return false
    var clean = requestHost.trim().lowercase(Locale.ROOT).removePrefix("www.")
    val cleanPage = pageHost?.trim()?.lowercase(Locale.ROOT)?.removePrefix("www.")
    if (clean.isEmpty()) return false
    if (cleanPage != null && (clean == cleanPage || clean.endsWith(".$cleanPage"))) {
      return false
    }
    while (true) {
      if (blockedHosts.contains(clean)) return true
      val dot = clean.indexOf('.')
      if (dot < 0 || dot == clean.length - 1) break
      clean = clean.substring(dot + 1)
      if (!clean.contains('.')) break
    }
    return false
  }

  fun stripTrackingParams(rawUrl: String): String? {
    return try {
      val uri = URI(rawUrl)
      val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
      if (scheme != "http" && scheme != "https") return null
      val query = uri.rawQuery ?: return null
      val pairs = query.split('&')
      val kept = ArrayList<String>(pairs.size)
      var removed = false
      for (pair in pairs) {
        if (pair.isEmpty()) continue
        val eqIdx = pair.indexOf('=')
        val key = (if (eqIdx >= 0) pair.substring(0, eqIdx) else pair).lowercase(Locale.ROOT)
        if (TRACKING_PARAMS.contains(key) || key.startsWith("utm_")) {
          removed = true
        } else {
          kept.add(pair)
        }
      }
      if (!removed) return null
      val nextQuery = if (kept.isEmpty()) null else kept.joinToString("&")
      URI(uri.scheme, uri.rawAuthority, uri.rawPath, nextQuery, uri.rawFragment).toASCIIString()
    } catch (_: Exception) {
      null
    }
  }

  fun shouldUpgradeToHttps(rawUrl: String, failedHosts: Set<String> = emptySet()): String? {
    return try {
      val uri = URI(rawUrl)
      if (!uri.scheme.equals("http", ignoreCase = true)) return null
      val host = uri.host?.lowercase(Locale.ROOT) ?: return null
      if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host.endsWith(".local")) return null
      if (Regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(host)) return null
      if (failedHosts.contains(host)) return null
      URI("https", uri.rawAuthority, uri.rawPath, uri.rawQuery, uri.rawFragment).toASCIIString()
    } catch (_: Exception) {
      null
    }
  }
}
