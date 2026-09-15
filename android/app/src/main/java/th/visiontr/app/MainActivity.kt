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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
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
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import java.util.concurrent.Executors
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private val repository = SupabaseRepository()
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var session: SharedPreferences
    private var allPlots: List<Plot> = emptyList()
    private var visiblePlots: List<Plot> = emptyList()
    private var list: ListView? = null
    private var resultsSheet: LinearLayout? = null
    private var resultSummary: TextView? = null
    private var locationHint: TextView? = null
    private var searchField: EditText? = null
    private var dataModeButton: TextView? = null
    private var placeModeButton: TextView? = null
    private var isPlaceMode = false
    private var mapView: MapView? = null
    private var map: MapLibreMap? = null
    private var activeToken: String? = null
    private var activeProfile: UserProfile? = null
    private var selectedPlot: Plot? = null
    private var lastNavigationPlot: Plot? = null
    private var openRecordAfterNavigation = false
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) updateLocation() else locationHint?.text = "เปิดสิทธิ์ตำแหน่งเพื่อให้ติดตามคุณได้"
    }
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) beginVoiceListening() else toast("เปิดสิทธิ์ไมโครโฟนเพื่อสั่งงานด้วยเสียง")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(applicationContext)
        textToSpeech = TextToSpeech(this) { status -> if (status == TextToSpeech.SUCCESS) textToSpeech?.language = Locale("th", "TH") }
        session = getSharedPreferences("vision_tr_session", MODE_PRIVATE)
        showLogin()
        session.getString("access_token", null)?.let { showDashboard(session.getString("email", "").orEmpty(), it) }
    }
    override fun onStart() { super.onStart(); mapView?.onStart() }
    override fun onResume() { super.onResume(); mapView?.onResume(); if (openRecordAfterNavigation && selectedPlot != null) { openRecordAfterNavigation = false; window.decorView.post { openRecordDialog(selectedPlot) } } }
    override fun onPause() { mapView?.onPause(); super.onPause() }
    override fun onStop() { mapView?.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView?.onLowMemory() }
    override fun onDestroy() { mapView?.onDestroy(); speechRecognizer?.destroy(); textToSpeech?.shutdown(); executor.shutdown(); super.onDestroy() }

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
            executor.execute { try { val auth = repository.signIn(enteredEmail, enteredPassword); session.edit().putString("access_token", auth.accessToken).putString("email", auth.email).putString("user_id", auth.userId).apply(); runOnUiThread { showDashboard(auth.email, auth.accessToken) } } catch (e: Exception) { runOnUiThread { submit.isEnabled = true; submit.text = "เข้าสู่ระบบ"; state.text = e.message ?: "เข้าสู่ระบบไม่สำเร็จ" } } }
        }
    }

    private fun showDashboard(email: String, token: String) {
        activeToken = token
        val frame = FrameLayout(this).apply { background = bg("#DDE8D9", 0) }; setContentView(frame)
        mapView = MapView(this).also { view -> frame.addView(view, FrameLayout.LayoutParams(-1, -1)); view.getMapAsync { ready -> map = ready; ready.setStyle(Style.Builder().fromUri("https://demotiles.maplibre.org/style.json")) { renderPlotMarkers() } } }
        val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(10)); background = bg("#F8FCF7", 0); elevation = dp(8).toFloat() }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(label("VISION TR", "#164B36", 20, true), LinearLayout.LayoutParams(0, -2, 1f)); header.addView(label("ออนไลน์", "#237A57", 12, true).apply { background = bg("#E1F3E8", 18); setPadding(dp(10), dp(6), dp(10), dp(6)) }); top.addView(header); top.addView(label(email, "#607167", 12)); top.addView(space(10))
        val quickTools = LinearLayout(this).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL }
        quickTools.addView(compactTool("↻", "รีโหลดข้อมูล").apply { setOnClickListener { loadPlots(token) } })
        quickTools.addView(compactTool("◫", "สลับรูปแบบแผนที่").apply { setOnClickListener { map?.setStyle(Style.Builder().fromUri("https://demotiles.maplibre.org/style.json")); toast("แสดงแผนที่ถนน") } })
        quickTools.addView(compactTool("☰", "เครื่องมือ").apply { setOnClickListener { showToolsMenu() } })
        top.addView(quickTools)
        val searchCard = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(6), dp(6), dp(6), dp(8)); background = bg("#FFFFFF", 18, "#D7E2D7") }
        val modes = LinearLayout(this)
        dataModeButton = mode("ข้อมูลแปลง", true).also { modes.addView(it, LinearLayout.LayoutParams(0, dp(36), 1f)) }; placeModeButton = mode("สถานที่", false).also { modes.addView(it, LinearLayout.LayoutParams(0, dp(36), 1f)) }
        searchCard.addView(modes)
        searchField = input("ค้นหาข้อมูลแปลง…", InputType.TYPE_CLASS_TEXT).apply { setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0); compoundDrawablePadding = dp(10); imeOptions = EditorInfo.IME_ACTION_SEARCH; background = bg("#F1F6F1", 14); setPadding(dp(14), 0, dp(14), 0) }
        searchCard.addView(searchField, width().apply { topMargin = dp(7) }); top.addView(searchCard); frame.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        val tools = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
        tools.addView(fab("◎", "ติดตามตำแหน่ง").apply { setOnClickListener { updateLocation() } }); tools.addView(fab("⌕", "ดูแปลงทั้งหมด").apply { setOnClickListener { focusAllPlots() } }); tools.addView(fab("◉", "สั่งงานด้วยเสียง").apply { setOnClickListener { startVoiceCommand() } })
        tools.addView(fab("＋", "บันทึกข้อมูลแปลง").apply { setOnClickListener { openRecordDialog(selectedPlot) } })
        frame.addView(tools, FrameLayout.LayoutParams(dp(58), -2, Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = dp(16) })
        val sheet = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(10), dp(18), dp(14)); background = bg("#FFFFFF", 26); elevation = dp(14).toFloat(); visibility = View.GONE }
        resultsSheet = sheet
        sheet.addView(View(this).apply { background = bg("#B8C7BD", 8); layoutParams = LinearLayout.LayoutParams(dp(44), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) } })
        val sheetHeader = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }; resultSummary = label("กำลังโหลดข้อมูลแปลง…", "#183C2D", 17, true); sheetHeader.addView(resultSummary, LinearLayout.LayoutParams(0, -2, 1f)); sheetHeader.addView(label("×", "#4F665A", 28).apply { gravity = Gravity.CENTER; contentDescription = "ปิดผลการค้นหา"; setOnClickListener { resultsSheet?.visibility = View.GONE } }, LinearLayout.LayoutParams(dp(40), dp(36))); sheet.addView(sheetHeader)
        locationHint = label("กดปุ่ม ◎ เพื่อแสดงตำแหน่งของคุณ", "#68766E", 12).apply { setPadding(0, dp(3), 0, dp(5)) }; sheet.addView(locationHint)
        list = ListView(this).apply { dividerHeight = dp(1) }; sheet.addView(list, LinearLayout.LayoutParams(-1, 0, 1f)); frame.addView(sheet, FrameLayout.LayoutParams(-1, dp(270), Gravity.BOTTOM))
        dataModeButton?.setOnClickListener { setSearchMode(false) }; placeModeButton?.setOnClickListener { setSearchMode(true) }
        searchField?.addTextChangedListener(object : TextWatcher { override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit; override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) { if (!isPlaceMode) filterPlots(s?.toString().orEmpty()) }; override fun afterTextChanged(s: Editable?) = Unit })
        searchField?.setOnEditorActionListener { _, _, _ -> if (isPlaceMode) { placeNotice(); true } else false }; loadPlots(token); loadProfile(token)
    }

    private fun loadPlots(token: String) = executor.execute { try { val plots = repository.fetchPlots(token); runOnUiThread { allPlots = plots; filterPlots(searchField?.text?.toString().orEmpty()); renderPlotMarkers(); focusAllPlots() } } catch (e: Exception) { runOnUiThread { resultSummary?.text = e.message ?: "โหลดข้อมูลแปลงไม่สำเร็จ" } } }
    private fun loadProfile(token: String) = executor.execute { try { val profile = repository.fetchProfile(token); runOnUiThread { activeProfile = profile } } catch (_: Exception) { runOnUiThread { locationHint?.text = "เปิดข้อมูลแปลงได้ แต่ยังไม่พร้อมบันทึกข้อมูล" } } }
    private fun setSearchMode(place: Boolean) { isPlaceMode = place; dataModeButton?.select(!place); placeModeButton?.select(place); searchField?.apply { setText(""); hint = if (place) "ค้นหาสถานที่ ร้านค้า หรือที่อยู่…" else "ค้นหาข้อมูลแปลง…" }; if (place) { resultSummary?.text = "ค้นหาสถานที่"; list?.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf("พิมพ์ชื่อสถานที่ แล้วกดค้นหา")); resultsSheet?.visibility = View.VISIBLE } else filterPlots("") }
    private fun filterPlots(query: String) { val term = query.trim(); visiblePlots = allPlots.filter { term.isBlank() || it.displayName.contains(term, true) || it.id.contains(term, true) }; resultSummary?.text = if (term.isBlank()) "แปลงของฉัน ${visiblePlots.size} รายการ" else "ผลการค้นหา ${visiblePlots.size} รายการ"; list?.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, visiblePlots.map { "${it.displayName}\n${it.id}" }); list?.setOnItemClickListener { _, _, p, _ -> showPlot(visiblePlots[p]) }; resultsSheet?.visibility = if (term.isBlank()) View.GONE else View.VISIBLE }
    private fun showPlot(plot: Plot) { resultsSheet?.visibility = View.GONE; selectedPlot = plot; plot.latitude?.let { lat -> plot.longitude?.let { lng -> map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), 16.5)) } }; val point = if (plot.latitude != null && plot.longitude != null) "${plot.latitude}, ${plot.longitude}" else "ไม่มีพิกัด"; AlertDialog.Builder(this).setTitle(plot.displayName).setMessage("รหัสแปลง: ${plot.id}\nพิกัด: $point").setNegativeButton("ปิด", null).setNeutralButton("บันทึก") { _, _ -> openRecordDialog(plot) }.setPositiveButton("นำทาง") { _, _ -> navigate(plot) }.show() }
    private fun navigate(plot: Plot) { val lat = plot.latitude; val lng = plot.longitude; if (lat == null || lng == null) { AlertDialog.Builder(this).setMessage("แปลงนี้ยังไม่มีพิกัดสำหรับนำทาง").setPositiveButton("ตกลง", null).show(); return }; lastNavigationPlot = plot; selectedPlot = plot; openRecordAfterNavigation = true; startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(plot.displayName)})"))) }
    private fun updateLocation() { if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION); return }; val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager; val loc = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstNotNullOfOrNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }; if (loc == null) { locationHint?.text = "กำลังรอตำแหน่งจาก GPS…"; return }; locationHint?.text = "ตำแหน่งของคุณ: %.5f, %.5f".format(loc.latitude, loc.longitude); map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(loc.latitude, loc.longitude), 16.0)) }
    private fun focusAllPlots() { val first = allPlots.firstOrNull { it.latitude != null && it.longitude != null } ?: return; map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(first.latitude!!, first.longitude!!), 12.0)) }
    private fun renderPlotMarkers() {
        val activeMap = map ?: return
        activeMap.clear()
        allPlots.filter { it.latitude != null && it.longitude != null }.forEach { plot ->
            activeMap.addMarker(MarkerOptions().position(LatLng(plot.latitude!!, plot.longitude!!)).title(plot.displayName).snippet(plot.id))
        }
        activeMap.setOnMarkerClickListener { marker -> allPlots.firstOrNull { it.id == marker.snippet }?.let { showPlot(it) }; true }
    }
    private fun startVoiceCommand() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { microphonePermission.launch(Manifest.permission.RECORD_AUDIO); return }
        beginVoiceListening()
    }
    private fun beginVoiceListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { toast("อุปกรณ์นี้ยังไม่มีบริการรู้จำเสียง"); return }
        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { toast("กำลังฟังคำสั่ง…") }; override fun onBeginningOfSpeech() = Unit; override fun onRmsChanged(rmsdB: Float) = Unit; override fun onBufferReceived(buffer: ByteArray?) = Unit; override fun onEndOfSpeech() = Unit
                override fun onError(error: Int) { toast("ฟังคำสั่งไม่สำเร็จ ลองพูดใหม่อีกครั้ง") }
                override fun onResults(results: Bundle?) { results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { handleVoiceCommand(it) } }
                override fun onPartialResults(partialResults: Bundle?) = Unit; override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE, "th-TH").putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true))
        }
    }
    private fun handleVoiceCommand(transcript: String) {
        val command = transcript.trim().lowercase(Locale("th", "TH"))
        when {
            command.contains("ติดตามตำแหน่ง") || command.contains("ตามตำแหน่ง") -> { updateLocation(); speak("กำลังติดตามตำแหน่ง") }
            command.contains("นำทางล่าสุด") || command.contains("การนำทางล่าสุด") -> lastNavigationPlot?.let { navigate(it) } ?: speak("ยังไม่มีปลายทางล่าสุด")
            command.matches(Regex(".*(อ่าน|read)\\s*(\\d+)\\s*(รายการ)?.*")) -> readPlots(Regex("(\\d+)").find(command)?.value?.toIntOrNull() ?: 3)
            command.matches(Regex(".*(เลือก|รายการที่)\\s*(\\d+).*")) -> { val number = Regex("(\\d+)").find(command)?.value?.toIntOrNull() ?: 0; visiblePlots.getOrNull(number - 1)?.let { showPlot(it); speak("เลือก ${it.displayName}") } ?: speak("ไม่พบรายการที่ $number") }
            command.startsWith("ค้นหาข้อมูลแปลง") -> { val text = command.removePrefix("ค้นหาข้อมูลแปลง").trim(); setSearchMode(false); searchField?.setText(text); speak("ค้นหาข้อมูลแปลง $text") }
            command.startsWith("ค้นหาสถานที่") -> { val text = command.removePrefix("ค้นหาสถานที่").trim(); setSearchMode(true); searchField?.setText(text); placeNotice() }
            command.contains("นำทาง") || command.contains("เดินทาง") -> selectedPlot?.let { navigate(it) } ?: speak("กรุณาเลือกรายการก่อน")
            else -> speak("ยังไม่เข้าใจคำสั่ง $transcript")
        }
    }
    private fun readPlots(count: Int) { val items = visiblePlots.take(count.coerceAtLeast(1)); if (items.isEmpty()) speak("ไม่มีรายการให้อ่าน") else speak(items.mapIndexed { index, plot -> "รายการที่ ${index + 1} ${plot.displayName}" }.joinToString(". ")) }
    private fun speak(message: String) { textToSpeech?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "vision-tr") }
    private fun placeNotice() = AlertDialog.Builder(this).setTitle("ค้นหาสถานที่").setMessage("หน้าตาและโหมดค้นหาสถานที่พร้อมแล้ว ส่วนผู้ให้บริการค้นหาสถานที่ Native จะเชื่อมต่อในรอบถัดไปเพื่อไม่ใช้ Google Maps JavaScript ของเว็บ").setPositiveButton("เข้าใจแล้ว", null).show()
    private fun voiceGuide() = AlertDialog.Builder(this).setTitle("สั่งงานด้วยเสียง").setMessage("กำลังเตรียมคำสั่งสำหรับขณะขับขี่ เช่น ค้นหาข้อมูลแปลง, อ่าน 3 รายการ, เลือกรายการที่ 1, นำทางล่าสุด และติดตามตำแหน่ง").setPositiveButton("เข้าใจแล้ว", null).show()
    private fun showToolsMenu() {
        AlertDialog.Builder(this)
            .setTitle("เครื่องมือแผนที่")
            .setItems(arrayOf("รีโหลดข้อมูลแปลง", "ไปยังตำแหน่งปัจจุบัน", "แสดงแปลงทั้งหมด", "สร้างบันทึกแปลงที่เลือก")) { _, which ->
                when (which) { 0 -> activeToken?.let { loadPlots(it) }; 1 -> updateLocation(); 2 -> focusAllPlots(); 3 -> openRecordDialog(selectedPlot) }
            }.show()
    }
    private fun openRecordDialog(plot: Plot?) {
        if (plot == null) { toast("เลือกแปลงจากรายการก่อน แล้วจึงกดบันทึก"); return }
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(6), dp(22), 0) }
        val title = label(plot.displayName, "#183C2D", 17, true)
        val status = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("กำลังตรวจสอบ", "เสร็จสิ้น", "พบปัญหา")) }
        val note = EditText(this).apply { hint = "บันทึกหมายเหตุภาคสนาม…"; minLines = 4; gravity = Gravity.TOP; background = bg("#F4F7F4", 14); setPadding(dp(12), dp(10), dp(12), dp(10)) }
        form.addView(title); form.addView(label("สถานะงาน", "#557064", 13).apply { setPadding(0, dp(14), 0, dp(4)) }); form.addView(status); form.addView(label("หมายเหตุ", "#557064", 13).apply { setPadding(0, dp(12), 0, dp(4)) }); form.addView(note)
        val dialog = AlertDialog.Builder(this).setTitle("บันทึกการสำรวจ").setView(form).setNegativeButton("ยกเลิก", null).setPositiveButton("บันทึก", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val token = activeToken; val profile = activeProfile
            if (token == null || profile == null) { toast("กำลังเตรียมข้อมูลผู้ใช้ ลองอีกครั้งในครู่หนึ่ง"); return@setOnClickListener }
            val dbStatus = when (status.selectedItemPosition) { 1 -> "done"; 2 -> "problem"; else -> "checking" }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
            executor.execute { try { repository.saveRecord(token, profile, plot, dbStatus, note.text.toString()); runOnUiThread { dialog.dismiss(); toast("บันทึกข้อมูลแปลงเรียบร้อย") } } catch (e: Exception) { runOnUiThread { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; toast(e.message ?: "บันทึกข้อมูลไม่สำเร็จ") } } }
        } }
        dialog.show()
    }
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    private fun label(text: String, color: String, size: Int, bold: Boolean = false) = TextView(this).apply { this.text = text; textSize = size.toFloat(); setTextColor(Color.parseColor(color)); if (bold) typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private fun input(hint: String, type: Int) = EditText(this).apply { this.hint = hint; inputType = type; setSingleLine(true); textSize = 16f; layoutParams = width().apply { bottomMargin = dp(10) }; background = bg("#F4F7F4", 14); setPadding(dp(14), 0, dp(14), 0) }
    private fun primary(text: String) = Button(this).apply { this.text = text; textSize = 16f; setTextColor(Color.WHITE); background = bg("#1E6B4C", 14); layoutParams = width().apply { height = dp(52); bottomMargin = dp(8) } }
    private fun mode(text: String, selected: Boolean) = TextView(this).apply { this.text = text; gravity = Gravity.CENTER; textSize = 14f; select(selected) }
    private fun TextView.select(selected: Boolean) { setTextColor(Color.parseColor(if (selected) "#FFFFFF" else "#557064")); background = bg(if (selected) "#1E6B4C" else "#EAF1EA", 12); typeface = if (selected) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT }
    private fun fab(icon: String, description: String) = TextView(this).apply { text = icon; contentDescription = description; gravity = Gravity.CENTER; textSize = 27f; setTextColor(Color.parseColor("#1C5C41")); background = bg("#FFFFFF", 28, "#D6E4D7"); elevation = dp(6).toFloat(); layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply { bottomMargin = dp(12) } }
    private fun compactTool(icon: String, description: String) = TextView(this).apply { text = icon; contentDescription = description; gravity = Gravity.CENTER; textSize = 20f; setTextColor(Color.parseColor("#1C5C41")); background = bg("#EAF3EA", 12); layoutParams = LinearLayout.LayoutParams(dp(38), dp(34)).apply { marginStart = dp(6) } }
    private fun space(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun width() = LinearLayout.LayoutParams(-1, -2)
    private fun bg(color: String, radius: Int, stroke: String? = null) = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(radius).toFloat(); stroke?.let { setStroke(dp(1), Color.parseColor(it)) } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
