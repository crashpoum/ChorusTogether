package together.chorus.app

import org.json.JSONArray
import org.json.JSONObject

/** In-memory room roster. One phone is the server, so nothing is written to disk. */
class Signaling {
    private class Peer(val room: String, val id: String, var name: String, var seen: Long)
    private class Signal(
        val id: Long,
        val room: String,
        val to: String,
        val from: String,
        val kind: String,
        val payload: String,
        val created: Long,
    )

    private val peers = mutableListOf<Peer>()
    private val signals = mutableListOf<Signal>()
    private var nextId = 1L
    private val idRe = Regex("^[a-zA-Z0-9_-]{1,64}$")

    fun poll(room: String, peer: String, name: String, since: Long): JSONObject? {
        if (!idRe.matches(room) || !idRe.matches(peer)) return null
        val now = System.currentTimeMillis()
        synchronized(this) {
            prune(now)
            val existing = peers.find { it.room == room && it.id == peer }
            if (existing == null) peers.add(Peer(room, peer, name.take(64), now))
            else {
                existing.seen = now
                existing.name = name.take(64)
            }
            val inbox = signals.filter { it.room == room && it.to == peer && it.id > since }.take(200)
            val roster = peers.filter { it.room == room && now - it.seen < PEER_TTL }
                .sortedBy { it.id }
                .take(32)
            val peerArr = JSONArray()
            for (row in roster) peerArr.put(JSONObject().put("id", row.id).put("name", row.name))
            val sigArr = JSONArray()
            for (row in inbox) {
                sigArr.put(
                    JSONObject()
                        .put("id", row.id)
                        .put("from", row.from)
                        .put("kind", row.kind)
                        .put("payload", parseJson(row.payload)),
                )
            }
            return JSONObject().put("peers", peerArr).put("signals", sigArr)
        }
    }

    fun post(raw: String): Boolean {
        val msg = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return false
        }
        synchronized(this) {
            when (msg.optString("op")) {
                "signal" -> {
                    val room = msg.optString("room")
                    val from = msg.optString("from")
                    val to = msg.optString("to")
                    val kind = msg.optString("kind")
                    if (!idRe.matches(room) || !idRe.matches(from) || !idRe.matches(to)) return false
                    if (kind != "offer" && kind != "answer" && kind != "ice") return false
                    if (!msg.has("payload")) return false
                    val payload = stringify(msg.get("payload"))
                    if (payload.length > 32_768) return false
                    signals.add(Signal(nextId++, room, to, from, kind, payload, System.currentTimeMillis()))
                    true
                }
                "leave" -> {
                    val room = msg.optString("room")
                    val peer = msg.optString("peer")
                    if (!idRe.matches(room) || !idRe.matches(peer)) return false
                    peers.removeAll { it.room == room && it.id == peer }
                    true
                }
                else -> false
            }
        }
    }

    private fun prune(now: Long) {
        peers.removeAll { now - it.seen >= PEER_TTL }
        signals.removeAll { now - it.created >= SIGNAL_TTL }
    }

    private fun stringify(value: Any): String {
        return when (value) {
            is JSONObject, is JSONArray -> value.toString()
            JSONObject.NULL -> "null"
            is String -> JSONObject.quote(value)
            else -> value.toString()
        }
    }

    private fun parseJson(text: String): Any {
        val trimmed = text.trim()
        return try {
            when {
                trimmed.startsWith("{") -> JSONObject(trimmed)
                trimmed.startsWith("[") -> JSONArray(trimmed)
                trimmed == "null" -> JSONObject.NULL
                trimmed == "true" -> true
                trimmed == "false" -> false
                trimmed.startsWith("\"") -> JSONObject("{\"v\":$trimmed}").get("v")
                trimmed.toLongOrNull() != null && !trimmed.contains('.') -> trimmed.toLong()
                trimmed.toDoubleOrNull() != null -> trimmed.toDouble()
                else -> trimmed
            }
        } catch (_: Exception) {
            text
        }
    }

    companion object {
        private const val PEER_TTL = 30_000L
        private const val SIGNAL_TTL = 60_000L
    }
}
