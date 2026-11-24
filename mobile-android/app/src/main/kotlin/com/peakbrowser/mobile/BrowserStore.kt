package com.peakbrowser.mobile

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class BookmarkEntry(
  val url: String,
  val title: String,
  val createdAt: Long = System.currentTimeMillis()
)

data class HistoryEntry(
  val url: String,
  val title: String,
  val visitedAt: Long = System.currentTimeMillis()
)

data class MobileSettings(
  val searchEngine: String = "google",
  val shieldEnabled: Boolean = true,
  val httpsFirst: Boolean = true,
  val totalBlocked: Int = 0
)

object BookmarkHtmlParser {
  private val LINK_REGEX = Regex("<A\\b([^>]*)>([\\s\\S]*?)</A>", RegexOption.IGNORE_CASE)
  private val HREF_REGEX = Regex("HREF\\s*=\\s*[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)

  private fun decodeEntities(input: String): String {
    return input
      .replace("&amp;", "&", ignoreCase = true)
      .replace("&lt;", "<", ignoreCase = true)
      .replace("&gt;", ">", ignoreCase = true)
      .replace("&quot;", "\"", ignoreCase = true)
      .replace("&#39;", "'", ignoreCase = true)
      .replace("&apos;", "'", ignoreCase = true)
  }

  fun parse(html: String): List<BookmarkEntry> {
    if (html.isBlank()) return emptyList()
    val result = mutableListOf<BookmarkEntry>()
    val seen = HashSet<String>()
    for (match in LINK_REGEX.findAll(html)) {
      val attrs = match.groupValues[1]
      val rawTitle = match.groupValues[2]
      val hrefMatch = HREF_REGEX.find(attrs) ?: continue
      val url = decodeEntities(hrefMatch.groupValues[1]).trim()
      val lower = url.lowercase(Locale.ROOT)
      if (!lower.startsWith("http://") && !lower.startsWith("https://")) continue
      if (!seen.add(url)) continue
      val cleanTitle = decodeEntities(rawTitle.replace(Regex("<[^>]+>"), ""))
        .replace(Regex("\\s+"), " ")
        .trim()
      result.add(BookmarkEntry(url = url, title = cleanTitle.ifEmpty { url }))
    }
    return result
  }
}

class BrowserStore(context: Context) {
  private val prefs: SharedPreferences =
    context.getSharedPreferences("peak_browser_state", Context.MODE_PRIVATE)

  companion object {
    private const val KEY_BOOKMARKS = "bookmarks"
    private const val KEY_HISTORY = "history"
    private const val KEY_SEARCH_ENGINE = "search_engine"
    private const val KEY_SHIELD_ENABLED = "shield_enabled"
    private const val KEY_HTTPS_FIRST = "https_first"
    private const val KEY_TOTAL_BLOCKED = "total_blocked"
    private const val MAX_HISTORY = 400
  }

  fun loadSettings(): MobileSettings {
    return MobileSettings(
      searchEngine = prefs.getString(KEY_SEARCH_ENGINE, "google") ?: "google",
      shieldEnabled = prefs.getBoolean(KEY_SHIELD_ENABLED, true),
      httpsFirst = prefs.getBoolean(KEY_HTTPS_FIRST, true),
      totalBlocked = prefs.getInt(KEY_TOTAL_BLOCKED, 0)
    )
  }

  fun saveSettings(settings: MobileSettings) {
    prefs.edit()
      .putString(KEY_SEARCH_ENGINE, settings.searchEngine)
      .putBoolean(KEY_SHIELD_ENABLED, settings.shieldEnabled)
      .putBoolean(KEY_HTTPS_FIRST, settings.httpsFirst)
      .putInt(KEY_TOTAL_BLOCKED, settings.totalBlocked)
      .apply()
  }

  fun incrementTotalBlocked(): Int {
    val next = prefs.getInt(KEY_TOTAL_BLOCKED, 0) + 1
    prefs.edit().putInt(KEY_TOTAL_BLOCKED, next).apply()
    return next
  }

  fun loadBookmarks(): List<BookmarkEntry> {
    val raw = prefs.getString(KEY_BOOKMARKS, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      buildList {
        for (i in 0 until arr.length()) {
          val obj = arr.optJSONObject(i) ?: continue
          val url = obj.optString("url")
          if (url.isNotBlank()) {
            add(
              BookmarkEntry(
                url = url,
                title = obj.optString("title").ifBlank { url },
                createdAt = obj.optLong("createdAt", 0L)
              )
            )
          }
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun saveBookmarks(items: List<BookmarkEntry>) {
    val arr = JSONArray()
    for (item in items) {
      arr.put(
        JSONObject()
          .put("url", item.url)
          .put("title", item.title)
          .put("createdAt", item.createdAt)
      )
    }
    prefs.edit().putString(KEY_BOOKMARKS, arr.toString()).apply()
  }

  fun toggleBookmark(url: String, title: String): List<BookmarkEntry> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return loadBookmarks()
    val current = loadBookmarks().toMutableList()
    val existingIdx = current.indexOfFirst { it.url == url }
    if (existingIdx >= 0) {
      current.removeAt(existingIdx)
    } else {
      current.add(0, BookmarkEntry(url = url, title = title.ifBlank { url }))
    }
    saveBookmarks(current)
    return current
  }

  fun importBookmarks(items: List<BookmarkEntry>): Pair<Int, List<BookmarkEntry>> {
    val current = loadBookmarks().toMutableList()
    val existingUrls = current.mapTo(HashSet()) { it.url }
    var added = 0
    for (item in items) {
      if (existingUrls.add(item.url)) {
        current.add(0, item)
        added += 1
      }
    }
    if (added > 0) {
      saveBookmarks(current)
    }
    return added to current
  }

  fun removeBookmark(url: String): List<BookmarkEntry> {
    val next = loadBookmarks().filterNot { it.url == url }
    saveBookmarks(next)
    return next
  }

  fun loadHistory(): List<HistoryEntry> {
    val raw = prefs.getString(KEY_HISTORY, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      buildList {
        for (i in 0 until arr.length()) {
          val obj = arr.optJSONObject(i) ?: continue
          val url = obj.optString("url")
          if (url.isNotBlank()) {
            add(
              HistoryEntry(
                url = url,
                title = obj.optString("title").ifBlank { url },
                visitedAt = obj.optLong("visitedAt", 0L)
              )
            )
          }
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun saveHistory(items: List<HistoryEntry>) {
    val arr = JSONArray()
    for (item in items.take(MAX_HISTORY)) {
      arr.put(
        JSONObject()
          .put("url", item.url)
          .put("title", item.title)
          .put("visitedAt", item.visitedAt)
      )
    }
    prefs.edit().putString(KEY_HISTORY, arr.toString()).apply()
  }

  fun recordHistory(url: String, title: String): List<HistoryEntry> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return loadHistory()
    val current = loadHistory().toMutableList()
    val cleanTitle = title.ifBlank { url }
    val first = current.firstOrNull()
    if (first != null && first.url == url) {
      current[0] = first.copy(title = cleanTitle, visitedAt = System.currentTimeMillis())
    } else {
      current.removeAll { it.url == url }
      current.add(0, HistoryEntry(url = url, title = cleanTitle, visitedAt = System.currentTimeMillis()))
    }
    saveHistory(current)
    return current.take(MAX_HISTORY)
  }

  fun clearHistory(): List<HistoryEntry> {
    prefs.edit().remove(KEY_HISTORY).apply()
    return emptyList()
  }
}
