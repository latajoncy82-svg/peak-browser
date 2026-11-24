package com.peakbrowser.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.peakbrowser.mobile.ui.theme.PeakBrowserTheme
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

private const val STARTUP_COMPANY_URL = "https://peaklabstudio.vercel.app/#o-firmie"

class TabState(
  val id: Long,
  val isIncognito: Boolean,
  val webView: WebView,
  initialUrl: String
) {
  var url by mutableStateOf(initialUrl)
  var title by mutableStateOf(if (isIncognito) "Karta Incognito" else "Peak Browser")
  var isLoading by mutableStateOf(true)
  var progress by mutableIntStateOf(10)
  var canGoBack by mutableStateOf(false)
  var canGoForward by mutableStateOf(false)
  var blockedCount by mutableIntStateOf(0)
}

class MainActivity : ComponentActivity() {
  private val incomingUrlState = mutableStateOf<String?>(null)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(0xFF08101C.toInt()),
      navigationBarStyle = SystemBarStyle.dark(0xFF08101C.toInt())
    )

    val launchUrl = extractIntentUrl(intent)
    val shield = PeakShield.loadFromAssets(applicationContext)
    val store = BrowserStore(applicationContext)

    setContent {
      PeakBrowserTheme {
        PeakMobileBrowserApp(
          activity = this,
          shield = shield,
          store = store,
          initialUrl = launchUrl ?: STARTUP_COMPANY_URL,
          externalNavigationUrl = incomingUrlState.value,
          onConsumedExternalUrl = { incomingUrlState.value = null }
        )
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val url = extractIntentUrl(intent)
    if (!url.isNullOrBlank()) {
      incomingUrlState.value = url
    }
  }

  private fun extractIntentUrl(intent: Intent?): String? {
    if (intent?.action != Intent.ACTION_VIEW) return null
    val data = intent.dataString?.trim() ?: return null
    return if (data.startsWith("http://", true) || data.startsWith("https://", true)) data else null
  }
}

