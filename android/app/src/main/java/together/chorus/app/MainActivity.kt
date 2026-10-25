package together.chorus.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import android.widget.Button
import android.widget.TextView
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        HostService.ensure(this)
        startForegroundService(Intent(this, HostService::class.java))
        val web = findViewById<WebView>(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        if (HostService.server != null) web.loadUrl("http://127.0.0.1:${HostService.PORT}/")
        findViewById<Button>(R.id.share).setOnClickListener {
            val url = guestUrl()
            startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "Join my ChorusTogether room: $url")
                    },
                    "Share",
                ),
            )
        }
        findViewById<Button>(R.id.refresh).setOnClickListener { showUrl() }
        showUrl()
    }

    override fun onResume() {
        super.onResume()
        showUrl()
    }

    private fun showUrl() {
        val failed = HostService.error
        findViewById<TextView>(R.id.url).text = if (HostService.server == null && failed != null) {
            "Could not start: $failed"
        } else {
            guestUrl()
        }
    }

    private fun guestUrl(): String {
        val address = hotspotAddress() ?: "192.168.43.1"
        return "http://$address:${HostService.PORT}"
    }

    private fun hotspotAddress(): String? {
        val found = mutableListOf<Pair<String, String>>()
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
        for (nif in interfaces) {
            if (!nif.isUp || nif.isLoopback) continue
            for (addr in nif.inetAddresses) {
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    val host = addr.hostAddress ?: continue
                    found.add(nif.name to host)
                }
            }
        }
        val preferred = found.firstOrNull { (name, ip) ->
            name.contains("ap") || name.contains("wlan1") || name.contains("swlan") || ip.endsWith(".1")
        }
        return preferred?.second ?: found.firstOrNull()?.second
    }
}
