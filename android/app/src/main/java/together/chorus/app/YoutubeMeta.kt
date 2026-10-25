package together.chorus.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object YoutubeMeta {
    private val videoId = Regex("^[\\w-]{11}$")
    private val listId = Regex("^[\\w-]{12,90}$")
    private const val KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
    private const val MAX_ITEMS = 200

    fun lookup(query: Map<String, String>): Pair<Int, String> {
        val list = query["list"].orEmpty()
        if (list.isNotEmpty()) {
            if (!listId.matches(list)) return 400 to """{"error":"bad playlist"}"""
            return try {
                val playlist = collect(list)
                if (playlist.second.length() == 0) 404 to """{"error":"not found"}"""
                else 200 to JSONObject().put("title", playlist.first).put("items", playlist.second).toString()
            } catch (_: Exception) {
                502 to """{"error":"lookup failed"}"""
            }
        }
        val id = query["v"].orEmpty()
        if (!videoId.matches(id)) return 400 to """{"error":"bad id"}"""
        return try {
            val conn = URL(
                "https://www.youtube.com/oembed?url=" +
                    java.net.URLEncoder.encode("https://www.youtube.com/watch?v=$id", "UTF-8") +
                    "&format=json",
            ).openConnection() as HttpURLConnection
            conn.setRequestProperty("accept", "application/json")
            conn.connectTimeout = 12_000
            conn.readTimeout = 12_000
            val code = conn.responseCode
            if (code !in 200..299) return 404 to """{"error":"not found"}"""
            val data = JSONObject(conn.inputStream.bufferedReader().readText())
            200 to JSONObject()
                .put("title", data.optString("title", "YouTube"))
                .put("author", data.optString("author_name", ""))
                .put("thumb", "https://i.ytimg.com/vi/$id/hqdefault.jpg")
                .toString()
        } catch (_: Exception) {
            502 to """{"error":"lookup failed"}"""
        }
    }

    private fun collect(list: String): Pair<String, JSONArray> {
        val items = JSONArray()
        val seen = HashSet<String>()
        var title = "Playlist"
        var token: String? = null
        var first = true
        for (page in 0 until 4) {
            if (items.length() >= MAX_ITEMS) break
            val data = if (first) browse(JSONObject().put("browseId", if (list.startsWith("VL")) list else "VL$list"))
            else browse(JSONObject().put("continuation", token))
            first = false
            val meta = findRecord(data, "playlistMetadataRenderer")
            val foundTitle = meta?.optString("title").orEmpty()
            if (foundTitle.isNotEmpty()) title = foundTitle
            for (item in lockups(data)) {
                if (seen.contains(item.first) || items.length() >= MAX_ITEMS) continue
                seen.add(item.first)
                items.put(JSONObject().put("id", item.first).put("title", item.second).put("author", item.third))
            }
            token = continuation(data)
            if (token.isNullOrEmpty()) break
        }
        return title to items
    }

    private fun browse(extra: JSONObject): Any {
        val body = JSONObject()
        body.put(
            "context",
            JSONObject().put(
                "client",
                JSONObject()
                    .put("clientName", "WEB")
                    .put("clientVersion", "2.20260101.00.00")
                    .put("hl", "en")
                    .put("gl", "US"),
            ),
        )
        for (key in extra.keys()) body.put(key, extra.get(key))
        val conn = URL("https://www.youtube.com/youtubei/v1/browse?key=$KEY").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json")
        conn.setRequestProperty("user-agent", "Mozilla/5.0")
        conn.connectTimeout = 12_000
        conn.readTimeout = 12_000
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        if (conn.responseCode !in 200..299) throw IllegalStateException("browse failed")
        val text = conn.inputStream.bufferedReader().readText()
        val trimmed = text.trim()
        return if (trimmed.startsWith("[")) JSONArray(trimmed) else JSONObject(trimmed)
    }

    private fun lockups(node: Any?): List<Triple<String, String, String>> {
        val out = mutableListOf<Triple<String, String, String>>()
        walk(node) { record ->
            val vm = record.optJSONObject("lockupViewModel") ?: return@walk
            val id = vm.optString("contentId")
            if (!videoId.matches(id)) return@walk
            val metadata = vm.optJSONObject("metadata")?.optJSONObject("lockupMetadataViewModel")
            val title = metadata?.optJSONObject("title")?.optString("content").orEmpty().ifEmpty { "YouTube" }
            val author = firstAuthor(metadata)
            out.add(Triple(id, title, author))
        }
        return out
    }

    private fun continuation(node: Any?): String? {
        var token: String? = null
        walk(node) { record ->
            val cmd = record.optJSONObject("continuationCommand") ?: return@walk
            val next = cmd.optString("token")
            if (next.length > (token?.length ?: 0)) token = next
        }
        return token
    }

    private fun firstAuthor(metadata: JSONObject?): String {
        if (metadata == null) return ""
        val texts = mutableListOf<String>()
        walk(metadata.opt("metadata")) { record ->
            val content = record.optString("content")
            if (content.isNotEmpty()) texts.add(content)
        }
        return texts.firstOrNull { !Regex("views|ago|watching", RegexOption.IGNORE_CASE).containsMatchIn(it) }.orEmpty()
    }

    private fun findRecord(node: Any?, key: String): JSONObject? {
        var found: JSONObject? = null
        walk(node) { record ->
            if (found == null) found = record.optJSONObject(key)
        }
        return found
    }

    private fun walk(node: Any?, visit: (JSONObject) -> Unit) {
        when (node) {
            is JSONObject -> {
                visit(node)
                val keys = node.keys()
                while (keys.hasNext()) {
                    val value = node.opt(keys.next())
                    if (value is JSONObject || value is JSONArray) walk(value, visit)
                }
            }
            is JSONArray -> {
                for (i in 0 until node.length()) {
                    val value = node.opt(i)
                    if (value is JSONObject || value is JSONArray) walk(value, visit)
                }
            }
        }
    }
}
