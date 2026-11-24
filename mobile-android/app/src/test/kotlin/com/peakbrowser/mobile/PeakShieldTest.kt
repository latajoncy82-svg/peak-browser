package com.peakbrowser.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PeakShieldTest {
  private val shield = PeakShield(
    setOf("doubleclick.net", "googlesyndication.com", "gemius.pl", "ads.example.org")
  )

  @Test
  fun blocksThirdPartyAdDomainsAndSubdomains() {
    assertTrue(shield.isBlockedHost("pagead2.googlesyndication.com", "onet.pl"))
    assertTrue(shield.isBlockedHost("hit.gemius.pl", "wp.pl"))
    assertTrue(shield.isBlockedHost("doubleclick.net", "example.com"))
    assertFalse(shield.isBlockedHost("peaklabstudio.vercel.app", "peaklabstudio.vercel.app"))
    assertFalse(shield.isBlockedHost("doubleclick.net", "doubleclick.net"))
  }

  @Test
  fun stripsTrackingParamsPreservingContentParams() {
    val cleaned = shield.stripTrackingParams("https://example.com/artykul?utm_source=fb&fbclid=xyz&id=42")
    assertEquals("https://example.com/artykul?id=42", cleaned)
    assertNull(shield.stripTrackingParams("https://example.com/artykul?id=42"))
  }

  @Test
  fun upgradesHttpExceptLocalhostAndFailed() {
    assertEquals("https://example.com/path?a=1", shield.shouldUpgradeToHttps("http://example.com/path?a=1"))
    assertNull(shield.shouldUpgradeToHttps("http://localhost:3000/test"))
    assertNull(shield.shouldUpgradeToHttps("http://192.168.1.10/status"))
    assertNull(shield.shouldUpgradeToHttps("http://legacy.pl/", setOf("legacy.pl")))
  }

  @Test
  fun resolvesUrlsAndSearchQueries() {
    assertEquals("https://peakbrowser.vercel.app/", PeakShield.normalizeInputToUrl("peakbrowser.vercel.app/"))
    assertEquals("http://localhost:8080", PeakShield.normalizeInputToUrl("localhost:8080"))
    assertEquals(
      "https://duckduckgo.com/?q=peak+browser",
      PeakShield.normalizeInputToUrl("peak browser", "duckduckgo")
    )
  }

  @Test
  fun parsesNetscapeHtmlBookmarks() {
    val html = """
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://peaklabstudio.vercel.app/#o-firmie">PEAK LABS</A>
        <DT><A HREF="chrome://settings">Settings</A>
        <DT><A HREF="https://github.com/latajoncy82-svg">GitHub &amp; Code</A>
      </DL><p>
    """.trimIndent()
    val parsed = BookmarkHtmlParser.parse(html)
    assertEquals(2, parsed.size)
    assertEquals("https://peaklabstudio.vercel.app/#o-firmie", parsed[0].url)
    assertEquals("GitHub & Code", parsed[1].title)
  }
}
