package th.visiontr.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val repository = SupabaseRepository()
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var session: SharedPreferences
    private var allPlots: List<Plot> = emptyList()
    private var visiblePlots: List<Plot> = emptyList()
    private var list: ListView? = null
    private var resultSummary: TextView? = null
    private var locationHint: TextView? = null
    private var searchField: EditText? = null
    private var dataModeButton: TextView? = null
    private var placeModeButton: TextView? = null
    private var isPlaceMode = false
    private var mapView: MapView? = null
    private var map: MapLibreMap? = null

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) updateLocation() else locationHint?.text = "เปิดสิทธิ์ตำแหน่งเพื่อให้ติดตามคุณได้"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(applicationContext)
        session = getSharedPreferences("vision_tr_session", MODE_PRIVATE)
        showLogin()
        session.getString("access_token", null)?.let { showDashboard(session.getString("email", "").orEmpty(), it) }
    }
    override fun onStart() { super.onStart(); mapView?.onStart() }
    override fun onResume() { super.onResume(); mapView?.onResume() }
    override fun onPause() { mapView?.onPause(); super.onPause() }
    override fun onStop() { mapView?.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView?.onLowMemory() }
    override fun onDestroy() { mapView?.onDestroy(); executor.shutdown(); super.onDestroy() }

    private fun showLogin() {
        mapView = null
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(24), dp(44), dp(24), dp(24)); background = bg("#F3F7F2", 0) }
        setContentView(ScrollView(this).apply { addView(content) })
        content.addView(label("VISION TR", "#164B36", 34, true))
        content.addView(label("ระบบจัดการแปลงและนำทางภาคสนาม", "#547064", 16))
        content.addView(space(42))
        val card = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(22), dp(20), dp(18)); background = bg("#FFFFFF", 24, "#DDE7DE"); elevation = dp(4).toFloat() }
        val email = input("อีเมล", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = input("รหัสผ่าน", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val state = label("", "#B42318", 14); val submit = primary("เข้าสู่ระบบ")
        card.addView(label("เข้าสู่ระบบ", "#183C2D", 22, true)); card.addView(label("ใช้บัญชีเดียวกับ Vision TR บนเว็บ", "#66756D", 14)); card.addView(space(12)); card.addView(email); card.addView(password); card.addView(submit); card.addView(state)
        content.addView(card, width())
        submit.setOnClickListener {
            val enteredEmail = email.text.toString().trim(); val enteredPassword = password.text.toString()
            if (enteredEmail.isBlank() || enteredPassword.isBlank()) { state.text = "กรอกอีเมลและรหัสผ่านก่อน"; return@setOnClickListener }
            submit.isEnabled = false; submit.text = "กำลังเข้าสู่ระบบ…"; state.text = ""
            executor.execute { try { val auth = repository.signIn(enteredEmail, enteredPassword); session.edit().putString("access_token", auth.accessToken).putString("email", auth.email).apply(); runOnUiThread { showDashboard(auth.email, auth.accessToken) } } catch (e: Exception) { runOnUiThread { submit.isEnabled = true; submit.text = "เข้าสู่ระบบ"; state.text = e.message ?: "เข้าสู่ระบบไม่สำเร็จ" } } }
        }
    }

    private fun showDashboard(email: String, token: String) {
        val frame = FrameLayout(this).apply { background = bg("#DDE8D9", 0) }; setContentView(frame)
        mapView = MapView(this).also { view -> frame.addView(view, FrameLayout.LayoutParams(-1, -1)); view.getMapAsync { ready -> map = ready; ready.setStyle(Style.Builder().fromUri("https://demotiles.maplibre.org/style.json")) } }
        val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(10)); background = bg("#F8FCF7", 0); elevation = dp(8).toFloat() }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(label("VISION TR", "#164B36", 20, true), LinearLayout.LayoutParams(0, -2, 1f)); header.addView(label("ออนไลน์", "#237A57", 12, true).apply { background = bg("#E1F3E8", 18); setPadding(dp(10), dp(6), dp(10), dp(6)) }); top.addView(header); top.addView(label(email, "#607167", 12)); top.addView(space(10))
        val searchCard = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(6), dp(6), dp(6), dp(8)); background = bg("#FFFFFF", 18, "#D7E2D7") }
        val modes = LinearLayout(this)
        dataModeButton = mode("ข้อมูลแปลง", true).also { modes.addView(it, LinearLayout.LayoutParams(0, dp(36), 1f)) }; placeModeButton = mode("สถานที่", false).also { modes.addView(it, LinearLayout.LayoutParams(0, dp(36), 1f)) }
        searchCard.addView(modes)
        searchField = input("ค้นหาข้อมูลแปลง…", InputType.TYPE_CLASS_TEXT).apply { setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0); compoundDrawablePadding = dp(10); imeOptions = EditorInfo.IME_ACTION_SEARCH; background = bg("#F1F6F1", 14); setPadding(dp(14), 0, dp(14), 0) }
        searchCard.addView(searchField, width().apply { topMargin = dp(7) }); top.addView(searchCard); frame.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        val tools = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
        tools.addView(fab("◎", "ติดตามตำแหน่ง").apply { setOnClickListener { updateLocation() } }); tools.addView(fab("⌕", "ดูแปลงทั้งหมด").apply { setOnClickListener { focusAllPlots() } }); tools.addView(fab("◉", "สั่งงานด้วยเสียง").apply { setOnClickListener { voiceGuide() } })
        frame.addView(tools, FrameLayout.LayoutParams(dp(58), -2, Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = dp(16) })
        val sheet = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(10), dp(18), dp(14)); background = bg("#FFFFFF", 26); elevation = dp(14).toFloat() }
        sheet.addView(View(this).apply { background = bg("#B8C7BD", 8); layoutParams = LinearLayout.LayoutParams(dp(44), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) } })
        val sheetHeader = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }; resultSummary = label("กำลังโหลดข้อมูลแปลง…", "#183C2D", 17, true); sheetHeader.addView(resultSummary, LinearLayout.LayoutParams(0, -2, 1f)); sheetHeader.addView(label("แตะเพื่อดูและนำทาง", "#688075", 12)); sheet.addView(sheetHeader)
        locationHint = label("กดปุ่ม ◎ เพื่อแสดงตำแหน่งของคุณ", "#68766E", 12).apply { setPadding(0, dp(3), 0, dp(5)) }; sheet.addView(locationHint)
        list = ListView(this).apply { dividerHeight = dp(1) }; sheet.addView(list, LinearLayout.LayoutParams(-1, 0, 1f)); frame.addView(sheet, FrameLayout.LayoutParams(-1, dp(270), Gravity.BOTTOM))
        dataModeButton?.setOnClickListener { setSearchMode(false) }; placeModeButton?.setOnClickListener { setSearchMode(true) }
        searchField?.addTextChangedListener(object : TextWatcher { override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit; override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) { if (!isPlaceMode) filterPlots(s?.toString().orEmpty()) }; override fun afterTextChanged(s: Editable?) = Unit })
        searchField?.setOnEditorActionListener { _, _, _ -> if (isPlaceMode) { placeNotice(); true } else false }; loadPlots(token)
    }

    private fun loadPlots(token: String) = executor.execute { try { val plots = repository.fetchPlots(token); runOnUiThread { allPlots = plots; filterPlots(searchField?.text?.toString().orEmpty()); focusAllPlots() } } catch (e: Exception) { runOnUiThread { resultSummary?.text = e.message ?: "โหลดข้อมูลแปลงไม่สำเร็จ" } } }
    private fun setSearchMode(place: Boolean) { isPlaceMode = place; dataModeButton?.select(!place); placeModeButton?.select(place); searchField?.apply { setText(""); hint = if (place) "ค้นหาสถานที่ ร้านค้า หรือที่อยู่…" else "ค้นหาข้อมูลแปลง…" }; if (place) { resultSummary?.text = "ค้นหาสถานที่"; list?.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf("พิมพ์ชื่อสถานที่ แล้วกดค้นหา")) } else filterPlots("") }
    private fun filterPlots(query: String) { val term = query.trim(); visiblePlots = allPlots.filter { term.isBlank() || it.displayName.contains(term, true) || it.id.contains(term, true) }; resultSummary?.text = if (term.isBlank()) "แปลงของฉัน ${visiblePlots.size} รายการ" else "ผลการค้นหา ${visiblePlots.size} รายการ"; list?.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, visiblePlots.map { "${it.displayName}\n${it.id}" }); list?.setOnItemClickListener { _, _, p, _ -> showPlot(visiblePlots[p]) } }
    private fun showPlot(plot: Plot) { plot.latitude?.let { lat -> plot.longitude?.let { lng -> map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), 16.5)) } }; val point = if (plot.latitude != null && plot.longitude != null) "${plot.latitude}, ${plot.longitude}" else "ไม่มีพิกัด"; AlertDialog.Builder(this).setTitle(plot.displayName).setMessage("รหัสแปลง: ${plot.id}\nพิกัด: $point").setNegativeButton("ปิด", null).setPositiveButton("นำทาง") { _, _ -> navigate(plot) }.show() }
    private fun navigate(plot: Plot) { val lat = plot.latitude; val lng = plot.longitude; if (lat == null || lng == null) { AlertDialog.Builder(this).setMessage("แปลงนี้ยังไม่มีพิกัดสำหรับนำทาง").setPositiveButton("ตกลง", null).show(); return }; startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(plot.displayName)})"))) }
    private fun updateLocation() { if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION); return }; val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager; val loc = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstNotNullOfOrNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }; if (loc == null) { locationHint?.text = "กำลังรอตำแหน่งจาก GPS…"; return }; locationHint?.text = "ตำแหน่งของคุณ: %.5f, %.5f".format(loc.latitude, loc.longitude); map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(loc.latitude, loc.longitude), 16.0)) }
    private fun focusAllPlots() { val first = allPlots.firstOrNull { it.latitude != null && it.longitude != null } ?: return; map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(first.latitude!!, first.longitude!!), 12.0)) }
    private fun placeNotice() = AlertDialog.Builder(this).setTitle("ค้นหาสถานที่").setMessage("หน้าตาและโหมดค้นหาสถานที่พร้อมแล้ว ส่วนผู้ให้บริการค้นหาสถานที่ Native จะเชื่อมต่อในรอบถัดไปเพื่อไม่ใช้ Google Maps JavaScript ของเว็บ").setPositiveButton("เข้าใจแล้ว", null).show()
    private fun voiceGuide() = AlertDialog.Builder(this).setTitle("สั่งงานด้วยเสียง").setMessage("กำลังเตรียมคำสั่งสำหรับขณะขับขี่ เช่น ค้นหาข้อมูลแปลง, อ่าน 3 รายการ, เลือกรายการที่ 1, นำทางล่าสุด และติดตามตำแหน่ง").setPositiveButton("เข้าใจแล้ว", null).show()
    private fun label(text: String, color: String, size: Int, bold: Boolean = false) = TextView(this).apply { this.text = text; textSize = size.toFloat(); setTextColor(Color.parseColor(color)); if (bold) typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private fun input(hint: String, type: Int) = EditText(this).apply { this.hint = hint; inputType = type; setSingleLine(true); textSize = 16f; layoutParams = width().apply { bottomMargin = dp(10) }; background = bg("#F4F7F4", 14); setPadding(dp(14), 0, dp(14), 0) }
    private fun primary(text: String) = Button(this).apply { this.text = text; textSize = 16f; setTextColor(Color.WHITE); background = bg("#1E6B4C", 14); layoutParams = width().apply { height = dp(52); bottomMargin = dp(8) } }
    private fun mode(text: String, selected: Boolean) = TextView(this).apply { this.text = text; gravity = Gravity.CENTER; textSize = 14f; select(selected) }
    private fun TextView.select(selected: Boolean) { setTextColor(Color.parseColor(if (selected) "#FFFFFF" else "#557064")); background = bg(if (selected) "#1E6B4C" else "#EAF1EA", 12); typeface = if (selected) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT }
    private fun fab(icon: String, description: String) = TextView(this).apply { text = icon; contentDescription = description; gravity = Gravity.CENTER; textSize = 27f; setTextColor(Color.parseColor("#1C5C41")); background = bg("#FFFFFF", 28, "#D6E4D7"); elevation = dp(6).toFloat(); layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply { bottomMargin = dp(12) } }
    private fun space(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun width() = LinearLayout.LayoutParams(-1, -2)
    private fun bg(color: String, radius: Int, stroke: String? = null) = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(radius).toFloat(); stroke?.let { setStroke(dp(1), Color.parseColor(it)) } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
