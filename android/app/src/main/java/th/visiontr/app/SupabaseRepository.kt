package th.visiontr.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class AuthSession(val accessToken: String, val email: String)

data class Plot(
    val id: String,
    val displayName: String,
    val latitude: Double?,
    val longitude: Double?
)

class SupabaseRepository {
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun signIn(email: String, password: String): AuthSession {
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .toString()
            .toRequestBody(jsonMediaType)
        val request = Request.Builder()
            .url("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password")
            .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            val json = JSONObject(payload)
            return AuthSession(
                accessToken = json.getString("access_token"),
                email = json.optJSONObject("user")?.optString("email").orEmpty().ifBlank { email.trim() }
            )
        }
    }

    fun fetchPlots(accessToken: String): List<Plot> {
        val request = Request.Builder()
            .url("${BuildConfig.SUPABASE_URL}/rest/v1/base_plots?select=id,display_name,lat,lng&order=display_name.asc&limit=200")
            .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            return parsePlots(JSONArray(payload))
        }
    }

    private fun parsePlots(rows: JSONArray): List<Plot> = buildList {
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            add(
                Plot(
                    id = row.optString("id"),
                    displayName = row.optString("display_name").ifBlank { "แปลงที่ไม่มีชื่อ" },
                    latitude = row.optDoubleOrNull("lat"),
                    longitude = row.optDoubleOrNull("lng")
                )
            )
        }
    }

    private fun JSONObject.optDoubleOrNull(name: String): Double? = when (val value = opt(name)) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }

    private fun readError(payload: String, status: Int): String = try {
        val json = JSONObject(payload)
        json.optString("error_description")
            .ifBlank { json.optString("message") }
            .ifBlank { "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ (HTTP $status)" }
    } catch (_: Exception) {
        "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ (HTTP $status)"
    }
}
