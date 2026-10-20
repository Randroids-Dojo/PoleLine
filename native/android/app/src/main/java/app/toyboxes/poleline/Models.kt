package app.toyboxes.poleline

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class V(val x: Double, val y: Double)
fun JSONArray.points(): List<V> = (0 until length()).map { val p = getJSONArray(it); V(p.getDouble(0), p.getDouble(1)) }
fun List<V>.flat(): DoubleArray = flatMap { listOf(it.x, it.y) }.toDoubleArray()
fun lapTime(ms: Int): String = String.format(Locale.US, "%d:%02d.%03d", ms / 60000, ms / 1000 % 60, ms % 1000)
data class Track(val index: Int, val id: String, val name: String, val character: String, val region: String,
    val width: Double, val length: Double, val temperature: Int, val air: Int, val night: Boolean,
    val points: List<V>, val gold: Int, val silver: Int, val bronze: Int) {
    companion object {
        fun parse(j: JSONObject) = Track(j.getInt("index"),j.getString("id"),j.getString("name"),j.getString("character"),j.getString("region"),
            j.getDouble("width"),j.getDouble("length"),j.getInt("temperature"),j.getInt("air"),j.getBoolean("night"),j.getJSONArray("points").points(),j.getInt("gold"),j.getInt("silver"),j.getInt("bronze"))
    }
    fun medal(ms: Int) = when { ms <= gold -> "Gold"; ms <= silver -> "Silver"; ms <= bronze -> "Bronze"; else -> "Lap complete" }
}
class Lap(val json: JSONObject) {
    val points = json.getJSONArray("points").points()
    val timeMs = json.getInt("timeMs")
    val times = json.getJSONArray("time")
    val speed = json.getJSONArray("speed")
    val battery = json.getJSONArray("battery")
    val temperature = json.getJSONArray("temperature")
    fun sample(seconds: Double): Pair<V, Int> {
        var lo = 0; var hi = points.lastIndex
        while (lo < hi) { val mid = (lo + hi + 1) / 2; if (times.getDouble(mid) <= seconds) lo = mid else hi = mid - 1 }
        val next = (lo + 1) % points.size
        val f = ((seconds - times.getDouble(lo)) / (times.getDouble(lo + 1) - times.getDouble(lo))).coerceIn(0.0,1.0)
        return V(points[lo].x + (points[next].x - points[lo].x) * f, points[lo].y + (points[next].y - points[lo].y) * f) to lo
    }
}
class Records(context: Context) {
    private val preferences = context.getSharedPreferences("poleline-native-v1", Context.MODE_PRIVATE)
    fun best(id: String): JSONObject? = try { preferences.getString("best:$id",null)?.let { JSONObject(it) }?.takeIf { it.optInt("version") == 1 } } catch (_: Exception) { null }
    fun save(id: String, lap: Lap, line: List<V>): Boolean {
        if ((best(id)?.optInt("timeMs") ?: Int.MAX_VALUE) <= lap.timeMs) return false
        val record = JSONObject().put("version",1).put("timeMs",lap.timeMs).put("tyre",lap.json.getInt("tyre")).put("line",JSONArray(line.map { listOf(it.x,it.y) })).put("sectors",lap.json.getJSONArray("sectors"))
        return preferences.edit().putString("best:$id",record.toString()).commit()
    }
    var team: Int
        get() = preferences.getInt("team",0).coerceIn(0,5)
        set(value) { preferences.edit().putInt("team",value).apply() }
    var sound: Boolean
        get() = preferences.getBoolean("sound",true)
        set(value) { preferences.edit().putBoolean("sound",value).apply() }
    var last: Int
        get() = preferences.getInt("last",0).coerceIn(0,24)
        set(value) { preferences.edit().putInt("last",value).apply() }
    fun tyre(id: String) = preferences.getInt("tyre:$id",0).coerceIn(0,2)
    fun setTyre(id: String,value: Int) { preferences.edit().putInt("tyre:$id",value).apply() }
    fun clear() { preferences.edit().clear().commit() }
}
