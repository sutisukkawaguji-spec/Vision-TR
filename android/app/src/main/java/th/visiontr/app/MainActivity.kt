package th.visiontr.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val repository = SupabaseRepository()
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var session: SharedPreferences
    private lateinit var root: LinearLayout
    private var allPlots: List<Plot> = emptyList()
    private var plotAdapter: ArrayAdapter<String>? = null
    private var plotList: ListView? = null
    private var locationText: TextView? = null

    private val locationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) updateLocation() else locationText?.text = "ยังไม่ได้อนุญาตให้ติดตามตำแหน่ง"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = getSharedPreferences("vision_tr_session", MODE_PRIVATE)
        showLogin()
        session.getString("access_token", null)?.let { token ->
            showDashboard(session.getString("email", "").orEmpty(), token)
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun showLogin() {
        root = verticalLayout().apply { gravity = Gravity.CENTER_HORIZONTAL }
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)

        root.addView(title("Vision TR"))
        root.addView(subtitle("แอป Android เชื่อมต่อฐานข้อมูล Vision TR โดยตรง"))
        root.addView(space(24))
        val email = input("อีเมล", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = input("รหัสผ่าน", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val status = subtitle("")
        val login = button("เข้าสู่ระบบ")
        root.addView(email)
        root.addView(password)
        root.addView(login)
        root.addView(status)

        login.setOnClickListener {
            val enteredEmail = email.text.toString().trim()
            val enteredPassword = password.text.toString()
            if (enteredEmail.isBlank() || enteredPassword.isBlank()) {
                status.text = "กรอกอีเมลและรหัสผ่านก่อน"
                return@setOnClickListener
            }
            login.isEnabled = false
            status.text = "กำลังเข้าสู่ระบบ…"
            executor.execute {
                try {
                    val auth = repository.signIn(enteredEmail, enteredPassword)
                    session.edit().putString("access_token", auth.accessToken).putString("email", auth.email).apply()
                    runOnUiThread { showDashboard(auth.email, auth.accessToken) }
                } catch (error: Exception) {
                    runOnUiThread {
                        login.isEnabled = true
                        status.text = error.message ?: "เข้าสู่ระบบไม่สำเร็จ"
                    }
                }
            }
        }
    }

    private fun showDashboard(email: String, accessToken: String) {
        root = verticalLayout()
        setContentView(root)
        root.addView(title("Vision TR"))
        root.addView(subtitle("เข้าสู่ระบบเป็น $email"))

        locationText = subtitle("ตำแหน่งปัจจุบัน: ยังไม่ได้ตรวจสอบ")
        root.addView(locationText)
        root.addView(button("ติดตามตำแหน่งปัจจุบัน").apply { setOnClickListener { updateLocation() } })

        val search = input("ค้นหาข้อมูลแปลง", InputType.TYPE_CLASS_TEXT)
        root.addView(search)
        val loading = ProgressBar(this).apply { isIndeterminate = true }
        root.addView(loading, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(18)
        })
        val status = subtitle("กำลังโหลดข้อมูลแปลง…")
        root.addView(status)
        val list = ListView(this)
        plotList = list
        root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(button("ออกจากระบบ").apply {
            setOnClickListener {
                session.edit().clear().apply()
                showLogin()
            }
        })

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = filterPlots(s?.toString().orEmpty())
            override fun afterTextChanged(s: Editable?) = Unit
        })
        executor.execute {
            try {
                val plots = repository.fetchPlots(accessToken)
                runOnUiThread {
                    allPlots = plots
                    loading.visibility = View.GONE
                    status.text = "พบ ${plots.size} แปลง — แตะรายการเพื่อเปิดนำทาง"
                    filterPlots(search.text.toString())
                }
            } catch (error: Exception) {
                runOnUiThread {
                    loading.visibility = View.GONE
                    status.text = error.message ?: "โหลดข้อมูลแปลงไม่สำเร็จ"
                }
            }
        }
    }

    private fun filterPlots(query: String) {
        val keyword = query.trim()
        val filtered = allPlots.filter { keyword.isBlank() || it.displayName.contains(keyword, ignoreCase = true) || it.id.contains(keyword, ignoreCase = true) }
        plotAdapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, filtered.map { it.displayName })
        plotList?.adapter = plotAdapter
        plotList?.setOnItemClickListener { _, _, position, _ -> showPlot(filtered[position]) }
    }

    private fun showPlot(plot: Plot) {
        val coordinates = if (plot.latitude != null && plot.longitude != null) "${plot.latitude}, ${plot.longitude}" else "ไม่มีพิกัด"
        AlertDialog.Builder(this)
            .setTitle(plot.displayName)
            .setMessage("รหัสแปลง: ${plot.id}\nพิกัด: $coordinates")
            .setNegativeButton("ปิด", null)
            .setPositiveButton("นำทาง") { _, _ -> openNavigation(plot) }
            .show()
    }

    private fun openNavigation(plot: Plot) {
        val latitude = plot.latitude
        val longitude = plot.longitude
        if (latitude == null || longitude == null) {
            AlertDialog.Builder(this).setMessage("แปลงนี้ยังไม่มีพิกัดสำหรับนำทาง").setPositiveButton("ตกลง", null).show()
            return
        }
        val geo = Uri.parse("geo:$latitude,$longitude?q=$latitude,$longitude(${Uri.encode(plot.displayName)})")
        startActivity(Intent(Intent.ACTION_VIEW, geo))
    }

    private fun updateLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            return
        }
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val location = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .firstNotNullOfOrNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
        locationText?.text = location?.let { formatLocation(it) } ?: "ยังหาตำแหน่งปัจจุบันไม่พบ"
    }

    private fun formatLocation(location: Location): String = "ตำแหน่งปัจจุบัน: %.6f, %.6f".format(location.latitude, location.longitude)

    private fun verticalLayout(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(24), dp(20), dp(16))
        setBackgroundColor(Color.WHITE)
    }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        textSize = 28f
        setTextColor(Color.rgb(22, 80, 56))
        setPadding(0, 0, 0, dp(6))
    }

    private fun subtitle(text: String) = TextView(this).apply {
        this.text = text
        textSize = 15f
        setTextColor(Color.DKGRAY)
        setPadding(0, dp(4), 0, dp(8))
    }

    private fun input(hint: String, inputType: Int) = EditText(this).apply {
        this.hint = hint
        this.inputType = inputType
        setSingleLine(true)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) }
    }

    private fun button(label: String) = Button(this).apply {
        text = label
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) }
    }

    private fun space(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
