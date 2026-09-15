package th.visiontr.app

import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Stable bridge reserved for the on-device speech engine.  The web UI remains
 * untouched; the APK can replace only the speech input layer with Whisper.
 */
class AndroidVisionBridge(
    private val activity: MainActivity,
    private val webView: WebView
) {
    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun requestDevicePermissions() {
        activity.runOnUiThread { activity.recreate() }
    }

    fun deliverTranscript(transcript: String) {
        val quoted = org.json.JSONObject.quote(transcript)
        webView.post { webView.evaluateJavascript("window.handleVoiceCommand && window.handleVoiceCommand($quoted);", null) }
    }
}