private fun extractHost(url: String?): String? {
  if (url.isNullOrBlank()) return null
  return try {
    URI(url).host?.lowercase(Locale.ROOT)?.removePrefix("www.")
  } catch (_: Exception) {
    null
  }
}

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeakMobileBrowserApp(
  activity: ComponentActivity,
  shield: PeakShield,
  store: BrowserStore,
  initialUrl: String,
  externalNavigationUrl: String?,
  onConsumedExternalUrl: () -> Unit
) {
  val mainHandler = remember { Handler(Looper.getMainLooper()) }
  val snackbarHostState = remember { SnackbarHostState() }
  val scope = rememberCoroutineScope()
  val focusManager = LocalFocusManager.current

  val upgradedHttpsHosts = remember { ConcurrentHashMap.newKeySet<String>() }
  val failedHttpsHosts = remember { ConcurrentHashMap.newKeySet<String>() }

  var settings by remember { mutableStateOf(store.loadSettings()) }
  var bookmarks by remember { mutableStateOf(store.loadBookmarks()) }
  var history by remember { mutableStateOf(store.loadHistory()) }

  val tabs = remember { mutableStateListOf<TabState>() }
  var activeTabId by remember { mutableStateOf<Long?>(null) }
  var nextTabSeq by remember { mutableIntStateOf(1) }

  var showTabsSheet by remember { mutableStateOf(false) }
  var showMenuSheet by remember { mutableStateOf(false) }
  var menuSheetTab by remember { mutableIntStateOf(0) } // 0: Menu, 1: Bookmarks, 2: History

  fun prepareNavigationUrl(rawUrl: String): String {
    var target = rawUrl.trim()
    val cleaned = shield.stripTrackingParams(target)
    if (cleaned != null) target = cleaned
    if (settings.httpsFirst) {
      val upgraded = shield.shouldUpgradeToHttps(target, failedHttpsHosts)
      if (upgraded != null) {
        extractHost(upgraded)?.let { upgradedHttpsHosts.add(it) }
        target = upgraded
      }
    }
    return target
  }

  fun createTab(startUrl: String, incognito: Boolean): TabState {
    val tabId = nextTabSeq.toLong()
    nextTabSeq += 1
    val targetUrl = prepareNavigationUrl(startUrl)
    val webView = WebView(activity)
    val tab = TabState(
      id = tabId,
      isIncognito = incognito,
      webView = webView,
      initialUrl = targetUrl
    )

    webView.settings.apply {
      javaScriptEnabled = true
      useWideViewPort = true
      loadWithOverviewMode = true
      setSupportZoom(true)
      builtInZoomControls = true
      displayZoomControls = false
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      domStorageEnabled = !incognito
      databaseEnabled = !incognito
      @Suppress("DEPRECATION")
      saveFormData = !incognito
      cacheMode = if (incognito) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
      userAgentString = userAgentString.replace("; wv", "")
    }

    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, !incognito)

    webView.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView?, newProgress: Int) {
        tab.progress = newProgress.coerceIn(0, 100)
        if (newProgress >= 100) {
          tab.isLoading = false
        }
      }

      override fun onReceivedTitle(view: WebView?, title: String?) {
        if (!title.isNullOrBlank()) {
          tab.title = title
          if (!tab.isIncognito) {
            history = store.recordHistory(tab.url, title)
          }
        }
      }
    }

    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val raw = request?.url?.toString() ?: return false
        if (raw.startsWith("intent://") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
          try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(raw)))
          } catch (_: Exception) {
          }
          return true
        }
        if (!raw.startsWith("http://", true) && !raw.startsWith("https://", true)) {
          return true
        }
        if (request.isForMainFrame) {
          val rewritten = prepareNavigationUrl(raw)
          if (rewritten != raw) {
            view?.loadUrl(rewritten)
            return true
          }
        }
        return false
      }

      override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
        if (request == null || request.isForMainFrame) return null
        if (!settings.shieldEnabled) return null
        val reqHost = request.url?.host ?: return null
        val pageHost = extractHost(tab.url)
        if (shield.isBlockedHost(reqHost, pageHost)) {
          mainHandler.post {
            tab.blockedCount += 1
            val nextTotal = store.incrementTotalBlocked()
            settings = settings.copy(totalBlocked = nextTotal)
          }
          return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
        }
        return null
      }

      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        if (!url.isNullOrBlank()) {
          tab.url = url
        }
        tab.isLoading = true
        tab.blockedCount = 0
        tab.canGoBack = view?.canGoBack() == true
        tab.canGoForward = view?.canGoForward() == true
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        if (!url.isNullOrBlank()) {
          tab.url = url
        }
        tab.isLoading = false
        tab.canGoBack = view?.canGoBack() == true
        tab.canGoForward = view?.canGoForward() == true
        val resolvedTitle = view?.title
        if (!resolvedTitle.isNullOrBlank()) {
          tab.title = resolvedTitle
        }
        if (!tab.isIncognito && tab.url.startsWith("http", true)) {
          history = store.recordHistory(tab.url, tab.title)
        }
      }

      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
      ) {
        if (request?.isForMainFrame != true) return
        val failedUrl = request.url?.toString() ?: return
        if (failedUrl.startsWith("https://", true)) {
          val host = extractHost(failedUrl)
          if (host != null && upgradedHttpsHosts.contains(host) && failedHttpsHosts.add(host)) {
            val httpUrl = "http://" + failedUrl.removePrefix("https://")
            mainHandler.post { view?.loadUrl(httpUrl) }
          }
        }
      }
    }

    webView.loadUrl(targetUrl)
    tabs.add(tab)
    activeTabId = tab.id
    return tab
  }

  fun closeTab(tab: TabState) {
    val idx = tabs.indexOfFirst { it.id == tab.id }
    if (idx < 0) return
    tabs.removeAt(idx)
    if (tab.isIncognito) {
      tab.webView.clearHistory()
      tab.webView.clearCache(true)
      tab.webView.clearFormData()
    }
    (tab.webView.parent as? ViewGroup)?.removeView(tab.webView)
    tab.webView.destroy()

    if (tab.isIncognito && tabs.none { it.isIncognito }) {
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      WebStorage.getInstance().deleteAllData()
    }

    if (tabs.isEmpty()) {
      createTab(STARTUP_COMPANY_URL, incognito = false)
    } else if (activeTabId == tab.id) {
      activeTabId = tabs[idx.coerceAtMost(tabs.lastIndex)].id
    }
  }

  LaunchedEffect(Unit) {
    if (tabs.isEmpty()) {
      createTab(initialUrl, incognito = false)
    }
  }

  LaunchedEffect(externalNavigationUrl) {
    if (!externalNavigationUrl.isNullOrBlank()) {
      createTab(externalNavigationUrl, incognito = false)
      onConsumedExternalUrl()
    }
  }

  DisposableEffect(Unit) {
    onDispose {
      for (t in tabs) {
        (t.webView.parent as? ViewGroup)?.removeView(t.webView)
        t.webView.destroy()
      }
      tabs.clear()
    }
  }

  val activeTab = tabs.firstOrNull { it.id == activeTabId } ?: tabs.firstOrNull()
  var omniboxText by remember(activeTab?.id, activeTab?.url) {
    mutableStateOf(activeTab?.url ?: "")
  }
  var isEditingOmnibox by remember { mutableStateOf(false) }

  val importHtmlLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.OpenDocument()
  ) { uri ->
    if (uri == null) return@rememberLauncherForActivityResult
    try {
      val content = activity.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
      val parsed = BookmarkHtmlParser.parse(content)
      if (parsed.isEmpty()) {
        scope.launch { snackbarHostState.showSnackbar("Nie znaleziono zakładek w pliku HTML.") }
      } else {
        val (added, nextBookmarks) = store.importBookmarks(parsed)
        bookmarks = nextBookmarks
        scope.launch {
          snackbarHostState.showSnackbar("Zaimportowano $added nowych zakładek.")
        }
      }
    } catch (_: Exception) {
      scope.launch { snackbarHostState.showSnackbar("Nie udało się odczytać pliku zakładek.") }
    }
  }

  BackHandler(enabled = showTabsSheet || showMenuSheet || (activeTab?.canGoBack == true)) {
    when {
      showTabsSheet -> showTabsSheet = false
      showMenuSheet -> showMenuSheet = false
      activeTab?.webView?.canGoBack() == true -> activeTab.webView.goBack()
    }
  }

  val isIncognitoActive = activeTab?.isIncognito == true
  val barBg = if (isIncognitoActive) Color(0xFF111326) else Color(0xFF0E1829)
  val omniboxBg = if (isIncognitoActive) Color(0xFF080A15) else Color(0xFF08101C)
  val accentColor = if (isIncognitoActive) Color(0xFF8B7BFF) else Color(0xFF3898FF)

  Scaffold(
    containerColor = Color(0xFF08101C),
    snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
    topBar = {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .background(barBg)
          .statusBarsPadding()
      ) {
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 8.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          Row(
            modifier = Modifier
              .weight(1f)
              .height(42.dp)
              .clip(RoundedCornerShape(12.dp))
              .background(omniboxBg)
              .border(
                width = 1.dp,
                color = if (isEditingOmnibox) accentColor else Color(0x2894C3FF),
                shape = RoundedCornerShape(12.dp)
              )
              .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically
          ) {
            if (isIncognitoActive) {
              Box(
                modifier = Modifier
                  .clip(RoundedCornerShape(999.dp))
                  .background(Color(0x338B7BFF))
                  .padding(horizontal = 7.dp, vertical = 2.dp)
              ) {
                Text(
                  text = "Incognito",
                  color = Color(0xFFDCD6FF),
                  fontSize = 11.sp,
                  fontWeight = FontWeight.SemiBold
                )
              }
              Spacer(Modifier.width(6.dp))
            } else {
              Icon(
                imageVector = if (activeTab?.url?.startsWith("https://", true) == true) {
                  Icons.Rounded.Lock
                } else {
                  Icons.Rounded.Public
                },
                contentDescription = null,
                tint = Color(0xFF7EA6D8),
                modifier = Modifier.size(16.dp)
              )
              Spacer(Modifier.width(8.dp))
            }

            if (isEditingOmnibox) {
              BasicTextField(
                value = omniboxText,
                onValueChange = { omniboxText = it },
                singleLine = true,
                textStyle = TextStyle(color = Color(0xFFEBF2FC), fontSize = 14.sp),
                cursorBrush = SolidColor(accentColor),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(
                  onGo = {
                    val target = prepareNavigationUrl(
                      PeakShield.normalizeInputToUrl(omniboxText, settings.searchEngine)
                    )
                    activeTab?.webView?.loadUrl(target)
                    isEditingOmnibox = false
                    focusManager.clearFocus()
                  }
                ),
                modifier = Modifier.weight(1f)
              )
              IconButton(
                onClick = {
                  if (omniboxText.isNotEmpty()) omniboxText = "" else isEditingOmnibox = false
                },
                modifier = Modifier.size(28.dp)
              ) {
                Icon(
                  imageVector = Icons.Rounded.Close,
                  contentDescription = "Wyczyść",
                  tint = Color(0xFF879CB8),
                  modifier = Modifier.size(16.dp)
                )
              }
            } else {
              Text(
                text = extractHost(activeTab?.url) ?: activeTab?.url ?: "peaklabstudio.vercel.app",
                color = Color(0xFFEBF2FC),
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                  .weight(1f)
                  .clickable {
                    omniboxText = activeTab?.url ?: ""
                    isEditingOmnibox = true
                  }
              )
            }
          }

          Surface(
            color = if (settings.shieldEnabled) Color(0x223898FF) else Color(0x18879CB8),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier
              .height(38.dp)
              .clickable {
                menuSheetTab = 0
                showMenuSheet = true
              }
          ) {
            Row(
              modifier = Modifier.padding(horizontal = 9.dp),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
              Icon(
                imageVector = Icons.Rounded.Shield,
                contentDescription = "Peak Shield",
                tint = if (settings.shieldEnabled) Color(0xFF56ADFF) else Color(0xFF879CB8),
                modifier = Modifier.size(16.dp)
              )
              Text(
                text = "${activeTab?.blockedCount ?: 0}",
                color = Color(0xFFEBF2FC),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
              )
            }
          }

          IconButton(
            onClick = {
              if (activeTab?.isLoading == true) activeTab.webView.stopLoading()
              else activeTab?.webView?.reload()
            },
            modifier = Modifier.size(38.dp)
          ) {
            Icon(
              imageVector = if (activeTab?.isLoading == true) Icons.Rounded.Close else Icons.Rounded.Refresh,
              contentDescription = "Odśwież",
              tint = Color(0xFFB8CBE3),
              modifier = Modifier.size(20.dp)
            )
          }
        }

        if (activeTab?.isLoading == true) {
          LinearProgressIndicator(
            progress = { (activeTab.progress / 100f).coerceIn(0.05f, 1f) },
            modifier = Modifier
              .fillMaxWidth()
              .height(2.dp),
            color = accentColor,
            trackColor = Color.Transparent
          )
        } else {
          HorizontalDivider(color = Color(0x1E94C3FF), thickness = 1.dp)
        }
      }
    },
    bottomBar = {
      Surface(
        color = barBg,
        modifier = Modifier.fillMaxWidth()
      ) {
        Column(modifier = Modifier.navigationBarsPadding()) {
          HorizontalDivider(color = Color(0x1E94C3FF), thickness = 1.dp)
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .height(54.dp)
              .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
          ) {
            IconButton(
              onClick = { activeTab?.webView?.goBack() },
              enabled = activeTab?.canGoBack == true
            ) {
              Icon(
                imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                contentDescription = "Wstecz",
                tint = if (activeTab?.canGoBack == true) Color(0xFFEBF2FC) else Color(0x44879CB8)
              )
            }

            IconButton(
              onClick = { activeTab?.webView?.goForward() },
              enabled = activeTab?.canGoForward == true
            ) {
              Icon(
                imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                contentDescription = "Dalej",
                tint = if (activeTab?.canGoForward == true) Color(0xFFEBF2FC) else Color(0x44879CB8)
              )
            }

            IconButton(
              onClick = {
                createTab(STARTUP_COMPANY_URL, incognito = true)
              }
            ) {
              Icon(
                imageVector = Icons.Rounded.VisibilityOff,
                contentDescription = "Nowa karta Incognito",
                tint = if (isIncognitoActive) Color(0xFFB8ADFF) else Color(0xFFB8CBE3)
              )
            }

            Surface(
              color = if (isIncognitoActive) Color(0x288B7BFF) else Color(0x1F3898FF),
              shape = RoundedCornerShape(9.dp),
              modifier = Modifier
                .border(1.dp, Color(0x4494C3FF), RoundedCornerShape(9.dp))
                .clickable { showTabsSheet = true }
            ) {
              Text(
                text = "${tabs.size}",
                color = Color(0xFFEBF2FC),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.dp)
              )
            }

            IconButton(
              onClick = {
                menuSheetTab = 0
                showMenuSheet = true
              }
            ) {
              Icon(
                imageVector = Icons.Rounded.MoreVert,
                contentDescription = "Menu",
                tint = Color(0xFFEBF2FC)
              )
            }
          }
        }
      }
    }
  ) { innerPadding ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding)
        .background(Color(0xFF08101C))
    ) {
      if (activeTab != null) {
        AndroidView(
          modifier = Modifier.fillMaxSize(),
          factory = { ctx -> FrameLayout(ctx) },
          update = { container ->
            val currentChild = if (container.childCount > 0) container.getChildAt(0) else null
            if (currentChild !== activeTab.webView) {
              (activeTab.webView.parent as? ViewGroup)?.removeView(activeTab.webView)
              container.removeAllViews()
              container.addView(
                activeTab.webView,
                FrameLayout.LayoutParams(
                  ViewGroup.LayoutParams.MATCH_PARENT,
                  ViewGroup.LayoutParams.MATCH_PARENT
                )
              )
            }
          }
        )
      }
    }
  }

  if (showTabsSheet) {
    ModalBottomSheet(
      onDismissRequest = { showTabsSheet = false },
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
      containerColor = Color(0xFF0F192B),
      contentColor = Color(0xFFEBF2FC)
    ) {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
      ) {
        Text("Otwarte karty (${tabs.size})", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)

        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          Button(
            onClick = {
              createTab(STARTUP_COMPANY_URL, incognito = false)
              showTabsSheet = false
            },
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3898FF))
          ) {
            Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Nowa karta")
          }

          OutlinedButton(
            onClick = {
              createTab("https://duckduckgo.com/", incognito = true)
              showTabsSheet = false
            },
            modifier = Modifier.weight(1f)
          ) {
            Icon(Icons.Rounded.VisibilityOff, contentDescription = null, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(6.dp))
            Text("Incognito")
          }
        }

        LazyColumn(
          modifier = Modifier
            .fillMaxWidth()
            .height(280.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          items(tabs, key = { it.id }) { tab ->
            val selected = tab.id == activeTabId
            Surface(
              color = if (selected) Color(0x283898FF) else Color(0xFF132036),
              shape = RoundedCornerShape(12.dp),
              modifier = Modifier
                .fillMaxWidth()
                .border(
                  1.dp,
                  when {
                    tab.isIncognito && selected -> Color(0xFF8B7BFF)
                    selected -> Color(0xFF3898FF)
                    else -> Color(0x1E94C3FF)
                  },
                  RoundedCornerShape(12.dp)
                )
                .clickable {
                  activeTabId = tab.id
                  showTabsSheet = false
                }
            ) {
              Row(
                modifier = Modifier
                  .fillMaxWidth()
                  .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                if (tab.isIncognito) {
                  Icon(
                    imageVector = Icons.Rounded.VisibilityOff,
                    contentDescription = null,
                    tint = Color(0xFFB7ACFF),
                    modifier = Modifier.size(18.dp)
                  )
                  Spacer(Modifier.width(10.dp))
                }
                Column(modifier = Modifier.weight(1f)) {
                  Text(
                    text = tab.title,
                    color = Color(0xFFEBF2FC),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                  )
                  Text(
                    text = extractHost(tab.url) ?: tab.url,
                    color = Color(0xFF879CB8),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                  )
                }
                IconButton(onClick = { closeTab(tab) }) {
                  Icon(Icons.Rounded.Close, contentDescription = "Zamknij", tint = Color(0xFF879CB8))
                }
              }
            }
          }
        }
        Spacer(Modifier.height(14.dp))
      }
    }
  }

  if (showMenuSheet) {
    val activeUrl = activeTab?.url ?: ""
    val isBookmarked = bookmarks.any { it.url == activeUrl }

    ModalBottomSheet(
      onDismissRequest = { showMenuSheet = false },
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
      containerColor = Color(0xFF0F192B),
      contentColor = Color(0xFFEBF2FC)
    ) {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
      ) {
        TabRow(
          selectedTabIndex = menuSheetTab,
          containerColor = Color.Transparent,
          contentColor = Color(0xFF3898FF)
        ) {
          Tab(selected = menuSheetTab == 0, onClick = { menuSheetTab = 0 }, text = { Text("Ochrona") })
          Tab(selected = menuSheetTab == 1, onClick = { menuSheetTab = 1 }, text = { Text("Zakładki") })
          Tab(selected = menuSheetTab == 2, onClick = { menuSheetTab = 2 }, text = { Text("Historia") })
        }

        when (menuSheetTab) {
          0 -> {
            if (activeUrl.startsWith("http", true) && !isIncognitoActive) {
              OutlinedButton(
                onClick = {
                  bookmarks = store.toggleBookmark(activeUrl, activeTab?.title ?: activeUrl)
                },
                modifier = Modifier.fillMaxWidth()
              ) {
                Icon(
                  if (isBookmarked) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                  contentDescription = null
                )
                Spacer(Modifier.width(8.dp))
                Text(if (isBookmarked) "Usuń z zakładek" else "Dodaj stronę do zakładek")
              }
            }

            Surface(
              color = Color(0xFF132036),
              shape = RoundedCornerShape(12.dp),
              modifier = Modifier.fillMaxWidth()
            ) {
              Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                  modifier = Modifier.fillMaxWidth(),
                  verticalAlignment = Alignment.CenterVertically,
                  horizontalArrangement = Arrangement.SpaceBetween
                ) {
                  Column(modifier = Modifier.weight(1f)) {
                    Text("Peak Shield (${shield.ruleCount} reguł)", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text(
                      "Zablokowano łącznie: ${settings.totalBlocked} żądań",
                      color = Color(0xFF879CB8),
                      fontSize = 12.sp
                    )
                  }
                  Switch(
                    checked = settings.shieldEnabled,
                    onCheckedChange = { enabled ->
                      val next = settings.copy(shieldEnabled = enabled)
                      settings = next
                      store.saveSettings(next)
                    }
                  )
                }

                HorizontalDivider(color = Color(0x1E94C3FF))

                Row(
                  modifier = Modifier.fillMaxWidth(),
                  verticalAlignment = Alignment.CenterVertically,
                  horizontalArrangement = Arrangement.SpaceBetween
                ) {
                  Column(modifier = Modifier.weight(1f)) {
                    Text("Wymuszanie HTTPS-First", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text("Automatycznie szyfruje połączenia HTTP", color = Color(0xFF879CB8), fontSize = 12.sp)
                  }
                  Switch(
                    checked = settings.httpsFirst,
                    onCheckedChange = { enabled ->
                      val next = settings.copy(httpsFirst = enabled)
                      settings = next
                      store.saveSettings(next)
                    }
                  )
                }
              }
            }

            Text("Wyszukiwarka", fontSize = 13.sp, color = Color(0xFF879CB8))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              listOf("google" to "Google", "duckduckgo" to "DDG", "brave" to "Brave", "bing" to "Bing").forEach { (id, label) ->
                FilterChip(
                  selected = settings.searchEngine == id,
                  onClick = {
                    val next = settings.copy(searchEngine = id)
                    settings = next
                    store.saveSettings(next)
                  },
                  label = { Text(label, fontSize = 12.sp) }
                )
              }
            }

            OutlinedButton(
              onClick = {
                history = store.clearHistory()
                CookieManager.getInstance().removeAllCookies(null)
                WebStorage.getInstance().deleteAllData()
                showMenuSheet = false
                scope.launch { snackbarHostState.showSnackbar("Wyczyszczono historię i pliki cookie.") }
              },
              modifier = Modifier.fillMaxWidth()
            ) {
              Icon(Icons.Rounded.DeleteOutline, contentDescription = null)
              Spacer(Modifier.width(8.dp))
              Text("Wyczyść historię i cookies")
            }
          }

          1 -> {
            OutlinedButton(
              onClick = { importHtmlLauncher.launch(arrayOf("text/html", "*/*")) },
              modifier = Modifier.fillMaxWidth()
            ) {
              Icon(Icons.Rounded.UploadFile, contentDescription = null)
              Spacer(Modifier.width(8.dp))
              Text("Importuj zakładki z pliku HTML")
            }

            LazyColumn(
              modifier = Modifier
                .fillMaxWidth()
                .height(260.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
              if (bookmarks.isEmpty()) {
                item {
                  Text(
                    "Brak zapisanych zakładek.",
                    color = Color(0xFF879CB8),
                    fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 16.dp)
                  )
                }
              } else {
                items(bookmarks, key = { it.url }) { bm ->
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .clip(RoundedCornerShape(10.dp))
                      .background(Color(0xFF132036))
                      .clickable {
                        activeTab?.webView?.loadUrl(prepareNavigationUrl(bm.url))
                        showMenuSheet = false
                      }
                      .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                  ) {
                    Column(modifier = Modifier.weight(1f)) {
                      Text(bm.title, color = Color(0xFFEBF2FC), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                      Text(extractHost(bm.url) ?: bm.url, color = Color(0xFF879CB8), fontSize = 12.sp, maxLines = 1)
                    }
                    IconButton(onClick = { bookmarks = store.removeBookmark(bm.url) }) {
                      Icon(Icons.Rounded.Close, contentDescription = "Usuń", tint = Color(0xFF879CB8))
                    }
                  }
                }
              }
            }
          }

          else -> {
            LazyColumn(
              modifier = Modifier
                .fillMaxWidth()
                .height(280.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
              if (history.isEmpty()) {
                item {
                  Text(
                    "Historia przeglądania jest pusta.",
                    color = Color(0xFF879CB8),
                    fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 16.dp)
                  )
                }
              } else {
                items(history, key = { "${it.url}-${it.visitedAt}" }) { item ->
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .clip(RoundedCornerShape(10.dp))
                      .background(Color(0xFF132036))
                      .clickable {
                        activeTab?.webView?.loadUrl(prepareNavigationUrl(item.url))
                        showMenuSheet = false
                      }
                      .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                  ) {
                    Icon(Icons.Rounded.History, contentDescription = null, tint = Color(0xFF7EA6D8), modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                      Text(item.title, color = Color(0xFFEBF2FC), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                      Text(extractHost(item.url) ?: item.url, color = Color(0xFF879CB8), fontSize = 12.sp, maxLines = 1)
                    }
                  }
                }
              }
            }
          }
        }
        Spacer(Modifier.height(16.dp))
      }
    }
  }
}
