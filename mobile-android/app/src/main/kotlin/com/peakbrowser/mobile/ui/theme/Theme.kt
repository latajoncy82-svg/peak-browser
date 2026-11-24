package com.peakbrowser.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PeakDarkColorScheme = darkColorScheme(
  primary = Color(0xFF3898FF),
  onPrimary = Color(0xFFFFFFFF),
  primaryContainer = Color(0xFF132642),
  onPrimaryContainer = Color(0xFFD6E9FF),
  secondary = Color(0xFF8B7BFF),
  background = Color(0xFF08101C),
  onBackground = Color(0xFFEBF2FC),
  surface = Color(0xFF101B2E),
  onSurface = Color(0xFFEBF2FC),
  surfaceVariant = Color(0xFF0C1524),
  onSurfaceVariant = Color(0xFF879CB8),
  outline = Color(0x2294C3FF)
)

@Composable
fun PeakBrowserTheme(
  content: @Composable () -> Unit
) {
  MaterialTheme(
    colorScheme = PeakDarkColorScheme,
    typography = Typography,
    content = content
  )
}
