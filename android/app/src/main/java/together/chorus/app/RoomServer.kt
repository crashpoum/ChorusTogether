package together.chorus.app

import android.content.res.AssetManager
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

class RoomServer(private val assets: AssetManager, private val port: Int) {
    private val signaling = Signaling()
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var socket: ServerSocket? = null

    fun start() {
        val server = ServerSocket(port, 50)
        socket = server
        Thread {
            while (!server.isClosed) {
                val client = try {
                    server.accept()
                } catch (_: Exception) {
                    break
                }
                pool.execute { handle(client) }
            }
        }.start()
    }

    fun stop() {
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        pool.shutdownNow()
    }

    private fun handle(client: Socket) {
        client.soTimeout = 12_000
        try {
            val input = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
            val request = input.readLine() ?: return
            val parts = request.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val target = parts[1]
            val headers = HashMap<String, String>()
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                val cut = line.indexOf(':')
                if (cut > 0) headers[line.substring(0, cut).lowercase()] = line.substring(cut + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val body = if (length > 0 && length < 1_000_000) {
                val buf = CharArray(length)
                var read = 0
                while (read < length) {
                    val n = input.read(buf, read, length - read)
                    if (n < 0) break
                    read += n
                }
                String(buf, 0, read)
            } else ""
            val path = target.substringBefore('?')
            val query = parseQuery(target.substringAfter('?', ""))
            val (status, bytes, type) = when {
                method == "GET" && path == "/api/rtc" -> signalingResponse(
                    signaling.poll(
                        query["room"].orEmpty(),
                        query["peer"].orEmpty(),
                        query["name"].orEmpty(),
                        query["since"]?.toLongOrNull() ?: 0L,
                    ),
                )
                method == "POST" && path == "/api/rtc" -> {
                    if (signaling.post(body)) text(200, """{"ok":true}""") else text(400, """{"error":"invalid request"}""")
                }
                method == "GET" && path == "/api/youtube-meta" -> {
                    val (code, json) = YoutubeMeta.lookup(query)
                    text(code, json)
                }
                method == "GET" -> file(if (path == "/") "/index.html" else path)
                else -> text(405, """{"error":"method not allowed"}""")
            }
            val out = BufferedOutputStream(client.getOutputStream())
            val head = "HTTP/1.1 $status ${reason(status)}\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            out.write(head.toByteArray())
            out.write(bytes)
            out.flush()
        } catch (_: Exception) {
        } finally {
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun signalingResponse(body: org.json.JSONObject?): Triple<Int, ByteArray, String> {
        if (body == null) return text(400, """{"error":"invalid query"}""")
        return text(200, body.toString())
    }

    private fun file(path: String): Triple<Int, ByteArray, String> {
        val clean = path.substringBefore('?')
        if (clean.contains("..")) return text(400, """{"error":"bad path"}""")
        val name = "www$clean"
        return try {
            val bytes = assets.open(name).use { it.readBytes() }
            Triple(200, bytes, mime(clean))
        } catch (_: Exception) {
            if (!clean.contains('.')) file("/index.html") else text(404, """{"error":"not found"}""")
        }
    }

    private fun text(status: Int, json: String) = Triple(status, json.toByteArray(), "application/json; charset=utf-8")

    private fun parseQuery(raw: String): Map<String, String> {
        if (raw.isEmpty()) return emptyMap()
        val out = HashMap<String, String>()
        for (pair in raw.split('&')) {
            val cut = pair.indexOf('=')
            val key = URLDecoder.decode(if (cut >= 0) pair.substring(0, cut) else pair, "UTF-8")
            val value = URLDecoder.decode(if (cut >= 0) pair.substring(cut + 1) else "", "UTF-8")
            out[key] = value
        }
        return out
    }

    private fun mime(path: String): String = when {
        path.endsWith(".html") -> "text/html; charset=utf-8"
        path.endsWith(".js") -> "text/javascript; charset=utf-8"
        path.endsWith(".css") -> "text/css; charset=utf-8"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".webmanifest") -> "application/manifest+json"
        path.endsWith(".json") -> "application/json"
        else -> "application/octet-stream"
    }

    private fun reason(status: Int) = when (status) {
        200 -> "OK"
        400 -> "Bad Request"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        502 -> "Bad Gateway"
        else -> "Error"
    }
}
