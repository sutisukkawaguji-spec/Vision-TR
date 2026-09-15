package th.visiontr.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class AuthSession(val accessToken: String, val email: String, val userId: String)

data class UserProfile(val userId: String, val teamId: String, val workGroupId: String?, val displayName: String)

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
                email = json.optJSONObject("user")?.optString("email").orEmpty().ifBlank { email.trim() },
                userId = json.optJSONObject("user")?.optString("id").orEmpty()
            )
        }
    }

    fun fetchProfile(accessToken: String): UserProfile {
        val userRequest = authenticatedRequest("${BuildConfig.SUPABASE_URL}/auth/v1/user", accessToken).build()
        val user = client.newCall(userRequest).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            JSONObject(payload)
        }
        val userId = user.getString("id")
        val profileRequest = authenticatedRequest("${BuildConfig.SUPABASE_URL}/rest/v1/profiles?select=team_id,active_work_group_id,display_name&id=eq.$userId", accessToken).build()
        client.newCall(profileRequest).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            val profile = JSONArray(payload).optJSONObject(0) ?: throw IllegalStateException("ไม่พบข้อมูลโปรไฟล์ผู้ใช้")
            val teamId = profile.getString("team_id")
            val workGroupId = profile.optString("active_work_group_id").ifBlank { null }
                ?: ensureDefaultWorkGroup(accessToken, userId, teamId)
            return UserProfile(userId, teamId, workGroupId, profile.optString("display_name"))
        }
    }

    private fun ensureDefaultWorkGroup(accessToken: String, userId: String, teamId: String): String {
        val existing = authenticatedRequest("${BuildConfig.SUPABASE_URL}/rest/v1/work_groups?select=id&team_id=eq.$teamId&is_active=eq.true&order=created_at.asc&limit=1", accessToken).get().build()
        client.newCall(existing).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            JSONArray(payload).optJSONObject(0)?.optString("id")?.takeIf { it.isNotBlank() }?.let { return it }
        }
        val body = JSONObject().put("team_id", teamId).put("name", "ทั่วไป").put("created_by", userId).put("is_active", true).toString().toRequestBody(jsonMediaType)
        val create = authenticatedRequest("${BuildConfig.SUPABASE_URL}/rest/v1/work_groups?on_conflict=team_id,name", accessToken)
            .header("Prefer", "resolution=merge-duplicates,return=representation")
            .post(body)
            .build()
        client.newCall(create).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            return JSONArray(payload).optJSONObject(0)?.optString("id")?.takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("ไม่สามารถสร้างกลุ่มงานเริ่มต้นได้")
        }
    }

    fun saveRecord(accessToken: String, profile: UserProfile, plot: Plot, status: String, note: String) {
        val groupId = profile.workGroupId ?: throw IllegalStateException("ยังไม่ได้กำหนดกลุ่มงานสำหรับบันทึกข้อมูล")
        val payload = JSONObject()
            .put("team_id", profile.teamId)
            .put("base_plot_id", plot.id)
            .put("work_group_id", groupId)
            .put("status", status)
            .put("note", note.trim())
            .put("images", JSONArray())
            .put("record_properties", JSONObject().put("name", plot.displayName))
            .put("recorded_by", profile.userId)
            .put("recorded_at", if (status == "done") java.time.Instant.now().toString() else JSONObject.NULL)
            .put("updated_at", java.time.Instant.now().toString())
            .toString()
            .toRequestBody(jsonMediaType)
        val request = authenticatedRequest("${BuildConfig.SUPABASE_URL}/rest/v1/plot_records?on_conflict=base_plot_id,work_group_id", accessToken)
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .post(payload)
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(body, response.code))
        }
    }

    fun fetchPlots(accessToken: String): List<Plot> {
        val request = authenticatedRequest("${BuildConfig.SUPABASE_URL}/rest/v1/base_plots?select=id,display_name,lat,lng&order=display_name.asc&limit=200", accessToken)
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IllegalStateException(readError(payload, response.code))
            return parsePlots(JSONArray(payload))
        }
    }

    private fun authenticatedRequest(url: String, accessToken: String): Request.Builder = Request.Builder()
        .url(url)
        .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
        .header("Authorization", "Bearer $accessToken")

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
