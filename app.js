// Keep runtime diagnostics in the browser console.  Never interrupt field
// work with Chrome's opaque cross-origin "Script error. at :0" alert.
window.addEventListener('error', function (e) {
    const source = e.filename ? `${e.filename}:${e.lineno || 0}` : 'external script';
    console.error('[Vision TR runtime error]', e.message || 'Unknown error', source, e.error || '');
});
window.addEventListener('unhandledrejection', function (e) {
    console.error('[Vision TR unhandled promise]', e.reason);
});

// --- Google Apps Script (GAS) Proxy Configuration ---
// แทนที่ URL ด้านล่างด้วย URL จริงของคุณที่ได้จากการ Deploy Google Apps Script (ไฟล์ cod.gs) เป็น Web App
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxYmkufBM6TGiY0TwSqI-Eq6RrTZBevQZqaBbs9IPZsAyBypBFXfvsXojkeVKcaoskb/exec';

// --- Supabase Connection & Configuration ---
const surveyConfig = window.SURVEY_CONFIG || {};
let supabaseClient = null;
let supabaseUrl = String(surveyConfig.supabaseUrl || '').trim();
let supabaseKey = String(surveyConfig.supabasePublishableKey || '').trim();
const isLocalDevelopment = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const DEV_BYPASS_AUTH = isLocalDevelopment && surveyConfig.devBypassAuth === true;

// Remove the retired cloud-link import preference from older installations.
try { localStorage.removeItem('survey_geojson_drive_url'); } catch (error) { }

function initSupabase() {
    if (supabaseUrl && supabaseKey) {
        try {
            supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
            return true;
        } catch (e) {
            console.error("Supabase Client initialization error", e);
            return false;
        }
    }
    return false;
}

// --- Authentication & Session Handling ---
let authTab = 'login';

function showAuthOverlay(show) {
    const overlay = document.getElementById('auth-overlay');
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function switchAuthTab(tab) {
    try {
        authTab = tab;
        const tabLogin = document.getElementById('tab-login');
        const tabSignup = document.getElementById('tab-signup');
        const indicator = document.getElementById('auth-tab-indicator');
        const nameField = document.getElementById('name-field-container');
        const submitBtn = document.getElementById('btn-auth-submit');
        const authName = document.getElementById('auth-name');

        if (!tabLogin || !tabSignup || !nameField || !submitBtn || !authName) {
            console.error("Missing Auth UI elements in switchAuthTab");
            return;
        }

        // Reset password visibility state when switching tabs
        const passEl = document.getElementById('auth-password');
        const eyeIcon = document.getElementById('eye-icon');
        if (passEl) passEl.type = 'password';
        if (eyeIcon) {
            eyeIcon.classList.remove('fa-eye-slash');
            eyeIcon.classList.add('fa-eye');
        }

        if (tab === 'login') {
            tabLogin.classList.add('active');
            tabSignup.classList.remove('active');
            if (indicator) indicator.style.transform = 'translateX(0)';
            nameField.classList.add('hidden');
            authName.required = false;
            submitBtn.innerHTML = `<span>เข้าสู่ระบบ</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>`;
        } else {
            tabLogin.classList.remove('active');
            tabSignup.classList.add('active');
            if (indicator) indicator.style.transform = 'translateX(100%)';
            nameField.classList.remove('hidden');
            authName.required = true;
            submitBtn.innerHTML = `<span>สมัครสมาชิก</span> <i class="fa-solid fa-user-plus"></i>`;
        }
    } catch (err) {
        console.error("switchAuthTab error:", err);
        alert("เกิดข้อผิดพลาดในการสลับแท็บ: " + err.message);
    }
}
window.switchAuthTab = switchAuthTab;
window._appSwitchAuthTab = switchAuthTab;

function prefillRememberMe() {
    const rememberMe = localStorage.getItem('survey_remember_me') === 'true';
    if (rememberMe) {
        const email = localStorage.getItem('survey_remember_email') || '';
        const password = localStorage.getItem('survey_remember_password') || '';
        const emailEl = document.getElementById('auth-email');
        const passEl = document.getElementById('auth-password');
        const remEl = document.getElementById('auth-remember');
        if (emailEl) emailEl.value = email;
        if (passEl) passEl.value = password;
        if (remEl) remEl.checked = true;
    }
}

function togglePasswordVisibility() {
    const passEl = document.getElementById('auth-password');
    const eyeIcon = document.getElementById('eye-icon');
    if (passEl && eyeIcon) {
        if (passEl.type === 'password') {
            passEl.type = 'text';
            eyeIcon.classList.remove('fa-eye');
            eyeIcon.classList.add('fa-eye-slash');
        } else {
            passEl.type = 'password';
            eyeIcon.classList.remove('fa-eye-slash');
            eyeIcon.classList.add('fa-eye');
        }
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function getAuthErrorMessage(err) {
    if (!err) return 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
    const msg = err.message || String(err);
    if (msg.includes('Invalid login credentials')) {
        return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
    }
    if (msg.includes('User already registered')) {
        return 'อีเมลนี้ถูกใช้งานแล้ว กรุณาเข้าสู่ระบบ หรือใช้อีเมลอื่น';
    }
    if (msg.includes('Password should be at least')) {
        return 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
    }
    if (msg.includes('Email not confirmed')) {
        return 'อีเมลของคุณยังไม่ได้ทำการยืนยัน กรุณาตรวจสอบกล่องข้อความในอีเมลของคุณเพื่อกดลิงก์ยืนยัน';
    }
    return msg;
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (!initSupabase()) {
        Swal.fire('ยังไม่ได้ตั้งค่าเชื่อมต่อ', 'กรุณาระบุ Anon Key ในซอร์สโค้ดเพื่อเริ่มต้นใช้งาน', 'warning');
        return;
    }

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const display_name = document.getElementById('auth-name').value.trim();

    showLoading(true, authTab === 'login' ? 'กำลังเข้าสู่ระบบ...' : 'กำลังลงทะเบียนสมาชิก...');
    try {
        if (authTab === 'login') {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            if (data.user) {
                // Remember Me credentials persistence logic
                const rememberEl = document.getElementById('auth-remember');
                if (rememberEl && rememberEl.checked) {
                    localStorage.setItem('survey_remember_me', 'true');
                    localStorage.setItem('survey_remember_email', email);
                    localStorage.setItem('survey_remember_password', password);
                } else {
                    localStorage.removeItem('survey_remember_me');
                    localStorage.removeItem('survey_remember_email');
                    localStorage.removeItem('survey_remember_password');
                }
                await loadUserProfileAndData(data.user);
                Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'ยินดีต้อนรับกลับเข้าสู่ระบบ', timer: 1500, showConfirmButton: false });
            }
        } else {
            const redirectUrl = window.location.origin + window.location.pathname;
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: redirectUrl,
                    data: { display_name: display_name }
                }
            });
            if (error) throw error;
            if (data.user) {
                if (!data.session) {
                    Swal.fire({
                        title: 'สมัครสมาชิกสำเร็จ',
                        text: 'ระบบได้ส่งอีเมลยืนยันตัวตนไปยัง ' + email + ' แล้ว กรุณากดลิงก์ยืนยันในอีเมลของคุณก่อนทำการเข้าสู่ระบบ',
                        icon: 'info',
                        confirmButtonText: 'ตกลง'
                    });
                } else {
                    await loadUserProfileAndData(data.user);
                    Swal.fire('ลงทะเบียนสำเร็จ', 'ยินดีต้อนรับสมาชิกใหม่ ระบบได้สร้างพื้นที่งานให้แล้ว', 'success');
                }
            }
        }
    } catch (err) {
        Swal.fire('เกิดข้อผิดพลาด', getAuthErrorMessage(err), 'error');
    } finally {
        showLoading(false);
    }
}
window.handleAuthSubmit = handleAuthSubmit;
window._appHandleAuthSubmit = handleAuthSubmit;

async function handleForgotPassword() {
    if (!initSupabase()) {
        Swal.fire('ยังไม่ได้ตั้งค่าเชื่อมต่อ', 'กรุณาระบุ Anon Key ในซอร์สโค้ดเพื่อเริ่มต้นใช้งาน', 'warning');
        return;
    }

    const emailInput = document.getElementById('auth-email').value.trim();

    const { value: email } = await Swal.fire({
        title: 'ลืมรหัสผ่าน',
        text: 'กรุณากรอกอีเมลของคุณเพื่อรับลิงก์ตั้งรหัสผ่านใหม่',
        input: 'email',
        inputValue: emailInput,
        inputPlaceholder: 'yourname@email.com',
        showCancelButton: true,
        confirmButtonText: 'ส่งลิงก์รีเซ็ต',
        cancelButtonText: 'ยกเลิก',
        inputValidator: (value) => {
            if (!value) {
                return 'กรุณากรอกอีเมล!';
            }
        }
    });

    if (email) {
        showLoading(true, 'กำลังส่งอีเมลรีเซ็ตรหัสผ่าน...');
        try {
            const redirectUrl = window.location.origin + window.location.pathname;
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: redirectUrl
            });
            if (error) throw error;
            Swal.fire('ส่งสำเร็จ', 'ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณแล้ว กรุณาตรวจสอบกล่องจดหมาย (และอีเมลขยะ/Spam)', 'success');
        } catch (err) {
            Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
        } finally {
            showLoading(false);
        }
    }
}
window.handleForgotPassword = handleForgotPassword;
window._appHandleForgotPassword = handleForgotPassword;

async function checkAuthSession() {
    // ดักจับ hash ก่อนที่ initSupabase (supabase.createClient) จะเคลียร์ hash ออกจาก URL
    const isRecovery = window.location.hash.includes('type=recovery') || 
                       window.location.hash.includes('recovery') || 
                       window.location.search.includes('type=recovery');

    const hasAuthError = window.location.hash.includes('error=') || window.location.search.includes('error=');

    if (!initSupabase()) {
        showAuthOverlay(true);
        return;
    }

    showLoading(true, 'กำลังยืนยันตัวตน...');
    try {
        if (hasAuthError) {
            // ล้าง hash และ query parameters เพื่อไม่ให้ค้างบน URL
            const cleanUrl = window.location.href.split('#')[0].split('?')[0];
            window.history.replaceState(null, null, cleanUrl);
            
            showLoading(false);
            await Swal.fire({
                title: 'ลิงก์หมดอายุหรือผิดพลาด',
                text: 'ลิงก์รีเซ็ตรหัสผ่านนี้หมดอายุ หรืออาจจะเคยถูกใช้งานไปแล้ว (ลิงก์กู้คืนสามารถใช้งานได้เพียงครั้งเดียวเท่านั้น) กรุณากด "ลืมรหัสผ่าน?" หน้าเข้าสู่ระบบเพื่อรับลิงก์ใหม่อีกครั้งครับ',
                icon: 'error',
                confirmButtonText: 'ตกลง'
            });
            showAuthOverlay(true);
            return;
        }

        const { data: { session }, error } = await supabaseClient.auth.getSession();

        // Old production builds created anonymous "Developer" sessions. They
        // are not valid users of the app, so remove them and show login.
        if (session?.user?.is_anonymous) {
            await supabaseClient.auth.signOut();
            showAuthOverlay(true);
            return;
        }

        if (isRecovery && session && session.user) {
            // ล้าง hash และ query parameters เพื่อความปลอดภัยและป้องกันกล่องแจ้งเตือนทำงานซ้ำตอนรีเฟรช
            const cleanUrl = window.location.href.split('#')[0].split('?')[0];
            window.history.replaceState(null, null, cleanUrl);

            showLoading(false); // ปิดหน้าต่างโหลดชั่วคราว
            const { value: newPassword } = await Swal.fire({
                title: 'ตั้งรหัสผ่านใหม่',
                text: 'กรุณากรอกรหัสผ่านใหม่ที่คุณต้องการใช้งาน',
                input: 'password',
                inputPlaceholder: 'รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)',
                showCancelButton: false,
                confirmButtonText: 'บันทึกรหัสผ่านใหม่',
                allowOutsideClick: false,
                allowEscapeKey: false,
                inputValidator: (value) => {
                    if (!value) {
                        return 'กรุณากรอกรหัสผ่าน!';
                    }
                    if (value.length < 6) {
                        return 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร!';
                    }
                }
            });

            if (newPassword) {
                showLoading(true, 'กำลังอัปเดตรหัสผ่านใหม่...');
                const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
                showLoading(false);
                if (updateError) {
                    await Swal.fire('ผิดพลาด', 'ไม่สามารถอัปเดตรหัสผ่านได้: ' + updateError.message, 'error');
                } else {
                    await Swal.fire('สำเร็จ', 'อัปเดตรหัสผ่านใหม่เรียบร้อยแล้ว ยินดีต้อนรับเข้าสู่ระบบ', 'success');
                }
            }
            showLoading(true, 'กำลังเข้าสู่ระบบ...');
        }

        if (session && session.user) {
            await loadUserProfileAndData(session.user);
        } else if (DEV_BYPASS_AUTH) {
            const { data: anonymousData, error: anonymousError } = await supabaseClient.auth.signInAnonymously({
                options: { data: { display_name: 'Developer' } }
            });
            if (anonymousError) throw anonymousError;
            await loadUserProfileAndData(anonymousData.user);
        } else {
            showAuthOverlay(true);
        }
    } catch (e) {
        console.error("Auth session retrieval error", e);
        showAuthOverlay(true);
    } finally {
        showLoading(false);
    }
}

async function loadUserProfileAndData(authUser) {
    if (!navigator.onLine) {
        try {
            const cachedUser = JSON.parse(localStorage.getItem('vision-tr-offline-user') || 'null');
            if (cachedUser?.id === authUser.id) {
                currentUser = cachedUser;
                updateUserInfo();
                showAuthOverlay(false);
                if (restoreOfflineMapSnapshot()) return;
            }
        } catch (error) { console.warn('Offline profile unavailable', error); }
    }
    let profile = null;
    // ดึงข้อมูลโปรไฟล์ (และวนเช็คซ้ำเนื่องจากระบบ Database Trigger อาจจะบันทึกช้ากว่าเศษเสี้ยววินาที)
    for (let i = 0; i < 4; i++) {
        const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
        if (data) {
            profile = data;
            break;
        }
        await new Promise(r => setTimeout(r, 800));
    }

    if (profile) {
        currentUser = {
            id: authUser.id,
            email: authUser.email,
            name: profile.display_name || 'ผู้ใช้ทั่วไป',
            user_code: profile.user_code,
            team_id: profile.team_id,
            category: localStorage.getItem('survey_current_cat') || 'ทั่วไป'
        };
        try { localStorage.setItem('vision-tr-offline-user', JSON.stringify(currentUser)); } catch (error) { }

        updateUserInfo();
        showAuthOverlay(false);
        await syncJobsFromDB(true);
    } else {
        // Fallback: If DB trigger did not execute or was delayed, attempt client-side creation
        try {
            const randomCode = Math.random().toString(36).substring(2, 8);
            const fallbackProfile = {
                id: authUser.id,
                email: authUser.email || '',
                display_name: authUser.user_metadata?.display_name || 'ผู้ใช้งาน',
                user_code: randomCode,
                team_id: authUser.id
            };
            const { data: createdProfile, error: insertErr } = await supabaseClient
                .from('profiles')
                .insert([fallbackProfile])
                .select()
                .maybeSingle();

            if (createdProfile) {
                currentUser = {
                    id: authUser.id,
                    email: authUser.email,
                    name: createdProfile.display_name || 'ผู้ใช้ทั่วไป',
                    user_code: createdProfile.user_code,
                    team_id: createdProfile.team_id,
                    category: localStorage.getItem('survey_current_cat') || 'ทั่วไป'
                };
                updateUserInfo();
                showAuthOverlay(false);
                await syncJobsFromDB(true);
                return;
            }
        } catch (fbErr) {
            console.error("Profile fallback creation error:", fbErr);
        }
        throw new Error("ระบบไม่สามารถสร้างโปรไฟล์ผู้ใช้งานได้ กรุณาลองล็อกอินใหม่อีกครั้ง หรือรัน schema.sql ใน Supabase");
    }
}

async function handleLogout() {
    closeSettingsModal();
    showLoading(true, 'กำลังออกจากระบบ...');
    try {
        if (supabaseClient) await supabaseClient.auth.signOut();
    } catch (e) { }
    currentUser = { name: 'ผู้ใช้ทั่วไป', category: 'ทั่วไป' };
    dbJobs = [];
    markersGroup.clearLayers();
    updateUserInfo();
    showAuthOverlay(true);
    showLoading(false);
}

// --- Data Sync with Supabase ---
async function syncJobsFromDB(fitBounds = false) {
    if (window.pendingSurveyFeatureDrafts?.length > 0) return;
    if (!supabaseClient || !currentUser) return;
    showLoading(true, 'กำลังโหลดข้อมูลแปลงสำรวจ...');
    try {
        let allJobs = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabaseClient
                .from('jobs')
                .select('*')
                .order('updated_at', { ascending: false })
                .range(from, from + limit - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allJobs = allJobs.concat(data);
                from += data.length;
                if (data.length < limit) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        dbJobs = allJobs;

        // Scan data for unique categories and merge/register them (auto-pruning)
        const dbCategories = new Set(['ทั่วไป', 'ตรวจสอบ', 'เร่งด่วน']);
        dbJobs.forEach(j => {
            if (j.category) dbCategories.add(j.category);
        });
        if (currentUser && currentUser.category) {
            dbCategories.add(currentUser.category);
        }
        categories = Array.from(dbCategories);
        localStorage.setItem('survey_cats_v16', JSON.stringify(categories));

        updateUserInfo();
        renderImportedMapsList();

        updateAmphoeDropdown();
        renderMap(fitBounds);
    } catch (e) {
        console.error("Fetch jobs error", e);
        Swal.fire('โหลดจุดแผนที่ล้มเหลว', e.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function syncJobsSilently() {
    const isPmEditing = map && map.pm && (map.pm.globalEditModeEnabled() || map.pm.globalDragModeEnabled() || map.pm.globalRotateModeEnabled() || map.pm.globalDrawModeEnabled());
    if (window.pendingNewShapes.length > 0 || window.pendingGeomanUpdates.size > 0 || isPmEditing) return;
    if (!supabaseClient || !currentUser || isNavigating || isMapClickBlocked) return;
    try {
        let allJobs = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabaseClient
                .from('jobs')
                .select('*')
                .order('updated_at', { ascending: false })
                .range(from, from + limit - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allJobs = allJobs.concat(data);
                from += data.length;
                if (data.length < limit) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        const data = allJobs;

        if (data) {
            // ป้องกันการล้างข้อมูลที่กำลังพิมพ์หรือรูปถ่ายพรีวิวที่กำลังเลือกค้างอยู่ขณะซิงค์ในพื้นหลัง (Background Sync)
            if (selectedJobId) {
                const localJob = findJobById(selectedJobId);
                const dbJobIndex = data.findIndex(j => j.id === selectedJobId);
                const btnSave = document.getElementById('btn-save');
                const isEditing = btnSave && !btnSave.classList.contains('hidden');

                if (localJob && dbJobIndex !== -1 && isEditing) {
                    data[dbJobIndex].properties = {
                        ...data[dbJobIndex].properties,
                        images: localJob.properties.images,
                        name: document.getElementById('sheet-name').value,
                        note: document.getElementById('sheet-note').value
                    };
                }
            }

            dbJobs = data;

            // Scan data for unique categories and merge/register them (auto-pruning)
            const dbCategories = new Set(['ทั่วไป', 'ตรวจสอบ', 'เร่งด่วน']);
            dbJobs.forEach(j => {
                if (j.category) dbCategories.add(j.category);
            });
            if (currentUser && currentUser.category) {
                dbCategories.add(currentUser.category);
            }
            const oldLength = categories.length;
            categories = Array.from(dbCategories);
            if (categories.length !== oldLength) {
                localStorage.setItem('survey_cats_v16', JSON.stringify(categories));
                updateUserInfo();
            }
            renderImportedMapsList();

            renderMap(false);
            if (selectedJobId) {
                const currentOpenJob = findJobById(selectedJobId);
                if (currentOpenJob) {
                    const nameActive = document.activeElement === document.getElementById('sheet-name');
                    const noteActive = document.activeElement === document.getElementById('sheet-note');
                    const btnSave = document.getElementById('btn-save');
                    const isEditing = btnSave && !btnSave.classList.contains('hidden');

                    if (!nameActive && !noteActive && !isEditing) {
                        openSheetSilently(currentOpenJob);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Silent sync error", e);
    }
}

async function saveJobToSupabase(job) {
    if (!supabaseClient || !currentUser) return;
    const { error } = await supabaseClient
        .from('jobs')
        .upsert({
            id: job.id,
            team_id: currentUser.team_id,
            lat: job.lat,
            lng: job.lng,
            geometry: job.geometry,
            status: job.status,
            category: job.category,
            properties: job.properties,
            updated_at: new Date().toISOString()
        });

    if (error) throw error;
}

async function deleteJobFromSupabase(id) {
    if (!supabaseClient) return;
    const { error } = await supabaseClient
        .from('jobs')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

async function clearAllSupabaseJobs() {
    if (!supabaseClient || !currentUser) return;
    const { error } = await supabaseClient
        .from('jobs')
        .delete()
        .eq('team_id', currentUser.team_id);

    if (error) throw error;
}

// --- Global State Variables ---
let map, userMarker, routingControl;
let dbJobs = [], markersGroup;
let selectedJobId = null, lastSelectedJobId = null, selectedSurveyFeatureId = null, currentUser = { name: 'ผู้ใช้ทั่วไป', category: 'ทั่วไป' }, categories = ['ทั่วไป', 'ตรวจสอบ', 'เร่งด่วน'];
let selectedPlotSearchJobId = null, plotSearchFocusLayer = null, plotSearchPulseTimer = null, restoreSearchAfterSheet = false;
let selectedPlaceSearchIndex = null;
let dashboardProfiles = [], dashboardState = { year: 'all', graph: 'bar', fieldKey: '' };
let viewMode = 'original', isNavigating = false, isFollowing = false;
let activeNavigationTarget = null;
let lastNavigationTarget = null;
let activeRouteSummary = null;
let manualTravelMarker = null;
let manualTravelTarget = null;
let placeSearchPreviewMarker = null;
let placeSearchPreviewTarget = null;
let placeSearchRequestId = 0;
let googlePlacesLoaderPromise = null;
let googlePlacesSessionToken = null;
let recognition = null, isVoiceActive = false, isVoiceMuted = false;
let voiceOperationMode = 'normal';
let currentSpeedKmh = 0;
let previousGpsSample = null;
let speedSamplesKmh = [];
let drivingCandidateSince = null;
let normalCandidateSince = null;
let drivingModeEnteredAt = 0;
let lastDrivingSafetyReminder = 0;
const DRIVING_MODE_ENTER_KMH = 15;
const DRIVING_MODE_EXIT_KMH = 8;
const DRIVING_MODE_ENTER_DELAY_MS = 5000;
const DRIVING_MODE_EXIT_DELAY_MS = 15000;
const DRIVING_MODE_MIN_DURATION_MS = 30000;
const SPEED_SAMPLE_WINDOW = 5;
let speechSynth = window.speechSynthesis;
let isSpeechEnabled = localStorage.getItem('survey_speech_enabled') !== 'false';
let navInterval = null;
let markerJustClicked = false;
let ignoreNextMapClick = false;
let isMapClickBlocked = false;
let justDeletedJobId = null;
let isThreePointRectangleMode = false;
let threePointRectanglePoints = [];
let threePointRectanglePreviewGroup = null;
let threePointPreviewTimer = null;
let threePointPreviewPointer = null;
let pendingDrawingToolResume = null;
window.imagesToDeleteFromCloud = [];
window.originalImagesBackup = [];
window.pendingGeomanUpdates = new Map();
window.pendingNewShapes = [];
window.pendingSurveyFeatureDrafts = [];
const customDrawingGeometrySaveTimers = new Map();
const OFFLINE_QUEUE_DB = 'vision-tr-offline-v1';
let offlineQueueDbPromise = null;
let isFlushingOfflineQueue = false;

function getOfflineQueueDb() {
    if (offlineQueueDbPromise) return offlineQueueDbPromise;
    offlineQueueDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_QUEUE_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('pending_saves')) db.createObjectStore('pending_saves', { keyPath: 'id', autoIncrement: true });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return offlineQueueDbPromise;
}

async function getOfflineQueueItems() {
    const db = await getOfflineQueueDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction('pending_saves', 'readonly').objectStore('pending_saves').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function refreshOfflineQueueIndicator() {
    const button = document.getElementById('offline-queue-indicator');
    const countEl = document.getElementById('offline-queue-count');
    if (!button || !countEl) return;
    try {
        const count = (await getOfflineQueueItems()).length;
        countEl.textContent = count;
        button.classList.toggle('hidden', count === 0);
        button.title = `มีข้อมูลรอส่ง ${count} รายการ${navigator.onLine ? ' · แตะเพื่อลองส่ง' : ' · กำลังทำงานออฟไลน์'}`;
    } catch (error) { console.warn('Offline queue unavailable', error); }
}

async function queueOfflineSave(job) {
    const db = await getOfflineQueueDb();
    const safeJob = {
        id: job.id, team_id: job.team_id, lat: job.lat, lng: job.lng, geometry: job.geometry,
        status: job.status, category: job.category, properties: { ...(job.properties || {}) }
    };
    return new Promise((resolve, reject) => {
        const request = db.transaction('pending_saves', 'readwrite').objectStore('pending_saves').add({
            created_at: new Date().toISOString(), user_id: currentUser?.id || '', job: safeJob
        });
        request.onsuccess = async () => { await refreshOfflineQueueIndicator(); resolve(); };
        request.onerror = () => reject(request.error);
    });
}

async function removeOfflineQueueItem(id) {
    const db = await getOfflineQueueDb();
    await new Promise((resolve, reject) => {
        const request = db.transaction('pending_saves', 'readwrite').objectStore('pending_saves').delete(id);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
    });
}

async function uploadQueuedImages(job) {
    const images = job.properties?.images || [];
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        if (!image?.isTemp || !image.file) continue;
        const formData = new FormData();
        formData.append('file', image.file);
        formData.append('upload_preset', cloudinaryUploadPreset);
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, { method: 'POST', body: formData });
        if (!response.ok) throw new Error('อัปโหลดภาพไปยังคลาวด์ล้มเหลว');
        const uploaded = await response.json();
        images[i] = { url: uploaded.secure_url, public_id: uploaded.public_id, delete_token: uploaded.delete_token, uploadedAt: Date.now() };
    }
}

async function flushOfflineQueue() {
    if (!navigator.onLine || isFlushingOfflineQueue || !supabaseClient || !currentUser?.id) return;
    isFlushingOfflineQueue = true;
    try {
        const items = (await getOfflineQueueItems()).filter(item => !item.user_id || item.user_id === currentUser.id);
        for (const item of items) {
            await uploadQueuedImages(item.job);
            await saveJobToSupabase(item.job);
            await removeOfflineQueueItem(item.id);
        }
        if (items.length) {
            await syncJobsSilently();
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: `ส่งข้อมูลที่รอคิวแล้ว ${items.length} รายการ`, timer: 2400, showConfirmButton: false });
        }
    } catch (error) { console.warn('Offline queue sync paused', error); }
    finally { isFlushingOfflineQueue = false; await refreshOfflineQueueIndicator(); }
}

window.flushOfflineQueue = flushOfflineQueue;
window.addEventListener('online', () => flushOfflineQueue());
window.addEventListener('offline', () => refreshOfflineQueueIndicator());

function saveOfflineMapSnapshot() {
    try {
        const snapshot = JSON.stringify({ user_id: currentUser?.id, saved_at: new Date().toISOString(), jobs: dbJobs, categories });
        if (snapshot.length < 4 * 1024 * 1024) localStorage.setItem('vision-tr-map-snapshot', snapshot);
    } catch (error) { console.warn('Map snapshot skipped', error); }
}

function restoreOfflineMapSnapshot() {
    try {
        const snapshot = JSON.parse(localStorage.getItem('vision-tr-map-snapshot') || 'null');
        if (!snapshot || snapshot.user_id !== currentUser?.id || !Array.isArray(snapshot.jobs)) return false;
        dbJobs = snapshot.jobs;
        if (Array.isArray(snapshot.categories)) categories = snapshot.categories;
        updateUserInfo();
        renderMap(true);
        return true;
    } catch (error) { console.warn('Offline map snapshot unavailable', error); return false; }
}

// --- Helper functions for hand-drawn shapes and area calculations ---

function findJobById(id) {
    if (!id) return null;
    let job = dbJobs.find(j => j.id === id);
    if (!job && window.pendingNewShapes) {
        job = window.pendingNewShapes.find(j => j.id === id);
    }
    return job;
}
window.findJobById = findJobById;

// Geoman-created drafts live directly on the map, outside markersGroup.  Use
// the layer's own removal API as well as the map fallback so a saved draft
// cannot remain underneath its newly rendered permanent marker/boundary.
function removeDraftDrawingLayer(layer) {
    if (!layer) return;
    if (layer.pm && typeof layer.pm.disable === 'function') layer.pm.disable();
    if (typeof layer.remove === 'function') layer.remove();
    if (map?.hasLayer?.(layer)) map.removeLayer(layer);
    if (markersGroup?.hasLayer?.(layer)) markersGroup.removeLayer(layer);
}

function removePendingSurveyFeatureDraft(featureId, { removeLayer = false } = {}) {
    const drafts = window.pendingSurveyFeatureDrafts || [];
    const draft = drafts.find(item => item.feature?.id === featureId);
    window.pendingSurveyFeatureDrafts = drafts.filter(item => item.feature?.id !== featureId);
    if (removeLayer && draft?.layer) removeDraftDrawingLayer(draft.layer);
}

function restorePendingSurveyFeatureDrafts() {
    (window.pendingSurveyFeatureDrafts || []).forEach(({ layer }) => {
        if (!layer || !map) return;
        if (!map.hasLayer(layer)) layer.addTo(map);
        layer.bringToFront?.();
        if (typeof layer.eachLayer === 'function') layer.eachLayer(child => child.bringToFront?.());
    });
}

// The Geoman eraser is deliberately limited to unsaved drafts.  A persisted
// pin, boundary, or child survey drawing must be deleted from its record card,
// where the user can review exactly what will be removed.  Geoman emits its
// remove event after detaching a layer, so restore protected layers on the
// next frame without showing a disruptive dialog while the eraser is active.
let protectedLayerRestoreQueued = false;
function restoreProtectedSavedLayers() {
    if (protectedLayerRestoreQueued) return;
    protectedLayerRestoreQueued = true;
    window.setTimeout(() => {
        protectedLayerRestoreQueued = false;
        clearDrawingMeasurements();
        renderMap();
    }, 0);
}

function getFlatCoordinates(layer) {
    try {
        const geojson = layer.toGeoJSON();
        if (geojson && geojson.geometry) {
            if (geojson.geometry.type === 'Polygon') {
                return geojson.geometry.coordinates[0];
            } else if (geojson.geometry.type === 'MultiPolygon') {
                return geojson.geometry.coordinates[0][0];
            }
        }
    } catch (e) {
        console.error("Error in getFlatCoordinates", e);
    }
    try {
        if (typeof layer.getLatLngs === 'function') {
            let latlngs = layer.getLatLngs();
            if (Array.isArray(latlngs[0])) {
                latlngs = latlngs[0];
            }
            return latlngs.map(ll => [ll.lng, ll.lat]);
        }
    } catch (e) {
        console.error("Fallback getFlatCoordinates failed", e);
    }
    return [];
}

function calculatePolygonAreaInSqm(coords) {
    if (!coords || coords.length < 3) return 0;
    
    let pts = [...coords];
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        pts.push(first);
    }
    
    let area = 0;
    const R = 6378137; // Earth radius in meters
    
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        
        const lat1 = p1[1] * Math.PI / 180;
        const lat2 = p2[1] * Math.PI / 180;
        const lng1 = p1[0] * Math.PI / 180;
        const lng2 = p2[0] * Math.PI / 180;
        
        area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    
    area = Math.abs(area * R * R / 2.0);
    return area;
}

function calculateCircleAreaInSqm(radius) {
    return Math.PI * radius * radius;
}

function formatThaiArea(sqm) {
    if (!sqm || isNaN(sqm) || sqm <= 0) return '-';
    const totalSqWa = sqm / 4.0;
    const rai = Math.floor(totalSqWa / 400);
    const remainingSqWaAfterRai = totalSqWa % 400;
    const ngan = Math.floor(remainingSqWaAfterRai / 100);
    const wa = remainingSqWaAfterRai % 100;
    
    let parts = [];
    if (rai > 0) parts.push(`${rai} ไร่`);
    if (ngan > 0 || rai > 0) parts.push(`${ngan} งาน`);
    const roundedWa = Math.round(wa * 10) / 10;
    parts.push(`${roundedWa} ตร.ว.`);
    
    return parts.join(' ') + ` (${Math.round(sqm).toLocaleString()} ตร.ม.)`;
}


// Override Swal.fire to prevent overlapping/frozen alerts, especially on iOS Safari
if (window.Swal) {
    const originalSwalFire = Swal.fire.bind(Swal);
    Swal.fire = function (...args) {
        try {
            if (Swal.isVisible()) {
                Swal.close();
                // Wait for close animation to finish before opening new dialog
                return new Promise((resolve) => {
                    setTimeout(() => {
                        originalSwalFire(...args).then(resolve);
                    }, 150);
                });
            }
        } catch (e) { }
        return originalSwalFire(...args);
    };
}

let showPinLabels = localStorage.getItem('survey_show_labels') !== 'false';
let mapLabelRefreshTimer = null;
let mapLabelsAreMoving = false;

function getMapLabelLimit() {
    const zoom = map?.getZoom?.() || 0;
    if (zoom < 12) return 0;
    if (zoom < 15) return 20;
    return 45;
}

function getJobLabelClass(job) {
    if (job.status === 'done') return 'job-label job-label-done';
    if (job.id === selectedJobId && isNavigating) return 'job-label job-label-navigating';
    return 'job-label job-label-pending';
}

// Permanent Leaflet tooltips are DOM nodes. Rendering every label (including
// those outside the screen) makes panning and zooming costly on phones. Keep
// only a small, viewport-scoped set and always retain the navigation target.
function refreshMapJobLabels() {
    if (!map || !markersGroup) return;
    const bounds = map.getBounds?.();
    const labelLimit = getMapLabelLimit();
    const candidates = [];

    markersGroup.eachLayer(layer => {
        const job = layer._visionLabelJob;
        if (!job || job.properties?.is_temp === true) return;
        const isNavigationTarget = isNavigating && job.id === selectedJobId;
        const shouldConsider = isNavigationTarget || showPinLabels;
        if (!shouldConsider) {
            layer.unbindTooltip?.();
            return;
        }
        const lat = Number(job.lat);
        const lng = Number(job.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            layer.unbindTooltip?.();
            return;
        }
        const latlng = L.latLng(lat, lng);
        const isVisible = Boolean(bounds?.pad?.(0.08).contains(latlng));
        if (!isNavigationTarget && (!isVisible || labelLimit === 0)) {
            layer.unbindTooltip?.();
            return;
        }
        candidates.push({ layer, job, isNavigationTarget });
    });

    candidates.sort((a, b) => Number(b.isNavigationTarget) - Number(a.isNavigationTarget));
    const visibleLayers = new Set(candidates.slice(0, Math.max(labelLimit, 1)).map(item => item.layer));
    candidates.forEach(({ layer, job }) => {
        if (!visibleLayers.has(layer)) {
            layer.unbindTooltip?.();
            return;
        }
        layer.unbindTooltip?.();
        layer.bindTooltip(job.properties?.name || 'ไม่มีชื่อ', {
            permanent: true,
            direction: 'top',
            className: getJobLabelClass(job),
            offset: [0, -10]
        });
    });
}

function queueMapLabelRefresh(delay = 220) {
    window.clearTimeout(mapLabelRefreshTimer);
    mapLabelRefreshTimer = window.setTimeout(refreshMapJobLabels, delay);
}

function setMapLabelsMoving(isMoving) {
    mapLabelsAreMoving = isMoving;
    document.getElementById('map')?.classList.toggle('map-labels-moving', isMoving);
    if (!isMoving) queueMapLabelRefresh();
}
const cloudinaryCloudName = 'dsi3g3dix';
const cloudinaryUploadPreset = 'survey-extrapro';
let isGpsActive = false;
let gpsWatchId = null;

let maps, currentBaseMap = 'hybrid';

async function startApp() {
    // โหลดหมวดหมู่จากความจำเดิม (ถ้ามี)
    try {
        const c = localStorage.getItem('survey_cats_v16');
        if (c) categories = JSON.parse(c);
    } catch (e) { }

    initApp();
    prefillRememberMe();
    await checkAuthSession();
    refreshOfflineQueueIndicator();
    flushOfflineQueue();

    // เริ่ม Polling ข้อมูลในทีมเงียบ ๆ ทุก 10 วินาที
    setInterval(syncJobsSilently, 10000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(startApp, 0);
} else {
    window.addEventListener('load', () => setTimeout(startApp, 0));
}

function showLoading(s, t) {
    document.getElementById('loading-overlay').style.display = s ? 'flex' : 'none';
    if (t) document.getElementById('loading-text').innerText = t;
}

function initApp() {
    // Initialize Leaflet objects here (safely inside a function, not at parse time)
    markersGroup = L.layerGroup();
    maps = {
        street: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20 }),
        hybrid: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20 })
    };

    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([13.7, 100.5], 6);
    maps.hybrid.addTo(map);
    markersGroup.addTo(map);

    startGpsTracking();

    map.on('dragstart', () => { if (isFollowing) toggleGPSFollow(false); });
    map.on('movestart zoomstart', () => setMapLabelsMoving(true));
    map.on('moveend zoomend', () => setMapLabelsMoving(false));

    map.on('click', () => {
        if (isThreePointRectangleMode) return;
        if (ignoreNextMapClick) {
            ignoreNextMapClick = false;
            return;
        }
        if (markerJustClicked) {
            markerJustClicked = false;
            return;
        }
        closePlotSearchResults();
        if (!isNavigating && selectedJobId) {
            closeSheet();
        }
    });

    setupDoubleTapTravelPin();

    // Initialize label toggle button visual state
    const btn = document.getElementById('btn-label');
    if (btn) {
        if (showPinLabels) {
            btn.classList.add('bg-blue-50', 'text-blue-600');
        } else {
            btn.classList.remove('bg-blue-50', 'text-blue-600');
            btn.classList.add('text-gray-400');
        }
    }

    // Initialize Leaflet Geoman Controls
    if (map.pm) {
        map.pm.addControls({
            position: 'bottomright',
            drawMarker: true,
            drawCircle: true,
            drawRectangle: true,
            drawPolygon: true,
            drawPolyline: false,
            drawCircleMarker: false,
            editMode: true,
            dragMode: true,
            rotateMode: true,
            removalMode: true,
            drawText: false,
            cutPolygon: false
        });

        requestAnimationFrame(decorateGeomanToolbars);
        setTimeout(decorateGeomanToolbars, 250);

        // ตั้งค่าภาษาไทยสำหรับเครื่องมือวาด Geoman (รองรับคำแปลบางส่วนของ Geoman)
        map.pm.setLang('th');

        // กำหนดค่าการวาดและการเลือกจุด (Snapping) ให้เหมาะสมกับ iPad/ปากกา Stylus และนิ้วมือ
        map.pm.setGlobalOptions({
            snappable: true,
            snapDistance: 25, // เพิ่มระยะ Snap เป็น 25px ช่วยให้ปากกา/นิ้วแตะโดนง่ายขึ้น
            // Do not use dblclick on touch devices: quick taps can be treated
            // as a double click and close a polygon early. With no automatic
            // finish event, the user closes it only by tapping the first point.
            finishOn: null,
            finishOnEnter: false,
            templineStyle: {
                color: '#ef4444',
                weight: 4 // เส้นไกด์ตอนวาดหนาขึ้น เห็นได้ชัดเจนใต้หัวปากกาหรือนิ้วมือ
            },
            hintlineStyle: {
                color: '#f87171',
                weight: 3,
                dashArray: [5, 5]
            },
            pathOptions: {
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.24,
                weight: 4
            }
        });

        map.on('pm:globaleditmodetoggled', () => showPendingActionsBar());
        map.on('pm:globaldragmodetoggled', () => showPendingActionsBar());
        map.on('pm:globalrotatemodetoggled', () => showPendingActionsBar());

        // ยางลบของ Geoman ใช้ได้กับร่างที่ยังไม่บันทึกเท่านั้น ข้อมูลที่
        // บันทึกแล้ว (รวมรายการย่อยในแปลง) ต้องลบจากรายการบันทึกเสมอ
        // เพื่อป้องกันการลบข้อมูลถาวรจากการแตะบนแผนที่โดยไม่ตั้งใจ
        map.on('pm:remove', async (e) => {
            const removedLayer = e.layer;
            if (removedLayer.pendingSurveyFeatureId) {
                removePendingSurveyFeatureDraft(removedLayer.pendingSurveyFeatureId);
                clearDrawingMeasurements();
                return;
            }
            if (removedLayer.surveyFeatureId && removedLayer.parentJobId) {
                restoreProtectedSavedLayers();
                return;
            }
            const jobId = removedLayer.jobId;
            if (jobId) {
                const job = findJobById(jobId);
                if (job) {
                    if (job.properties?.is_temp !== true) {
                        restoreProtectedSavedLayers();
                        return;
                    }
                    selectedJobId = jobId;
                    // A temporary drawing has not been persisted, so it can
                    // be discarded directly without interrupting the next
                    // eraser tap with a confirmation dialog.
                    await deleteJob({ skipConfirm: true, silent: true });
                    // หากไม่สามารถลบร่างได้ ให้คืนเลเยอร์ชั่วคราว
                    if (findJobById(jobId)) {
                        removedLayer.addTo(map);
                    }
                }
            }
        });

        // Show side-by-side dimensions while a new polygon or rectangle is
        // being drawn. These are temporary measurement labels only.
        map.on('pm:drawstart', () => {
            clearDrawingMeasurements(true);
        });
        map.on('pm:drawstart', watchDrawingMeasurements);
        map.on('pm:drawend', () => setTimeout(() => clearDrawingMeasurements(false), 0));

        map.on('pm:create', async (e) => {
            const layer = e.layer;
            const shape = e.shape; // 'Marker', 'Rectangle', 'Polygon', 'Circle'
            const drawingTool = layer._visionThreePointRectangle
                ? { type: 'three-point-rectangle' }
                : { type: 'geoman', shape };

            // Pause only long enough to let the user tap this new shape and
            // complete its form. After a successful save, resume this tool.
            // Leaflet-Geoman finishes attaching the new layer immediately
            // after this event. Defer disabling one tick so it cannot remove
            // the newly created marker/polygon before it is attached.
            window.setTimeout(() => map?.pm?.Draw?.disable?.(), 0);

            if (!isSurveyShapeAllowed(shape)) {
                clearDrawingMeasurements(true);
                if (map.hasLayer(layer)) map.removeLayer(layer);
                const requiredType = getActiveSurveyLayerSettings().type === 'point' ? 'Point' : 'Polygon';
                Swal.fire('ชนิดเลเยอร์ไม่ตรงกับแบบฟอร์ม', `แบบฟอร์มนี้กำหนดให้สำรวจเป็น ${requiredType} เท่านั้น`, 'warning');
                return;
            }

            // Once the shape has been completed, keep its dimensions on the
            // map while the user fills in the save form.
            pinCompletedDrawingMeasurements(layer, shape);

            let geometry = {};
            let lat = 0;
            let lng = 0;
            let isCircle = false;
            let radius = 0;

            if (shape === 'Circle') {
                const center = layer.getLatLng();
                lat = center.lat;
                lng = center.lng;
                isCircle = true;
                radius = layer.getRadius();
                geometry = {
                    type: 'Point',
                    coordinates: [lng, lat]
                };
            } else if (shape === 'Marker') {
                const pos = layer.getLatLng();
                lat = pos.lat;
                lng = pos.lng;
                geometry = {
                    type: 'Point',
                    coordinates: [lng, lat]
                };
            } else {
                // Rectangle หรือ Polygon
                geometry = layer.toGeoJSON().geometry;
                const bounds = layer.getBounds();
                const center = bounds.getCenter();
                lat = center.lat;
                lng = center.lng;
            }

            let areaSqm = 0;
            if (isCircle) {
                areaSqm = calculateCircleAreaInSqm(radius);
            } else if (shape === 'Polygon' || shape === 'Rectangle') {
                areaSqm = calculatePolygonAreaInSqm(getFlatCoordinates(layer));
            }

            // Prefer a saved independent boundary when a drawing is made
            // inside it. This makes it a parent parcel with nested records.
            const parentJob = findDrawingParentJob({ lat, lng });
            if (!parentJob) {
                stageStandaloneSurveyDrawing({ layer, shape, geometry, lat, lng, radius, isCircle, areaSqm });
                rememberDrawingToolForSave(layer, drawingTool);
                return;
            }

            const surveyFeature = {
                id: `survey_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                shape,
                geometry,
                lat,
                lng,
                radius: isCircle ? radius : 0,
                layer_type: getActiveSurveyLayerSettings().type,
                layer_color: getSurveyLayerColorForShape(shape),
                // A drawing inside a saved free parcel is its own nested
                // independent parcel, not merely an unnamed sketch.
                is_independent_child: parentJob.properties?.is_custom_draw === true,
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            stageSurveyFeatureForSave(layer, parentJob, surveyFeature);
            rememberDrawingToolForSave(layer, drawingTool, surveyFeature.id);
        });

        // Drawing and editing are core map controls, so they are always ready.
        // Older versions stored a switch that could leave every drawing tool
        // unavailable after reload; keep the legacy flag on for compatibility.
        localStorage.setItem('survey_enable_pm', 'true');

        // Load Speech Enable setting from localStorage
        const isEnabled = localStorage.getItem('survey_speech_enabled') !== 'false';
        const chkEnableSpeech = document.getElementById('chk-enable-speech');
        if (chkEnableSpeech) chkEnableSpeech.checked = isEnabled;
        toggleGeomanToolbar(localStorage.getItem('survey_pm_toolbar_visible') !== 'false');
    }
}

function setupDoubleTapTravelPin() {
    const container = map?.getContainer();
    if (!container) return;
    const DOUBLE_TAP_DELAY_MS = 420;
    const DOUBLE_TAP_DISTANCE_PX = 42;
    let lastTouchTime = 0;
    let lastTouchPoint = null;
    let touchMoved = false;
    let lastPinTime = 0;

    const drawingModeActive = () => map?.pm && (
        map.pm.globalDrawModeEnabled() ||
        map.pm.globalEditModeEnabled() ||
        map.pm.globalDragModeEnabled() ||
        map.pm.globalRotateModeEnabled() ||
        map.pm.globalRemovalModeEnabled()
    );

    const pinAt = latlng => {
        const now = Date.now();
        if (now - lastPinTime < 600 || drawingModeActive()) return;
        lastPinTime = now;
        ignoreNextMapClick = true;
        if (navigator.vibrate) navigator.vibrate(40);
        setManualTravelPin(latlng);
    };

    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    map.on('dblclick', event => {
        event.originalEvent?.preventDefault?.();
        pinAt(event.latlng);
    });

    // iOS Safari: ตรวจจับการแตะสองครั้งโดยตรง เพื่อไม่ให้ระบบแปลงเป็นการซูมภาพ
    container.addEventListener('touchstart', event => {
        touchMoved = event.touches.length !== 1;
    }, { passive: true });
    container.addEventListener('touchmove', () => {
        touchMoved = true;
    }, { passive: true });
    container.addEventListener('touchend', event => {
        if (touchMoved || drawingModeActive() || event.changedTouches.length !== 1) {
            lastTouchTime = 0;
            lastTouchPoint = null;
            return;
        }
        const touch = event.changedTouches[0];
        const point = { x: touch.clientX, y: touch.clientY };
        const now = Date.now();
        const isSecondTap = lastTouchPoint
            && now - lastTouchTime <= DOUBLE_TAP_DELAY_MS
            && Math.hypot(point.x - lastTouchPoint.x, point.y - lastTouchPoint.y) <= DOUBLE_TAP_DISTANCE_PX;
        if (isSecondTap) {
            event.preventDefault();
            event.stopPropagation();
            const rect = container.getBoundingClientRect();
            pinAt(map.containerPointToLatLng([point.x - rect.left, point.y - rect.top]));
            lastTouchTime = 0;
            lastTouchPoint = null;
        } else {
            lastTouchTime = now;
            lastTouchPoint = point;
        }
    }, { passive: false });
    container.addEventListener('touchcancel', () => {
        lastTouchTime = 0;
        lastTouchPoint = null;
        touchMoved = false;
    }, { passive: true });

    container.addEventListener('contextmenu', event => event.preventDefault());
    container.addEventListener('selectstart', event => event.preventDefault());
    container.addEventListener('dragstart', event => event.preventDefault());
}

async function setManualTravelPin(latlng, name = 'หมุดที่ปักบนแผนที่') {
    removePlaceSearchPreview();
    manualTravelTarget = { lat: latlng.lat, lng: latlng.lng, name, type: 'manual' };
    if (manualTravelMarker) map.removeLayer(manualTravelMarker);
    manualTravelMarker = L.marker(latlng, {
        pmIgnore: true,
        icon: L.divIcon({
            className: '',
            html: '<div style="position:relative;width:48px;height:52px;display:flex;align-items:flex-start;justify-content:center;filter:drop-shadow(0 3px 3px rgba(0,0,0,.4));"><i class="fa-solid fa-location-dot" style="font-size:44px;line-height:44px;color:#7c3aed;-webkit-text-stroke:2px white;"></i><button type="button" onclick="dismissManualTravelPin(event)" aria-label="ลบหมุดเดินทาง" title="ลบหมุดเดินทาง" style="position:absolute;right:0;top:-5px;width:19px;height:19px;border:2px solid #fff;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:bold;line-height:14px;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.4);">×</button></div>',
            iconSize: [48, 52],
            iconAnchor: [24, 44],
            popupAnchor: [0, -44]
        })
    }).addTo(map).bindTooltip(name, { permanent: false, direction: 'top' });
    manualTravelMarker.on('click', event => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        openManualTravelPinActions();
    });

    const result = await Swal.fire({
        title: 'ปักหมุดเดินทางแล้ว',
        html: `<div class="text-sm text-gray-600">${v2EscapeHtml(name)}</div><div class="text-xs text-gray-400 mt-1">${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</div>`,
        icon: 'info',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="fa-solid fa-route"></i> เริ่มนำทาง',
        denyButtonText: '<i class="fab fa-google"></i> Google Maps',
        cancelButtonText: 'เก็บหมุดไว้ก่อน',
        confirmButtonColor: '#7c3aed'
    });
    if (result.isConfirmed) await startNavigationToPoint(manualTravelTarget);
    if (result.isDenied) window.open(`https://www.google.com/maps/dir/?api=1&destination=${latlng.lat},${latlng.lng}`, '_blank');
}

// Selecting a Places result should only reveal its location.  The second tap on
// this marker is the explicit confirmation to create a travel pin or navigate.
function showPlaceSearchPreview(latlng, name = 'สถานที่ค้นหา') {
    removePlaceSearchPreview();
    placeSearchPreviewTarget = { lat: latlng.lat, lng: latlng.lng, name };
    placeSearchPreviewMarker = L.marker(latlng, {
        pmIgnore: true,
        icon: L.divIcon({
            className: '',
            html: '<div style="width:40px;height:48px;display:flex;align-items:flex-start;justify-content:center;filter:drop-shadow(0 3px 3px rgba(0,0,0,.4));"><i class="fa-solid fa-location-dot" style="font-size:44px;line-height:44px;color:#2563eb;-webkit-text-stroke:2px white;"></i></div>',
            iconSize: [40, 48],
            iconAnchor: [20, 44],
            popupAnchor: [0, -44]
        })
    }).addTo(map).bindTooltip('แตะหมุดเพื่อปักหมุดหรือนำทาง', { permanent: false, direction: 'top' });
    placeSearchPreviewMarker.on('click', async event => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        const target = placeSearchPreviewTarget;
        if (!target) return;
        await setManualTravelPin(L.latLng(target.lat, target.lng), target.name);
    });
}

function removePlaceSearchPreview() {
    if (placeSearchPreviewMarker && map?.hasLayer(placeSearchPreviewMarker)) map.removeLayer(placeSearchPreviewMarker);
    placeSearchPreviewMarker = null;
    placeSearchPreviewTarget = null;
}

function removeManualTravelPin() {
    if (manualTravelMarker && map?.hasLayer(manualTravelMarker)) map.removeLayer(manualTravelMarker);
    manualTravelMarker = null;
    manualTravelTarget = null;
}

async function openManualTravelPinActions() {
    if (!manualTravelTarget) return;
    const navigatingToThisPin = isNavigating && activeNavigationTarget?.type === 'manual';
    const result = await Swal.fire({
        title: manualTravelTarget.name || 'หมุดเดินทาง',
        text: navigatingToThisPin ? 'ต้องการยกเลิกการเดินทางและลบหมุดนี้หรือไม่?' : 'ต้องการลบหมุดเดินทางนี้หรือไม่?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: navigatingToThisPin ? 'ยกเลิกและลบหมุด' : 'ลบหมุด',
        cancelButtonText: 'เก็บหมุดไว้',
        confirmButtonColor: '#ef4444'
    });
    if (!result.isConfirmed) return;
    if (navigatingToThisPin) await stopNav();
    removeManualTravelPin();
    Swal.fire({ toast: true, position: 'top', icon: 'success', title: navigatingToThisPin ? 'ยกเลิกการเดินทางและลบหมุดแล้ว' : 'ลบหมุดแล้ว', timer: 1600, showConfirmButton: false });
}

function startGpsTracking() {
    if (!navigator || !navigator.geolocation) {
        isGpsActive = false;
        updateGpsStatus();
        console.warn("Geolocation is not supported by this browser.");
        return;
    }

    try {
        if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

        gpsWatchId = navigator.geolocation.watchPosition(p => {
            isGpsActive = true;
            updateGpsStatus();
            const latlng = [p.coords.latitude, p.coords.longitude];
            updateMovementSpeed(p);
            if (!userMarker) {
                userMarker = L.marker(latlng, {
                    icon: L.divIcon({ className: 'bg-blue-500 w-4 h-4 rounded-full border-2 border-white shadow' }),
                    pmIgnore: true
                }).addTo(map);
            } else {
                userMarker.setLatLng(latlng);
            }
            if (isFollowing && !isNavigating) map.setView(latlng, 18);
        }, e => {
            isGpsActive = false;
            updateGpsStatus();
            console.error("GPS Watch error", e);
        }, { enableHighAccuracy: true });
    } catch (err) {
        console.error("Failed to start GPS tracking:", err);
        isGpsActive = false;
        updateGpsStatus();
    }
}

function updateMovementSpeed(position) {
    const now = position.timestamp || Date.now();
    let speedMps = position.coords.speed === null || position.coords.speed === undefined
        ? Number.NaN
        : Number(position.coords.speed);
    if (!Number.isFinite(speedMps) || speedMps < 0) {
        if (previousGpsSample) {
            const elapsedSeconds = (now - previousGpsSample.time) / 1000;
            if (elapsedSeconds > 0.5 && elapsedSeconds < 30 && map) {
                const distance = map.distance(
                    [previousGpsSample.lat, previousGpsSample.lng],
                    [position.coords.latitude, position.coords.longitude]
                );
                speedMps = distance / elapsedSeconds;
            }
        }
    }
    previousGpsSample = { lat: position.coords.latitude, lng: position.coords.longitude, time: now };
    if (!Number.isFinite(speedMps) || speedMps < 0) return;

    speedSamplesKmh.push(Math.max(0, speedMps * 3.6));
    if (speedSamplesKmh.length > SPEED_SAMPLE_WINDOW) speedSamplesKmh.shift();
    currentSpeedKmh = speedSamplesKmh.reduce((sum, speed) => sum + speed, 0) / speedSamplesKmh.length;

    if (currentSpeedKmh > DRIVING_MODE_ENTER_KMH) {
        normalCandidateSince = null;
        if (!drivingCandidateSince) drivingCandidateSince = now;
        if (voiceOperationMode !== 'driving' && now - drivingCandidateSince >= DRIVING_MODE_ENTER_DELAY_MS) {
            setVoiceOperationMode('driving', 'speed');
        }
    } else if (currentSpeedKmh <= DRIVING_MODE_EXIT_KMH) {
        drivingCandidateSince = null;
        if (!normalCandidateSince) normalCandidateSince = now;
        const stayedInSafetyMode = now - drivingModeEnteredAt >= DRIVING_MODE_MIN_DURATION_MS;
        if (voiceOperationMode === 'driving' && stayedInSafetyMode && now - normalCandidateSince >= DRIVING_MODE_EXIT_DELAY_MS) {
            setVoiceOperationMode('normal', 'speed');
        }
    } else {
        drivingCandidateSince = null;
        normalCandidateSince = null;
    }
    updateVoiceModeIndicator();
}

function setVoiceOperationMode(mode, reason = '') {
    if (mode === voiceOperationMode) return;
    voiceOperationMode = mode;
    if (mode === 'driving') {
        drivingModeEnteredAt = Date.now();
        drivingCandidateSince = null;
        stopReadingSequence();
        ensureDrivingVoiceActive();
    } else if (reason === 'arrival') {
        normalCandidateSince = null;
        speak('ถึงที่หมายแล้ว กลับสู่โหมดปกติ', true);
    }
    updateVoiceModeIndicator();
    updateVoiceControlUI(isVoiceMuted ? 'muted' : isVoiceActive);
}

function ensureDrivingVoiceActive() {
    if (!recognition && !initVoiceRecognition()) {
        Swal.fire({
            toast: true,
            position: 'top',
            icon: 'warning',
            title: 'เบราว์เซอร์ไม่รองรับคำสั่งเสียง',
            timer: 3000,
            showConfirmButton: false
        });
        return false;
    }
    isVoiceMuted = false;
    if (isVoiceActive) {
        updateVoiceControlUI(true);
        return true;
    }
    try {
        isVoiceActive = true;
        recognition.start();
        updateVoiceControlUI(true);
        return true;
    } catch (error) {
        isVoiceActive = false;
        updateVoiceControlUI(false);
        Swal.fire({
            toast: true,
            position: 'top',
            icon: 'info',
            title: 'แตะปุ่มไมโครโฟนและอนุญาตสิทธิ์หนึ่งครั้ง',
            timer: 3500,
            showConfirmButton: false
        });
        return false;
    }
}

function updateVoiceModeIndicator() {
    const indicator = document.getElementById('voice-mode-indicator');
    if (!indicator) return;
    indicator.classList.add('hidden');
    indicator.setAttribute('aria-hidden', 'true');
}

function updateGpsStatus() {
    const el = document.getElementById('profile-gps-status');
    if (!el) return;
    if (isGpsActive) {
        el.innerHTML = '<span class="inline-flex items-center text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><i class="fa-solid fa-circle text-[6px] mr-1 animate-pulse"></i> ใช้งานได้</span>';
    } else {
        el.innerHTML = '<span class="inline-flex items-center text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><i class="fa-solid fa-circle text-[6px] mr-1"></i> ไม่ได้รับอนุญาต / ปิดอยู่</span>';
    }
}

function resetGps() {
    showLoading(true, 'กำลังเปิดขอสิทธิ์ GPS อีกครั้ง...');

    if (!navigator || !navigator.geolocation) {
        showLoading(false);
        Swal.fire('ข้อผิดพลาด', 'อุปกรณ์ของคุณไม่รองรับ GPS หรือไม่ได้เปิดใช้งานตำแหน่งที่ตั้ง', 'error');
        return;
    }

    try {
        if (gpsWatchId) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }

        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }

        navigator.geolocation.getCurrentPosition(p => {
            isGpsActive = true;
            updateGpsStatus();
            const latlng = [p.coords.latitude, p.coords.longitude];

            userMarker = L.marker(latlng, {
                icon: L.divIcon({ className: 'bg-blue-500 w-4 h-4 rounded-full border-2 border-white shadow' })
            }).addTo(map);

            map.setView(latlng, 17);
            isFollowing = true;
            const btnGps = document.getElementById('btn-gps');
            if (btnGps) {
                btnGps.classList.add('bg-blue-50', 'text-blue-600');
                btnGps.classList.remove('text-gray-400');
            }
            showLoading(false);
            Swal.fire({
                icon: 'success',
                title: 'เชื่อมต่อ GPS สำเร็จ',
                text: 'ตำแหน่งของคุณอัปเดตบนแผนที่เรียบร้อยแล้ว',
                timer: 2000,
                showConfirmButton: false
            });
            startGpsTracking();
        }, err => {
            isGpsActive = false;
            updateGpsStatus();
            showLoading(false);
            let errMsg = 'กรุณาตรวจสอบว่าเปิดระบุตำแหน่งบนอุปกรณ์แล้ว';
            if (err.code === 1) {
                errMsg = 'สิทธิ์ระบุตำแหน่งถูกปฏิเสธ กรุณากดรูปแม่กุญแจ (Padlock) ที่แถบที่อยู่เว็บ (URL Bar) และเลือก "อนุญาต" ตำแหน่ง (Location) จากนั้นลองกดรีเซ็ตอีกครั้ง';
            }
            Swal.fire({
                icon: 'warning',
                title: 'เชื่อมต่อ GPS ไม่สำเร็จ',
                text: errMsg,
                confirmButtonText: 'รับทราบ',
                confirmButtonColor: '#3b82f6'
            });
            startGpsTracking();
        }, { enableHighAccuracy: true, timeout: 10000 });
    } catch (err) {
        showLoading(false);
        console.error("Failed to reset GPS:", err);
        Swal.fire('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการขอสิทธิ์ GPS: ' + err.message, 'error');
    }
}

function updateUserInfo() {
    document.getElementById('user-display').innerText = currentUser.name;
    const activeWorkGroupName = v2ActiveWorkGroup?.name || currentUser.category || 'ทั่วไป';
    const workGroupDisplay = document.getElementById('work-group-display');
    if (workGroupDisplay) workGroupDisplay.innerText = `กลุ่มงาน: ${activeWorkGroupName}`;
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
        const dashboardUrl = v2ActiveWorkGroup?.id ? `dashboard.html?workGroup=${encodeURIComponent(v2ActiveWorkGroup.id)}` : 'dashboard.html';
        statusBar.href = dashboardUrl;
        statusBar.title = `กลุ่มงาน: ${activeWorkGroupName} — เปิด Dashboard สรุปผลสำรวจ`;
        statusBar.setAttribute('aria-label', statusBar.title);
    }
    document.getElementById('profile-display-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email || '-';
    document.getElementById('profile-user-code').innerText = currentUser.user_code || '------';

    // Populate profile category select dropdown (only reading from active imported map categories)
    const selProfileCat = document.getElementById('sel-profile-category');
    if (selProfileCat) {
        selProfileCat.innerHTML = '';

        const rememberedCat = currentUser.category || localStorage.getItem('survey_current_cat') || 'ทั่วไป';
        const hasLoadedWorkGroups = typeof v2WorkGroups !== 'undefined' && v2WorkGroups.length > 0;
        let activeCats = hasLoadedWorkGroups
            ? v2VisibleWorkGroups().filter(group => group.is_active !== false).map(group => group.name)
            : Array.from(new Set(dbJobs.map(j => j.category).filter(Boolean)));
        if (!activeCats.includes('ทั่วไป')) {
            activeCats.push('ทั่วไป');
        }
        // During first load the work-group list has not arrived yet.  Keep the
        // user's remembered group instead of accidentally replacing it with "ทั่วไป".
        if (!hasLoadedWorkGroups && !activeCats.includes(rememberedCat)) {
            activeCats.push(rememberedCat);
        }
        const currentCat = activeCats.includes(rememberedCat) ? rememberedCat : activeCats[0];
        currentUser.category = currentCat;

        activeCats.sort();

        activeCats.forEach(cat => {
            const group = v2WorkGroups.find(item => item.name === cat);
            const groupPrefix = group?.is_shared ? '👥 ' : '🔒 ';
            selProfileCat.innerHTML += `<option value="${cat}">${groupPrefix}${cat}</option>`;
        });
        selProfileCat.value = currentCat;

        renderWorkGroupShareControl();
    }

    const catInput = document.getElementById('inp-profile-category');
    if (catInput) {
        catInput.value = '';
        catInput.classList.add('hidden');
    }

    updateGpsStatus();
}

async function saveProfileCategory({ silent = false } = {}) {
    const selProfileCat = document.getElementById('sel-profile-category');
    if (!selProfileCat) return;

    const newCat = selProfileCat.value;
    if (!newCat) {
        Swal.fire('คำเตือน', 'กรุณาระบุหรือเลือกประเภทงาน/โครงการที่กำลังสำรวจ', 'warning');
        return;
    }

    localStorage.setItem('survey_current_cat', newCat);
    currentUser.category = newCat;

    updateUserInfo();
    updateCounter();

    // Sync from database and re-draw markers with the new category
    await syncJobsFromDB();

    if (!silent) {
        Swal.fire({
            toast: true,
            position: 'top',
            icon: 'success',
            title: `สลับประเภทงานเป็น: ${newCat}`,
            timer: 1500,
            showConfirmButton: false
        });
    }
}


function updateCounter() {
    const catJobs = dbJobs.filter(j => j.category === currentUser.category);
    const doneCount = catJobs.filter(j => j.status === 'done').length;
    document.getElementById('job-counter').innerText = `${doneCount}/${catJobs.length}`;
}
function toggleGPSFollow(state) {
    isFollowing = (state !== undefined) ? state : !isFollowing;
    const btn = document.getElementById('btn-gps');
    if (isFollowing) {
        btn.classList.add('active-gps');
        if (userMarker) {
            map.setView(userMarker.getLatLng(), 18);
            Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'ติดตามตำแหน่ง', timer: 1000, showConfirmButton: false });
        } else {
            Swal.fire('รอ GPS...', '', 'info');
        }
    } else {
        btn.classList.remove('active-gps');
    }
}

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'th-TH';

    recognition.onstart = () => {
        isVoiceActive = true;
        updateVoiceControlUI(isVoiceMuted ? 'muted' : true);
    };
    recognition.onend = () => {
        if (isVoiceActive) {
            try { recognition.start(); } catch (e) { console.error("Speech Recognition restart failed:", e); }
        } else {
            updateVoiceControlUI(false);
        }
    };
    recognition.onerror = (event) => {
        console.error("Speech Recognition error:", event.error);
        if (event.error === 'not-allowed') {
            isVoiceActive = false;
            updateVoiceControlUI(false);
            Swal.fire('การสั่งการด้วยเสียง', 'สิทธิ์ไมโครโฟนถูกปฏิเสธ กรุณาอนุญาตให้ใช้งานไมโครโฟน', 'warning');
        }
    };
    recognition.onresult = (event) => {
        const resultIndex = event.resultIndex;
        const transcript = event.results[resultIndex][0].transcript.toLowerCase().trim();
        console.log("Speech recognized: ", transcript);
        handleVoiceCommand(transcript);
    };
    return true;
}

let activeUtterances = [];

function parseNumber(text) {
    if (!text) return null;
    const digits = text.match(/\d+/);
    if (digits) {
        return parseInt(digits[0], 10);
    }
    const thaiWords = {
        "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5,
        "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10,
        "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14,
        "สิบห้า": 15, "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18,
        "สิบเก้า": 19, "ยี่สิบ": 20, "ยี่สิบเอ็ด": 21, "ยี่สิบสอง": 22,
        "ยี่สิบสาม": 23, "ยี่สิบสี่": 24, "ยี่สิบห้า": 25, "ยี่สิบหก": 26,
        "ยี่สิบเจ็ด": 27, "ยี่สิบแปด": 28, "ยี่สิบเก้า": 29, "สามสิบ": 30,
        "สามสิบเอ็ด": 31, "สามสิบสอง": 32, "สามสิบสาม": 33, "สามสิบสี่": 34,
        "สามสิบห้า": 35, "สามสิบหก": 36, "สามสิบเจ็ด": 37, "สามสิบแปด": 38,
        "สามสิบเก้า": 39, "สี่สิบ": 40, "สี่สิบเอ็ด": 41, "สี่สิบสอง": 42,
        "สี่สิบสาม": 43, "สี่สิบสี่": 44, "สี่สิบห้า": 45, "สี่สิบหก": 46,
        "สี่สิบเจ็ด": 47, "สี่สิบแปด": 48, "สี่สิบเก้า": 49, "ห้าสิบ": 50
    };
    const sortedWords = Object.keys(thaiWords).sort((a, b) => b.length - a.length);
    for (const word of sortedWords) {
        if (text.includes(word)) {
            return thaiWords[word];
        }
    }
    return null;
}

function stopReadingSequence() {
    activeUtterances = [];
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    const container = document.getElementById('swal-raw-data-container');
    if (container) {
        const trs = container.querySelectorAll('tr');
        trs.forEach(tr => {
            tr.classList.remove('bg-yellow-100', 'font-semibold');
        });
    }
}

function startReadingSequence(rows, startLine, countLines) {
    stopReadingSequence();

    const container = document.getElementById('swal-raw-data-container');
    const trs = container ? container.querySelectorAll('tr') : [];

    for (let i = 0; i < countLines; i++) {
        const rowIndex = startLine - 1 + i;
        if (rowIndex >= rows.length) break;
        const row = rows[rowIndex];
        const cleanKey = row.key.replace(/_/g, ' ');
        const textToSpeak = `บรรทัดที่ ${rowIndex + 1}: ${cleanKey} คือ ${row.value}`;

        const u = new SpeechSynthesisUtterance(textToSpeak);
        u.lang = 'th-TH';

        activeUtterances.push(u);

        const trElement = trs[rowIndex];

        u.onstart = () => {
            trs.forEach(tr => tr.classList.remove('bg-yellow-100', 'font-semibold'));
            if (trElement) {
                trElement.classList.add('bg-yellow-100', 'font-semibold');
                trElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        };

        u.onend = () => {
            if (trElement) {
                trElement.classList.remove('bg-yellow-100', 'font-semibold');
            }
            const index = activeUtterances.indexOf(u);
            if (index > -1) {
                activeUtterances.splice(index, 1);
            }
        };

        u.onerror = () => {
            if (trElement) {
                trElement.classList.remove('bg-yellow-100', 'font-semibold');
            }
            const index = activeUtterances.indexOf(u);
            if (index > -1) {
                activeUtterances.splice(index, 1);
            }
        };

        window.speechSynthesis.speak(u);
    }
}

function isLatLngInJob(latlng, job) {
    if (!latlng || !job) return false;
    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);
    if (isNaN(lat) || isNaN(lng)) return false;

    // 1. Circle check
    if (job.properties && job.properties.is_circle && job.properties.radius) {
        if (map) {
            const distance = map.distance([lat, lng], [Number(job.lat), Number(job.lng)]);
            return distance <= Number(job.properties.radius);
        }
    }

    // 2. Polygon / MultiPolygon check
    if (job.geometry && (job.geometry.type === 'Polygon' || job.geometry.type === 'MultiPolygon')) {
        const type = job.geometry.type;
        const coords = job.geometry.coordinates;

        const rayCast = (x, y, vs) => {
            let inside = false;
            for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
                const xi = Number(vs[i][0]), yi = Number(vs[i][1]);
                const xj = Number(vs[j][0]), yj = Number(vs[j][1]);
                const intersect = ((yi > y) !== (yj > y))
                    && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        };

        if (type === 'Polygon') {
            if (coords && coords[0]) {
                return rayCast(lng, lat, coords[0]);
            }
        } else if (type === 'MultiPolygon') {
            for (let p = 0; p < coords.length; p++) {
                const polygonCoords = coords[p];
                if (polygonCoords && polygonCoords[0]) {
                    if (rayCast(lng, lat, polygonCoords[0])) {
                        return true;
                    }
                }
            }
        }
    }

    // 3. Point check (if user is within 15 meters)
    if (job.geometry && job.geometry.type === 'Point') {
        if (map) {
            const distance = map.distance([lat, lng], [Number(job.lat), Number(job.lng)]);
            return distance <= 15;
        }
    }

    return false;
}

function isMapDrawingInteractionActive() {
    return Boolean(
        isThreePointRectangleMode ||
        isRulerActive ||
        (map?.pm && (
            map.pm.globalEditModeEnabled() ||
            map.pm.globalDragModeEnabled() ||
            map.pm.globalRotateModeEnabled() ||
            map.pm.globalDrawModeEnabled() ||
            map.pm.globalRemovalModeEnabled()
        ))
    );
}

function rememberDrawingToolForSave(layer, tool, featureId = null) {
    if (!layer || !tool) return;
    pendingDrawingToolResume = { layer, tool, featureId };
}

function hasPendingDrawingToolForFeature(featureId) {
    return Boolean(featureId && pendingDrawingToolResume?.featureId === featureId);
}

function resumePendingDrawingTool({ layer = null, featureId = null } = {}) {
    const pending = pendingDrawingToolResume;
    if (!pending || (layer && pending.layer !== layer) || (featureId && pending.featureId !== featureId)) return false;
    pendingDrawingToolResume = null;
    window.setTimeout(() => {
        if (!map) return;
        if (pending.tool.type === 'three-point-rectangle') {
            startThreePointRectangleMode();
            return;
        }
        if (pending.tool.type === 'geoman' && pending.tool.shape && map.pm?.enableDraw) {
            stopRulerTool();
            stopThreePointRectangleMode();
            disableNativeMapToolModes('draw');
            map.pm.enableDraw(pending.tool.shape);
        }
    }, 80);
    return true;
}

function getJobFootprintSize(job) {
    if (job?.properties?.is_circle && Number(job.properties.radius) > 0) {
        return Math.PI * Number(job.properties.radius) ** 2;
    }
    const geometry = job?.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return Number.POSITIVE_INFINITY;
    const rings = geometry.type === 'Polygon' ? [geometry.coordinates?.[0]] : (geometry.coordinates || []).map(polygon => polygon?.[0]);
    return rings.reduce((total, ring) => {
        const points = ring || [];
        const degreeArea = Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length] || point;
        return sum + (Number(point?.[0]) || 0) * (Number(next?.[1]) || 0) - (Number(next?.[0]) || 0) * (Number(point?.[1]) || 0);
        }, 0)) / 2;
        const meanLatitude = points.length ? points.reduce((sum, point) => sum + (Number(point?.[1]) || 0), 0) / points.length : 0;
        return total + degreeArea * 111320 ** 2 * Math.max(0.01, Math.cos(meanLatitude * Math.PI / 180));
    }, 0) || Number.POSITIVE_INFINITY;
}

function findDrawingParentJob(latlng) {
    const matches = dbJobs.filter(job => isLatLngInJob(latlng, job));
    // A completed free boundary gets priority over Base Map where they overlap.
    // Never use an unsaved draft as parent because it has no record yet.
    const independentParents = matches
        .filter(job => job.properties?.is_custom_draw === true && job.properties?.is_temp !== true && getJobFootprintSize(job) !== Number.POSITIVE_INFINITY)
        .sort((a, b) => getJobFootprintSize(a) - getJobFootprintSize(b));
    return independentParents[0] || matches.find(job => job.properties?.is_custom_draw !== true) || null;
}

function getSurveyFeatureGeometry(layer, shape) {
    if (shape === 'Marker') {
        const point = layer.getLatLng();
        return {
            geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
            lat: point.lat,
            lng: point.lng,
            radius: 0
        };
    }
    if (shape === 'Circle' || typeof layer.getRadius === 'function') {
        const center = layer.getLatLng();
        return {
            geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
            lat: center.lat,
            lng: center.lng,
            radius: layer.getRadius()
        };
    }
    const geometry = layer.toGeoJSON().geometry;
    const center = layer.getBounds().getCenter();
    return { geometry, lat: center.lat, lng: center.lng, radius: 0 };
}

async function addSurveyFeatureToJob(job, feature) {
    // A drawing inside a Base Map is deliberately not persisted yet.  It first
    // receives its own survey record, so an accidental drawing can be cancelled
    // without appearing in the parent's list.
    return openSurveyFeatureEditor(job.id, null, feature);
}

function isTeamOwner() {
    return Boolean(currentUser?.id && currentUser.team_id === currentUser.id);
}

function v2VisibleWorkGroups() {
    return v2WorkGroups.filter(group =>
        group.is_active !== false && (isTeamOwner() || group.is_shared === true || group.created_by === currentUser?.id)
    );
}

function renderWorkGroupShareControl() {
    const row = document.getElementById('work-group-share-row');
    const checkbox = document.getElementById('chk-work-group-shared');
    const deleteButton = document.getElementById('btn-delete-work-group');
    if (!row || !checkbox) return;
    const selectedName = document.getElementById('sel-profile-category')?.value || currentUser?.category;
    const group = v2WorkGroups.find(item => item.name === selectedName);
    const canShare = isTeamOwner() && Boolean(group);
    row.classList.toggle('hidden', !canShare);
    checkbox.checked = group?.is_shared === true;
    // Deleting survey data is destructive: only the person who created this group can do it.
    const canDelete = Boolean(group && group.name !== 'ทั่วไป' && group.created_by === currentUser?.id);
    deleteButton?.classList.toggle('hidden', !canDelete);
}

async function onWorkGroupSelectionChange() {
    // The checkbox follows only the group selected in the dropdown.
    renderWorkGroupShareControl();

    // Selecting a group is itself an intention to use that group.  Persist it
    // immediately, so closing and reopening Settings never falls back to "ทั่วไป".
    const selectedName = document.getElementById('sel-profile-category')?.value;
    if (selectedName && selectedName !== currentUser?.category) {
        await saveProfileCategory({ silent: true });
    }
}
window.onWorkGroupSelectionChange = onWorkGroupSelectionChange;

function formatBaseMapImportedAt(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'ไม่ทราบวันนำเข้า';
    return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

async function createWorkGroupFromMaps() {
    const maps = v2BaseMaps.filter(item => item.source_name !== '__custom_draw__');
    const mapOptions = maps.length
        ? maps.map(item => `<label class="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 cursor-pointer"><input class="v2-group-map-checkbox mt-0.5 h-4 w-4" type="checkbox" value="${v2EscapeHtml(item.id)}"><span class="min-w-0"><b class="block text-xs text-slate-700 truncate">${v2EscapeHtml(item.name || 'Base Map')}</b><span class="block text-[10px] text-slate-500">${Number(item.feature_count || 0).toLocaleString()} แปลง · นำเข้า ${v2EscapeHtml(formatBaseMapImportedAt(item.imported_at))}</span></span></label>`).join('')
        : '<p class="text-xs text-slate-500">ยังไม่มี Base Map ที่นำเข้าไว้ สามารถสร้างกลุ่มเปล่าได้</p>';
    const result = await Swal.fire({
        title: 'สร้างกลุ่มงานใหม่',
        html: `<div class="space-y-3 text-left"><div><label class="text-xs font-bold text-slate-700">ชื่อกลุ่มงาน</label><input id="v2-new-group-name" class="swal2-input !m-0 !mt-1 !w-full" placeholder="เช่น สำรวจเดือนตุลาคม"></div>${isTeamOwner() ? '<label class="flex items-center gap-2 text-xs font-bold text-emerald-700"><input id="v2-new-group-shared" type="checkbox" class="h-4 w-4"> แชร์ให้ทีม</label>' : ''}<div><label class="mb-1 block text-xs font-bold text-slate-700">เลือก Base Map ที่ต้องการใช้ในกลุ่มนี้</label><div class="max-h-56 space-y-2 overflow-y-auto pr-1">${mapOptions}</div></div><p class="text-[10px] text-amber-700">Base Map ที่เลือกจะย้ายมาอยู่กลุ่มใหม่นี้ แต่จะไม่ถูกลบ</p></div>`,
        showCancelButton: true,
        confirmButtonText: 'สร้างกลุ่มงาน',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const name = document.getElementById('v2-new-group-name')?.value.trim();
            if (!name) return Swal.showValidationMessage('กรุณาระบุชื่อกลุ่มงาน');
            return {
                name,
                isShared: Boolean(document.getElementById('v2-new-group-shared')?.checked),
                mapIds: Array.from(document.querySelectorAll('.v2-group-map-checkbox:checked')).map(input => input.value)
            };
        }
    });
    if (!result.isConfirmed) return;
    showLoading(true, 'กำลังสร้างกลุ่มงาน...');
    try {
        const group = await v2EnsureWorkGroup(result.value.name, { isShared: result.value.isShared });
        if (result.value.mapIds.length) {
            const { error } = await supabaseClient.from('base_maps').update({ work_group_id: group.id }).in('id', result.value.mapIds);
            if (error) throw error;
            v2BaseMaps = v2BaseMaps.map(item => result.value.mapIds.includes(item.id) ? { ...item, work_group_id: group.id } : item);
        }
        currentUser.category = group.name;
        await syncJobsFromDB(true);
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: `สร้างกลุ่มงาน “${group.name}” แล้ว`, timer: 1600, showConfirmButton: false });
    } catch (error) {
        Swal.fire('สร้างกลุ่มงานไม่สำเร็จ', error.message, 'error');
    } finally { showLoading(false); }
}
window.createWorkGroupFromMaps = createWorkGroupFromMaps;

function getWorkGroupImagePublicIds(records) {
    const images = [];
    (records || []).forEach(record => {
        if (Array.isArray(record.images)) images.push(...record.images);
        const features = record.record_properties?.survey_features;
        if (Array.isArray(features)) {
            features.forEach(feature => {
                if (Array.isArray(feature?.images)) images.push(...feature.images);
            });
        }
    });
    return [...new Set(images.map(image => {
        if (typeof image === 'string') return getPublicIdFromUrl(image);
        return image?.public_id || getPublicIdFromUrl(image?.url);
    }).filter(Boolean))];
}

async function deleteSelectedWorkGroup() {
    const selectedName = document.getElementById('sel-profile-category')?.value || currentUser?.category;
    const group = v2WorkGroups.find(item => item.name === selectedName);
    if (!group || group.name === 'ทั่วไป') return;
    if (group.created_by !== currentUser?.id) {
        return Swal.fire('ไม่มีสิทธิ์ลบกลุ่มงานนี้', 'เฉพาะผู้สร้างกลุ่มงานเท่านั้นที่ลบได้', 'warning');
    }

    const result = await Swal.fire({
        title: `ลบกลุ่มงาน “${group.name}”?`,
        html: `<div class="space-y-3 text-left text-sm text-slate-600">
            <p>การดำเนินการนี้<b class="text-rose-600">ไม่สามารถย้อนกลับได้</b></p>
            <div class="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <b class="block text-rose-700">ข้อมูลที่จะถูกลบ</b>
                <ul class="mt-1 list-disc space-y-1 pl-5 text-xs"><li>ผลการสำรวจและสถานะของทุกแปลงในกลุ่มนี้</li><li>ข้อความ หมายเหตุ และรายละเอียดการบันทึก</li><li>ภาพถ่ายที่แนบกับการสำรวจ</li><li>แบบฟอร์มบันทึกของกลุ่มงานนี้</li></ul>
            </div>
            <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs"><b class="text-emerald-700">Base Map และขอบเขตแปลงจะไม่ถูกลบ</b><br>ระบบจะเก็บไว้ให้เลือกนำไปใช้กับกลุ่มงานใหม่ได้</div>
            <div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"><b>กรุณาสำรองข้อมูลก่อนลบ</b><br>หากยังต้องการข้อมูลสำรวจ โปรดส่งออกหรือบันทึกข้อมูลและรูปถ่ายไว้ก่อนดำเนินการ เพราะเมื่อลบแล้วไม่สามารถกู้คืนได้</div>
        </div>`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'รับทราบและดำเนินการต่อ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#e11d48'
    });
    if (!result.isConfirmed) return;

    const passwordResult = await Swal.fire({
        title: 'ยืนยันรหัสผ่านก่อนลบ',
        text: 'กรอกรหัสผ่านบัญชีของคุณเพื่อยืนยันการลบกลุ่มงานและข้อมูลสำรวจ',
        input: 'password',
        inputPlaceholder: 'รหัสผ่านของคุณ',
        inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
        showCancelButton: true,
        confirmButtonText: 'ยืนยันและลบถาวร',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#e11d48',
        preConfirm: password => {
            if (!password) {
                Swal.showValidationMessage('กรุณากรอกรหัสผ่านเพื่อดำเนินการต่อ');
                return false;
            }
            return password;
        }
    });
    if (!passwordResult.isConfirmed) return;

    showLoading(true, 'กำลังตรวจสอบรหัสผ่าน...');
    try {
        if (!currentUser?.email) throw new Error('ไม่พบอีเมลผู้ใช้งานปัจจุบัน');
        const { error: authError } = await supabaseClient.auth.signInWithPassword({
            email: currentUser.email,
            password: passwordResult.value
        });
        if (authError) throw new Error('รหัสผ่านไม่ถูกต้อง');

        showLoading(true, 'กำลังลบข้อมูลสำรวจและกลุ่มงาน...');
        const { data: records, error: recordsError } = await supabaseClient
            .from('plot_records')
            .select('id, images, record_properties')
            .eq('work_group_id', group.id);
        if (recordsError) throw recordsError;

        // Delete uploaded files first; deleting the group then cascades its records/forms.
        const imagePublicIds = getWorkGroupImagePublicIds(records);
        await Promise.all(imagePublicIds.map(async publicId => {
            try {
                await fetch(GAS_URL + '?publicId=' + encodeURIComponent(publicId), { mode: 'no-cors' });
            } catch (error) {
                console.error('ลบภาพจากคลาวด์ไม่สำเร็จ:', publicId, error);
            }
        }));

        const { error } = await supabaseClient.from('work_groups').delete().eq('id', group.id);
        if (error) throw error;
        v2WorkGroups = v2WorkGroups.filter(item => item.id !== group.id);
        v2PlotRecords = v2PlotRecords.filter(record => record.work_group_id !== group.id);
        v2SurveyForms = v2SurveyForms.filter(form => form.work_group_id !== group.id);
        const fallback = v2VisibleWorkGroups()[0]?.name || 'ทั่วไป';
        currentUser.category = fallback;
        await syncJobsFromDB(true);
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'ลบกลุ่มงานและข้อมูลสำรวจแล้ว', timer: 1800, showConfirmButton: false });
    } catch (error) {
        Swal.fire('ลบกลุ่มงานไม่สำเร็จ', error.message, 'error');
    } finally { showLoading(false); }
}
window.deleteSelectedWorkGroup = deleteSelectedWorkGroup;

async function toggleActiveWorkGroupSharing(shared) {
    const selectedName = document.getElementById('sel-profile-category')?.value || currentUser?.category;
    const group = v2WorkGroups.find(item => item.name === selectedName);
    if (!isTeamOwner() || !group) return;
    showLoading(true, shared ? 'กำลังแชร์กลุ่มงานให้ทีม...' : 'กำลังตั้งกลุ่มงานเป็นส่วนตัว...');
    try {
        const { data, error } = await supabaseClient.from('work_groups')
            .update({ is_shared: Boolean(shared) })
            .eq('id', group.id).select().single();
        if (error) throw error;
        v2WorkGroups = v2WorkGroups.map(item => item.id === data.id ? data : item);
        if (v2ActiveWorkGroup?.id === data.id) v2ActiveWorkGroup = data;
        updateUserInfo();
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: shared ? 'แชร์กลุ่มงานให้ทีมแล้ว' : 'กลุ่มงานเป็นส่วนตัวแล้ว', timer: 1500, showConfirmButton: false });
    } catch (error) {
        const checkbox = document.getElementById('chk-work-group-shared');
        if (checkbox) checkbox.checked = !shared;
        Swal.fire('เปลี่ยนการแชร์ไม่สำเร็จ', error.message, 'error');
    } finally { showLoading(false); }
}
window.toggleActiveWorkGroupSharing = toggleActiveWorkGroupSharing;

function stageSurveyFeatureForSave(layer, parentJob, feature) {
    if (!layer || !parentJob) return;
    layer.pendingSurveyFeature = feature;
    layer.pendingSurveyFeatureId = feature.id;
    layer.pendingParentJobId = parentJob.id;
    window.pendingSurveyFeatureDrafts = (window.pendingSurveyFeatureDrafts || []).filter(item => item.feature?.id !== feature.id);
    window.pendingSurveyFeatureDrafts.push({ layer, parentJobId: parentJob.id, feature });
    // This child is only a draft until its form is saved.  Keep it above the
    // parent boundary and explicitly allow the eraser to discard it.
    const prepareDraft = target => {
        target.options = target.options || {};
        target.options.pmIgnore = false;
        target.options.allowRemoval = true;
        if (L.PM?.reInitLayer) L.PM.reInitLayer(target);
        target.pm?.setOptions?.({ allowRemoval: true });
        target.bringToFront?.();
    };
    prepareDraft(layer);
    if (typeof layer.eachLayer === 'function') layer.eachLayer(prepareDraft);
    // Geoman can finish adding its SVG path after pm:create; bring it forward
    // once more on the next frame so the parent polygon cannot receive taps.
    window.setTimeout(() => restorePendingSurveyFeatureDrafts(), 0);
    if (typeof layer.setStyle === 'function') layer.setStyle({ color: '#ef4444', fillColor: '#ef4444', fillOpacity: .28, weight: 4 });
    const isIndependentParent = parentJob.properties?.is_custom_draw === true;
    layer.bindTooltip?.(isIndependentParent ? 'แตะรายการย่อยอีกครั้งเพื่อบันทึก' : 'แตะรูปแปลงอีกครั้งเพื่อบันทึก', { direction: 'top' });
    layer.on('click', async event => {
        if (isMapDrawingInteractionActive() || layer.isOpeningSurveySave) return;
        if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        markerJustClicked = true;
        layer.isOpeningSurveySave = true;
        const saved = await addSurveyFeatureToJob(parentJob, feature);
        // Cancel keeps the draft on the map so it can be opened again later.
        if (!saved) layer.isOpeningSurveySave = false;
    });
}

async function dismissManualTravelPin(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (isNavigating && activeNavigationTarget?.type === 'manual') await stopNav();
    removeManualTravelPin();
}
window.dismissManualTravelPin = dismissManualTravelPin;

function surveyFeatureFormHtml(feature) {
    const form = getActiveSurveyForm();
    const fields = Array.isArray(form?.fields) ? [...form.fields].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) : [];
    const values = feature?.form_data || {};
    const fieldHtml = fields.map(field => {
        const type = normalizeSurveyFieldType(field.type);
        const value = values[field.key] ?? '';
        const common = `data-feature-key="${v2EscapeHtml(field.key)}" class="feature-form-input swal2-input !m-0 !w-full"`;
        if (type === 'textarea') return `<label class="text-xs font-bold">${v2EscapeHtml(field.label)}${field.required ? ' *' : ''}</label><textarea ${common} rows="3">${v2EscapeHtml(value)}</textarea>`;
        if (type === 'checkbox') return `<label class="flex gap-2 text-xs font-bold"><input ${common} type="checkbox" ${value === true ? 'checked' : ''}>${v2EscapeHtml(field.label)}</label>`;
        if (type === 'select' || type === 'multiselect') {
            const selected = Array.isArray(value) ? value.map(String) : [String(value)];
            const options = normalizeSurveyFieldOptions(field.options).filter(option => option.active || selected.includes(option.id))
                .map(option => `<option value="${v2EscapeHtml(option.id)}" ${selected.includes(option.id) ? 'selected' : ''}>${v2EscapeHtml(option.label)}${option.active ? '' : ' (ค่าเดิม)'}</option>`).join('');
            return `<label class="text-xs font-bold">${v2EscapeHtml(field.label)}${field.required ? ' *' : ''}</label><select ${common} ${type === 'multiselect' ? 'multiple size="4"' : ''}>${type === 'select' ? '<option value="">-- เลือก --</option>' : ''}${options}</select>`;
        }
        const inputType = type === 'datetime' ? 'datetime-local' : (['number', 'date', 'time'].includes(type) ? type : 'text');
        return `<label class="text-xs font-bold">${v2EscapeHtml(field.label)}${field.required ? ' *' : ''}</label><input ${common} type="${inputType}" value="${v2EscapeHtml(value)}" placeholder="${v2EscapeHtml(field.placeholder || '')}">`;
    }).join('<div class="h-1"></div>');
    const photos = Array.isArray(feature?.images) ? feature.images : [];
    const photoHtml = photos.map(image => {
        const url = typeof image === 'string' ? image : image?.url;
        return url ? `<img src="${v2EscapeHtml(url)}" class="w-16 h-16 object-cover rounded-lg border">` : '';
    }).join('');
    return `<div class="text-left space-y-2 max-h-[65vh] overflow-y-auto pr-1">
        <div class="rounded-xl bg-rose-50 border border-rose-100 p-2 text-xs text-rose-800"><i class="fa-solid fa-draw-polygon mr-1"></i> บันทึกข้อมูลของรูปวาดนี้แยกจากข้อมูลแปลงหลัก</div>
        <label class="text-xs font-bold">ชื่อรายการรูปวาด</label><input id="feature-title" class="swal2-input !m-0 !w-full" value="${v2EscapeHtml(feature?.name || '')}" placeholder="เช่น จุดพบต้นปาล์ม">
        ${fieldHtml}
        <label class="text-xs font-bold">หมายเหตุ</label><textarea id="feature-note" class="swal2-textarea !m-0 !w-full" rows="3">${v2EscapeHtml(feature?.note || '')}</textarea>
        <label class="text-xs font-bold">รูปถ่าย (ไม่เกิน 6 รูป)</label>
        <div class="flex gap-2 flex-wrap">${photoHtml || '<span class="text-[10px] text-gray-400">ยังไม่มีรูป</span>'}</div>
        <input id="feature-photo-input" type="file" accept="image/*" capture="environment" multiple class="block w-full text-xs">
    </div>`;
}

async function uploadSurveyFeatureFiles(files) {
    if (!files.length) return [];
    if (!cloudinaryCloudName || !cloudinaryUploadPreset) throw new Error('กรุณาตั้งค่า Cloudinary ก่อนเพิ่มรูปถ่าย');
    const uploaded = [];
    for (const file of files) {
        const compressed = await compressImage(file, 1000, 0.78);
        const body = new FormData();
        body.append('file', compressed);
        body.append('upload_preset', cloudinaryUploadPreset);
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, { method: 'POST', body });
        if (!response.ok) throw new Error('อัปโหลดรูปถ่ายไม่สำเร็จ');
        const data = await response.json();
        uploaded.push({ url: data.secure_url, public_id: data.public_id });
    }
    return uploaded;
}

async function openSurveyFeatureEditor(jobId, featureId = null, draftFeature = null) {
    const job = findJobById(jobId);
    if (!job) return;
    const existing = featureId ? job.properties?.survey_features?.find(feature => feature.id === featureId) : null;
    const feature = { ...(existing || draftFeature || {}), form_data: { ...(existing?.form_data || draftFeature?.form_data || {}) } };
    const isIndependentChild = feature.is_independent_child === true;
    const result = await Swal.fire({
        title: existing ? (isIndependentChild ? 'แก้ไขแปลงอิสระย่อย' : 'แก้ไขรูปวาดในแปลง') : (isIndependentChild ? 'บันทึกแปลงอิสระย่อย' : 'บันทึกรูปวาดในแปลง'),
        html: surveyFeatureFormHtml(feature),
        width: 620,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> บันทึกรูปวาด',
        cancelButtonText: 'ยกเลิก',
        allowOutsideClick: false,
        preConfirm: () => {
            const values = {};
            const missing = [];
            const fields = getActiveSurveyForm()?.fields || [];
            document.querySelectorAll('.feature-form-input').forEach(input => {
                values[input.dataset.featureKey] = input.type === 'checkbox' ? input.checked : input.multiple ? Array.from(input.selectedOptions).map(option => option.value) : input.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
            });
            fields.forEach(field => { const value = values[field.key]; if (field.required && (value === '' || value === undefined || (Array.isArray(value) && !value.length))) missing.push(field.label); });
            if (missing.length) return Swal.showValidationMessage(`กรุณากรอก: ${missing.join(', ')}`);
            return { name: document.getElementById('feature-title').value.trim(), note: document.getElementById('feature-note').value.trim(), values, files: Array.from(document.getElementById('feature-photo-input').files || []) };
        }
    });
    if (!result.isConfirmed) return false;
    showLoading(true, 'กำลังบันทึกรูปวาด...');
    try {
        const current = Array.isArray(job.properties?.survey_features) ? job.properties.survey_features : [];
        const newImages = await uploadSurveyFeatureFiles(result.value.files.slice(0, Math.max(0, 6 - (feature.images || []).length)));
        const savedFeature = {
            ...feature,
            id: feature.id || `survey_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: result.value.name || (isIndependentChild ? `แปลงอิสระ ${current.length + 1}` : `รูปวาด ${current.length + 1}`),
            note: result.value.note,
            form_data: result.value.values,
            form_version: getActiveSurveyForm()?.version || 0,
            form_schema: getActiveSurveyForm()?.fields || [],
            recorded_by: currentUser?.id || feature.recorded_by || null,
            recorded_by_name: currentUser?.name || currentUser?.display_name || feature.recorded_by_name || 'ผู้สำรวจ',
            images: [...(feature.images || []), ...newImages],
            status: 'done',
            recorded_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        job.properties.survey_features = existing ? current.map(item => item.id === featureId ? savedFeature : item) : [...current, savedFeature];
        await saveJobToSupabase(job);
        if (!existing) removePendingSurveyFeatureDraft(savedFeature.id, { removeLayer: true });
        await syncJobsSilently();
        clearDrawingMeasurements();
        const refreshedJob = findJobById(job.id);
        Swal.fire({
            toast: true,
            position: 'top',
            icon: 'success',
            title: existing ? 'บันทึกการแก้ไขรูปวาดแล้ว' : 'บันทึกรูปวาดในแปลงแล้ว',
            timer: 2600,
            showConfirmButton: false
        });
        const continueDrawing = hasPendingDrawingToolForFeature(savedFeature.id);
        if (continueDrawing) {
            closeSheet(null, { preserveSavedState: true });
            resumePendingDrawingTool({ featureId: savedFeature.id });
        } else if (refreshedJob) {
            selectedSurveyFeatureId = savedFeature.id;
            openSheet(refreshedJob);
            focusSurveyFeature(job.id, savedFeature.id, false);
        }
        return true;
    } catch (error) {
        console.error('Survey feature save error', error);
        renderMap(false);
        Swal.fire('บันทึกรูปวาดไม่สำเร็จ', error.message, 'error');
        return false;
    } finally { showLoading(false); }
}

async function saveStandaloneSurveyDrawing({ shape, geometry, lat, lng, radius, isCircle, areaSqm }) {
    const shapeNames = {
        Marker: 'หมุดสำรวจอิสระ',
        Circle: 'วงกลมสำรวจอิสระ',
        Rectangle: 'พื้นที่สี่เหลี่ยมอิสระ',
        Polygon: 'รูปแปลงอิสระ'
    };
    const job = {
        id: `standalone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        team_id: currentUser?.team_id || null,
        lat,
        lng,
        geometry,
        status: 'waiting',
        category: v2ActiveWorkGroup?.name || currentUser?.category || 'ทั่วไป',
        properties: {
            name: shapeNames[shape] || `พื้นที่สำรวจอิสระ (${shape})`,
            note: '',
            images: [],
            date: '',
            area: areaSqm > 0 ? formatThaiArea(areaSqm) : '-',
            is_circle: isCircle === true,
            radius: isCircle ? Number(radius) || 0 : 0,
            is_custom_draw: true,
            source_type: 'standalone_survey',
            drawing_shape: shape,
            form_layer_type: getActiveSurveyLayerSettings().type,
            form_layer_color: getSurveyLayerColorForShape(shape)
        }
    };

    try {
        await saveJobToSupabase(job);
        await syncJobsSilently();
        // Keep the map clear after drawing. The user opens the save panel by
        // tapping the newly created marker or boundary when ready.
    } catch (error) {
        console.error('Standalone survey drawing save error', error);
        Swal.fire('บันทึกรูปวาดอิสระไม่สำเร็จ', error.message, 'error');
        await syncJobsSilently();
    }
}

async function updateSurveyFeatureFromLayer(jobId, featureId, layer) {
    const job = findJobById(jobId);
    if (!job) return;
    const features = Array.isArray(job.properties?.survey_features) ? job.properties.survey_features : [];
    const index = features.findIndex(feature => feature.id === featureId);
    if (index < 0) return;
    const position = getSurveyFeatureGeometry(layer, features[index].shape);
    features[index] = { ...features[index], ...position, updated_at: new Date().toISOString() };
    job.properties.survey_features = features;
    try {
        await saveJobToSupabase(job);
    } catch (error) {
        console.error('Survey feature update error', error);
        Swal.fire('แก้ไขรูปวาดไม่สำเร็จ', error.message, 'error');
        await syncJobsSilently();
    }
}

async function removeSurveyFeatureFromJob(jobId, featureId, { silent = false } = {}) {
    const job = findJobById(jobId);
    if (!job) return;
    const features = Array.isArray(job.properties?.survey_features) ? job.properties.survey_features : [];
    job.properties.survey_features = features.filter(feature => feature.id !== featureId);
    try {
        await saveJobToSupabase(job);
        if (!silent) Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'ลบรูปวาดออกจากแปลงแล้ว', timer: 1500, showConfirmButton: false });
    } catch (error) {
        console.error('Survey feature remove error', error);
        Swal.fire('ลบรูปวาดไม่สำเร็จ', error.message, 'error');
    }
    await syncJobsSilently();
}

// Keep a newly drawn standalone pin/boundary on the map until the user taps it
// and completes the save form.  Persisting immediately made the drawing vanish
// on a refresh/error and gave the user no reliable way to enter its details.
function stageStandaloneSurveyDrawing({ layer, shape, geometry, lat, lng, radius, isCircle, areaSqm }) {
    const shapeNames = {
        Marker: 'หมุดสำรวจอิสระ',
        Circle: 'วงกลมสำรวจอิสระ',
        Rectangle: 'พื้นที่สี่เหลี่ยมอิสระ',
        Polygon: 'รูปแปลงอิสระ'
    };
    const job = {
        id: `drawn_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        team_id: currentUser?.team_id || null,
        lat,
        lng,
        geometry,
        status: 'waiting',
        category: v2ActiveWorkGroup?.name || currentUser?.category || 'ทั่วไป',
        layer,
        properties: {
            name: shapeNames[shape] || `พื้นที่สำรวจอิสระ (${shape})`,
            note: '',
            images: [],
            date: '',
            area: areaSqm > 0 ? formatThaiArea(areaSqm) : '-',
            is_circle: isCircle === true,
            radius: isCircle ? Number(radius) || 0 : 0,
            is_custom_draw: true,
            is_temp: true,
            source_type: 'standalone_survey',
            drawing_shape: shape,
            form_layer_type: getActiveSurveyLayerSettings().type,
            form_layer_color: getSurveyLayerColorForShape(shape)
        }
    };

    layer.jobId = job.id;
    markLayerAsSurveyDrawing(layer, job.id);
    layer.bindTooltip?.('แตะอีกครั้งเพื่อบันทึก', { direction: 'top', className: 'job-label-pending' });
    const openSaveForm = event => {
        if (isMapDrawingInteractionActive()) return;
        if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        markerJustClicked = true;
        // Let the map's click handler finish first. It can close the sheet
        // during the same Leaflet event; opening on the next tick makes a
        // deliberate tap on the new drawing reliably show its save form.
        window.setTimeout(() => openSheet(job), 0);
    };
    layer.on('click', openSaveForm);
    if (typeof layer.eachLayer === 'function') layer.eachLayer(child => child.on('click', openSaveForm));

    dbJobs.push(job);
    window.pendingNewShapes.push(job);
}

function renderSurveyFeatureList(job) {
    const section = document.getElementById('survey-feature-section');
    const list = document.getElementById('survey-feature-list');
    const count = document.getElementById('survey-feature-count');
    const heading = document.getElementById('survey-feature-heading');
    const actions = document.getElementById('survey-feature-actions');
    if (!section || !list || !count) return;
    const features = Array.isArray(job?.properties?.survey_features) ? job.properties.survey_features : [];
    const isIndependentParent = job?.properties?.is_custom_draw === true;
    if (heading) heading.innerHTML = `<i class="fa-solid fa-diagram-project mr-1"></i>${isIndependentParent ? 'แปลงอิสระย่อยในแปลงนี้' : 'รูปวาดในแปลงนี้'}`;
    count.textContent = `${features.length} ${isIndependentParent ? 'รายการย่อย' : 'รูป'}`;
    section.classList.toggle('hidden', features.length === 0);
    if (features.length === 0) {
        list.innerHTML = '';
        if (actions) actions.innerHTML = '';
        return;
    }
    const labels = { Marker: 'จุด', Circle: 'วงกลม', Polygon: 'พื้นที่', Rectangle: 'สี่เหลี่ยม' };
    list.innerHTML = features.map((feature, index) => {
        const label = labels[feature.shape] || feature.shape || 'รูปวาด';
        const status = feature.status === 'done' ? 'สำรวจแล้ว' : 'รอตรวจ';
        return `<div class="flex items-center gap-2 rounded-xl bg-white border ${selectedSurveyFeatureId === feature.id ? 'border-rose-500 ring-2 ring-rose-200' : 'border-rose-100'} px-3 py-2">
            <input type="checkbox" class="survey-feature-select h-4 w-4 shrink-0 accent-rose-600" data-job-id="${v2EscapeHtml(job.id)}" data-feature-id="${v2EscapeHtml(feature.id)}" onchange="updateSurveyFeatureSelectionUi('${job.id}')" aria-label="เลือกรายการ ${index + 1}">
            <span class="w-6 h-6 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-[10px] font-bold">${index + 1}</span>
            <button type="button" onclick="focusSurveyFeature('${job.id}', '${feature.id}')" class="min-w-0 flex-1 text-left">
                <span class="block text-xs font-bold text-slate-700">${v2EscapeHtml(feature.name || label)}</span>
                <span class="block text-[10px] text-slate-500">${isIndependentParent ? 'แปลงอิสระย่อย' : label} · ${status} · รูป ${(feature.images || []).length}</span>
            </button>
            <button type="button" onclick="openSurveyFeatureEditor('${job.id}', '${feature.id}')" class="w-9 h-9 rounded-lg text-blue-600 hover:bg-blue-50" title="แก้ไขรูปวาดนี้" aria-label="แก้ไขรูปวาดนี้"><i class="fa-solid fa-pen"></i></button>
            <button type="button" onclick="deleteSurveyFeatureFromSheet(event, '${job.id}', '${feature.id}')" class="w-9 h-9 rounded-lg text-rose-500 hover:bg-rose-50" title="ลบรูปวาดนี้" aria-label="ลบรูปวาดนี้"><i class="fa-solid fa-trash"></i></button>
        </div>`;
    }).join('');
    if (actions) {
        actions.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2 border-t border-rose-100 px-3 py-2 bg-rose-50/60">
            <label class="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer"><input id="survey-feature-select-all" type="checkbox" class="h-4 w-4 accent-rose-600" onchange="toggleAllSurveyFeatures('${job.id}', this.checked)"> เลือกทั้งหมด</label>
            <div class="flex gap-1.5"><button id="btn-delete-selected-survey-features" type="button" onclick="deleteSelectedSurveyFeatures('${job.id}')" disabled class="rounded-lg bg-rose-100 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-45"><i class="fa-solid fa-trash-can mr-1"></i>ลบที่เลือก</button><button type="button" onclick="deleteSelectedSurveyFeatures('${job.id}', true)" class="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white"><i class="fa-solid fa-trash-can mr-1"></i>ลบทั้งหมด</button></div>
        </div>`;
    }
}

function getSelectedSurveyFeatureIds(jobId) {
    return Array.from(document.querySelectorAll('.survey-feature-select:checked'))
        .filter(input => input.dataset.jobId === jobId)
        .map(input => input.dataset.featureId)
        .filter(Boolean);
}

function updateSurveyFeatureSelectionUi(jobId) {
    const inputs = Array.from(document.querySelectorAll('.survey-feature-select')).filter(input => input.dataset.jobId === jobId);
    const selected = inputs.filter(input => input.checked).length;
    const selectAll = document.getElementById('survey-feature-select-all');
    if (selectAll) {
        selectAll.checked = inputs.length > 0 && selected === inputs.length;
        selectAll.indeterminate = selected > 0 && selected < inputs.length;
    }
    const deleteButton = document.getElementById('btn-delete-selected-survey-features');
    if (deleteButton) deleteButton.disabled = selected === 0;
}

function toggleAllSurveyFeatures(jobId, checked) {
    document.querySelectorAll('.survey-feature-select').forEach(input => {
        if (input.dataset.jobId === jobId) input.checked = checked;
    });
    updateSurveyFeatureSelectionUi(jobId);
}

async function deleteSelectedSurveyFeatures(jobId, deleteAll = false) {
    const job = findJobById(jobId);
    const features = Array.isArray(job?.properties?.survey_features) ? job.properties.survey_features : [];
    const selectedIds = deleteAll ? features.map(feature => feature.id) : getSelectedSurveyFeatureIds(jobId);
    if (!selectedIds.length) return Swal.fire('ยังไม่ได้เลือกรายการ', 'ติ๊กเลือกรูปวาดที่ต้องการลบก่อน', 'info');

    const count = selectedIds.length;
    const confirmed = await Swal.fire({
        title: deleteAll ? 'ลบรูปวาดทั้งหมด?' : `ลบรูปวาดที่เลือก ${count} รายการ?`,
        text: 'รูปวาด ข้อมูลบันทึก และรูปถ่ายของรายการที่เลือกจะถูกลบออกจากแปลงนี้ โดยไม่กระทบขอบเขตแปลงหลัก',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: deleteAll ? 'ลบทั้งหมด' : 'ลบรายการที่เลือก',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#dc2626'
    });
    if (!confirmed.isConfirmed) return;

    try {
        const selectedSet = new Set(selectedIds);
        job.properties.survey_features = features.filter(feature => !selectedSet.has(feature.id));
        if (selectedSet.has(selectedSurveyFeatureId)) selectedSurveyFeatureId = null;
        await saveJobToSupabase(job);
        const refreshed = findJobById(jobId);
        if (refreshed) {
            renderSurveyFeatureList(refreshed);
            openSheetSilently(refreshed);
        }
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: `ลบรูปวาดแล้ว ${count} รายการ`, timer: 1800, showConfirmButton: false });
    } catch (error) {
        console.error('Batch survey feature delete error', error);
        Swal.fire('ลบรูปวาดไม่สำเร็จ', error.message, 'error');
    }
}

function focusSurveyFeature(jobId, featureId, notify = true) {
    const job = findJobById(jobId);
    const feature = job?.properties?.survey_features?.find(item => item.id === featureId);
    if (!feature || !map) return;
    const featureLayer = markersGroup.getLayers().find(layer => layer.surveyFeatureId === featureId || layer.parentJobId === jobId && layer.surveyFeatureId === featureId);
    selectedSurveyFeatureId = featureId;
    if (featureLayer?.bringToFront) featureLayer.bringToFront();
    applySurveyFeatureSelection(featureLayer, true);
    if (featureLayer?.getBounds) {
        const bounds = featureLayer.getBounds();
        if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
    } else if (Number.isFinite(Number(feature.lat)) && Number.isFinite(Number(feature.lng))) {
        map.setView([Number(feature.lat), Number(feature.lng)], Math.max(map.getZoom(), 18));
    }
    if (selectedJobId === jobId) renderSurveyFeatureList(job);
    if (notify) Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'เลือกรูปวาดแล้ว กรอบบนแผนที่จะกระพริบ', timer: 1800, showConfirmButton: false });
}

function applySurveyFeatureSelection(layer, blink = false) {
    const targets = [];
    if (layer) {
        targets.push(layer);
        if (typeof layer.eachLayer === 'function') layer.eachLayer(child => targets.push(child));
    }
    markersGroup?.getLayers?.().forEach(item => {
        if (!item.surveyFeatureId && typeof item.eachLayer === 'function') item.eachLayer(child => targets.push(child));
    });
    targets.forEach(target => {
        const el = target.getElement?.();
        if (!el) return;
        el.classList.remove('survey-feature-selected');
        if (target.surveyFeatureId === selectedSurveyFeatureId && blink) {
            void el.offsetWidth;
            el.classList.add('survey-feature-selected');
        }
    });
}

async function deleteSurveyFeatureFromSheet(event, jobId, featureId) {
    event?.stopPropagation();
    const job = findJobById(jobId);
    if (!job || !Array.isArray(job.properties?.survey_features)) return;
    const confirmed = await Swal.fire({
        title: 'ลบรูปวาดนี้?',
        text: 'การลบจะไม่กระทบขอบเขตของแปลง Base Map',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ลบรูปวาด',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#dc2626'
    });
    if (!confirmed.isConfirmed) return;
    await removeSurveyFeatureFromJob(jobId, featureId);
    const refreshed = findJobById(jobId);
    if (refreshed) {
        renderSurveyFeatureList(refreshed);
        openSheetSilently(refreshed);
    }
}

function markLayerAsBaseMap(layer) {
    const mark = target => {
        target.options.pmIgnore = true;
        if (target.pm && typeof target.pm.disable === 'function') target.pm.disable();
    };
    mark(layer);
    if (typeof layer.eachLayer === 'function') layer.eachLayer(mark);
}

// Leaflet-Geoman supports allowRemoval independently of editing, dragging and
// rotation.  Saved records remain editable, but must never become targets of
// the eraser. Drafts explicitly retain the default removable behaviour.
function setLayerRemovalAllowed(layer, allowed) {
    const apply = target => {
        if (!target) return;
        target.options = target.options || {};
        target.options.allowRemoval = allowed;
        target.pm?.setOptions?.({ allowRemoval: allowed });
    };
    apply(layer);
    if (typeof layer?.eachLayer === 'function') layer.eachLayer(apply);
}

function markLayerAsSurveyDrawing(layer, jobId = null) {
    const mark = target => {
        target.options.pmIgnore = false;
        target.options.interactive = true;
        // Let one native tap bubble to the map while a drawing tool is active.
        // Manually firing map clicks here caused duplicate vertices on mobile.
        target.options.bubblingMouseEvents = true;
        if (L.PM && typeof L.PM.reInitLayer === 'function') L.PM.reInitLayer(target);
        if (typeof target.bringToFront === 'function') target.bringToFront();
    };
    mark(layer);
    if (typeof layer.eachLayer === 'function') layer.eachLayer(mark);
    const job = jobId ? findJobById(jobId) : null;
    // A standalone draft is registered immediately after this function. Use
    // its stable drawn_temp_ id as well, otherwise it would be mistaken for a
    // saved layer during those few lines and the eraser would be locked.
    const isTemporaryDrawing = job?.properties?.is_temp === true || String(jobId || '').startsWith('drawn_temp_');
    setLayerRemovalAllowed(layer, isTemporaryDrawing);
    // A standalone drawing is a Base Plot of its own.  It needs the Geoman
    // change handlers as well, otherwise Edit Layer only changes the temporary
    // map layer and the next render restores the old geometry from Supabase.
    if (jobId) bindGeomanEvents(layer, jobId);
}

// A Leaflet CircleMarker lives in the vector pane.  During zoom animation that
// pane is scaled as one surface, which makes a saved Point appear to grow and
// cover nearby map details.  A regular marker is re-positioned independently
// by Leaflet, so this visual point remains the same screen size at every zoom.
function createFixedSurveyPointMarker(latlng, color, fillOpacity = 0.9) {
    const pointColor = normalizeSurveyLayerColor(color);
    return L.marker(latlng, {
        icon: L.divIcon({
            className: 'survey-point-leaflet-icon',
            html: `<span class="survey-point-pin" style="--survey-point-color:${pointColor};--survey-point-opacity:${Math.max(0.35, Math.min(1, Number(fillOpacity) || 0.9))}"></span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            popupAnchor: [0, -11]
        }),
        pmIgnore: false,
        keyboard: true
    });
}

function createSurveyFeatureLayer(job, feature) {
    const isSurveyed = feature.status === 'done' || job.status === 'done';
    const completedColor = normalizeSurveyLayerColor(feature.layer_color || job.properties?.form_layer_color || getSurveyLayerColorForShape(feature.shape));
    const style = isSurveyed
        ? { color: completedColor, fillColor: completedColor, weight: 3, fillOpacity: 0.38, pmIgnore: false }
        : { color: '#dc2626', fillColor: '#ef4444', weight: 3, fillOpacity: 0.34, pmIgnore: false };
    let layer;
    if (feature.shape === 'Circle') {
        layer = L.circle([feature.lat, feature.lng], { ...style, radius: Number(feature.radius) || 1 });
    } else if (feature.shape === 'Marker') {
        layer = createFixedSurveyPointMarker([feature.lat, feature.lng], style.fillColor, 0.9);
    } else if (feature.geometry) {
        layer = L.geoJSON(feature.geometry, { pmIgnore: false, style: () => style });
    }
    if (!layer) return null;

    const bind = target => {
        target.options.pmIgnore = false;
        // Child survey drawings are already saved in their parent's record.
        // Keep Edit Layer available, but reserve deletion for the record list.
        target.options.allowRemoval = false;
        target.pm?.setOptions?.({ allowRemoval: false });
        target.surveyFeatureId = feature.id;
        target.parentJobId = job.id;
        // Re-open the same measurement overlay when a saved child drawing
        // enters Edit Layer.  It refreshes while vertices are moved, before
        // the geometry is persisted on pm:edit.
        target.on('pm:enable', () => showEditablePolygonMeasurements(target));
        target.on('pm:change pm:vertexadded pm:vertexremoved', () => showEditablePolygonMeasurements(target));
        target.on('pm:edit pm:dragend pm:rotateend', () => {
            updateSurveyFeatureFromLayer(job.id, feature.id, target);
        });
        target.on('click', event => {
            if (isMapDrawingInteractionActive()) return;

            // Survey drawings sit above their Base Map plot. Mark this as a layer
            // click so the map click handler consumes it instead of closing the
            // sheet that is opened for the parent plot.
            markerJustClicked = true;
            focusSurveyFeature(job.id, feature.id);
        });
    };
    bind(layer);
    if (typeof layer.eachLayer === 'function') layer.eachLayer(bind);
    const parentLabel = job.properties?.is_custom_draw === true ? 'รายการย่อยในแปลงอิสระ' : 'รูปวาดในแปลง';
    layer.bindTooltip(`${parentLabel}: ${job.properties?.name || job.id}`, { direction: 'top' });
    if (feature.id === selectedSurveyFeatureId) setTimeout(() => applySurveyFeatureSelection(layer, true), 0);
    return layer;
}

function findJobContainingUser() {
    if (!userMarker) return null;
    const latlng = userMarker.getLatLng();
    const activeJobs = getFilteredJobs();
    for (let i = 0; i < activeJobs.length; i++) {
        if (isLatLngInJob(latlng, activeJobs[i])) {
            return activeJobs[i];
        }
    }
    for (let i = 0; i < dbJobs.length; i++) {
        if (isLatLngInJob(latlng, dbJobs[i])) {
            return dbJobs[i];
        }
    }
    return null;
}

async function handleDrivingVoiceCommand(cleanTranscript) {
    const wantsCancelNavigation = voiceHasAny(cleanTranscript, ['ยกเลิกนำทาง', 'ยกเลิกการนำทาง', 'หยุดนำทาง', 'หยุดเส้นทาง', 'ไม่ไปแล้ว', 'cancelnavigation', 'stopnavigation']);
    if (wantsCancelNavigation) {
        if (isNavigating) {
            await stopNav();
            speak('ยกเลิกการนำทางแล้ว', true);
        } else {
            speak('ขณะนี้ไม่มีการนำทาง', true);
        }
        return;
    }

    if (isNavigationQuestion(cleanTranscript)) {
        answerNavigationQuestion(cleanTranscript, true);
        return;
    }

    if (isLatestNavigationCommand(cleanTranscript)) {
        await startLatestNavigationByVoice();
        return;
    }

    const followLocation = getVoiceLocationFollowRequest(cleanTranscript);
    if (followLocation !== null) {
        setLocationFollowByVoice(followLocation);
        return;
    }

    const wantsStartNavigation = /^(?:เริ่ม)?(?:นำทาง|เดินทาง)(?:ต่อ)?$/.test(cleanTranscript) || cleanTranscript === 'ไปเลย' || cleanTranscript === 'เริ่มเส้นทาง';
    if (wantsStartNavigation) {
        await startNavigationToCurrentVoiceTarget();
        return;
    }

    const searchCommand = extractVoiceSearchCommand(cleanTranscript);
    if (searchCommand) {
        if (searchCommand.mode !== 'map') {
            speak('ขณะขับขี่ ค้นหาได้เฉพาะสถานที่ พูดว่า ค้นหาสถานที่ ตามด้วยชื่อสถานที่', true);
            return;
        }
        await startVoiceSearch(cleanTranscript, { readResults: true });
        return;
    }

    const wantsReadResults = cleanTranscript.includes('อ่าน') && cleanTranscript.includes('รายการ');
    if (wantsReadResults) {
        readSearchResultsByVoice(parseThaiResultNumber(cleanTranscript, 'read') || 3);
        return;
    }

    const wantsSelectResult = /^(?:เลือก|รายการที่|ลำดับที่)/.test(cleanTranscript);
    if (wantsSelectResult) {
        const itemNumber = parseThaiResultNumber(cleanTranscript);
        if (!itemNumber) {
            speak('กรุณาพูดว่า เลือกรายการที่ ตามด้วยหมายเลข และคำว่า เดินทาง', true);
            return;
        }
        if (!cleanTranscript.includes('เดินทาง')) {
            speak(`ต้องการไปยังรายการที่ ${itemNumber} ให้พูดว่า เลือกรายการที่ ${itemNumber} เดินทาง`, true);
            return;
        }
        await selectSearchResultByVoice(itemNumber, true);
        return;
    }

    const wantsMode = cleanTranscript.includes('โหมดอะไร') || cleanTranscript.includes('สถานะการขับขี่') || cleanTranscript.includes('ความเร็ว');
    if (wantsMode) {
        speak(`โหมดขับขี่ปลอดภัย ความเร็วประมาณ ${Math.round(currentSpeedKmh)} กิโลเมตรต่อชั่วโมง`, true);
        return;
    }

    const now = Date.now();
    if (now - lastDrivingSafetyReminder > 15000) {
        lastDrivingSafetyReminder = now;
        speak('ขณะขับขี่ พูดว่า ค้นหาสถานที่ ตามด้วยชื่อสถานที่, อ่าน 3 รายการ, เลือกรายการที่ 1 เดินทาง, เหลือกี่กิโล, หรือยกเลิกนำทาง', true);
    }
}

function normalizeVoiceText(text) {
    return String(text || '')
        .toLocaleLowerCase('th')
        .replace(/[.,!?;:ๆฯ]/g, '')
        .replace(/กิโลเมตร/g, 'กิโล')
        .replace(/เท่าไหร่/g, 'เท่าไร')
        .replace(/\s+/g, '');
}

function voiceHasAny(text, phrases) {
    return phrases.some(phrase => text.includes(normalizeVoiceText(phrase)));
}

function getNavigationTarget() {
    if (activeNavigationTarget) return activeNavigationTarget;
    // In place-search mode, the selected search marker is the user's most
    // recent destination. Do not fall back to a previously selected plot.
    const searchMode = document.getElementById('search-mode')?.value;
    if (searchMode === 'map') return manualTravelTarget || placeSearchPreviewTarget || null;
    const job = findJobById(selectedJobId || lastSelectedJobId);
    if (job) return { lat: job.lat, lng: job.lng, name: job.properties?.name || 'แปลงที่เลือก', type: 'plot', jobId: job.id };
    return manualTravelTarget || placeSearchPreviewTarget;
}

async function startNavigationToCurrentVoiceTarget() {
    const target = getNavigationTarget();
    if (!target) {
        speak('ยังไม่มีจุดหมาย กรุณาเลือกรายการหรือค้นหาสถานที่ก่อน', true);
        return;
    }
    speak(`เริ่มนำทางไปยัง ${target.name || 'จุดหมายที่เลือก'}`, true);
    await startNavigationToPoint(target);
}

async function startLatestNavigationByVoice() {
    if (isNavigating && activeNavigationTarget) {
        speak(`กำลังนำทางไปยัง ${activeNavigationTarget.name || 'จุดหมายปัจจุบัน'} อยู่แล้ว`, true);
        return;
    }
    if (!lastNavigationTarget) {
        speak('ยังไม่มีประวัติการนำทาง', true);
        return;
    }
    speak(`เริ่มนำทางล่าสุดไปยัง ${lastNavigationTarget.name || 'จุดหมายล่าสุด'}`, true);
    if (lastNavigationTarget.type === 'plot' && findJobById(lastNavigationTarget.jobId)) {
        selectedJobId = lastNavigationTarget.jobId;
        await startNav();
        return;
    }
    await startNavigationToPoint(lastNavigationTarget);
}

function isLatestNavigationCommand(text) {
    return voiceHasAny(text, ['การนำทางล่าสุด', 'นำทางล่าสุด', 'เส้นทางล่าสุด', 'ไปที่ล่าสุด', 'กลับไปที่ล่าสุด', 'ไปจุดหมายล่าสุด']);
}

function getVoiceLocationFollowRequest(text) {
    if (voiceHasAny(text, ['หยุดติดตามตำแหน่ง', 'ปิดติดตามตำแหน่ง', 'หยุดตามตำแหน่ง', 'ปิดตามตำแหน่ง'])) return false;
    if (voiceHasAny(text, ['ติดตามตำแหน่ง', 'ตามตำแหน่ง', 'ติดตามจีพีเอส', 'ตามจีพีเอส', 'ตามฉัน', 'ตามตำแหน่งฉัน'])) return true;
    return null;
}

function setLocationFollowByVoice(enabled) {
    if (isFollowing !== enabled) toggleGPSFollow(enabled);
    speak(enabled ? 'เปิดติดตามตำแหน่งแล้ว' : 'หยุดติดตามตำแหน่งแล้ว', true);
}

function getActiveSearchResults() {
    const mode = document.getElementById('search-mode')?.value || 'data';
    return mode === 'map' ? (window.currentPlaceSearchResults || []) : getFilteredJobs();
}

function getSearchResultName(result, mode) {
    if (mode === 'map') return result?.name || result?.address || result?.secondaryText || 'สถานที่';
    return result?.properties?.name || '(ไม่มีชื่อแปลง)';
}

function parseThaiResultNumber(text, action = 'select') {
    const words = [
        ['ยี่สิบ', 20], ['สิบเก้า', 19], ['สิบแปด', 18], ['สิบเจ็ด', 17], ['สิบหก', 16],
        ['สิบห้า', 15], ['สิบสี่', 14], ['สิบสาม', 13], ['สิบสอง', 12], ['สิบเอ็ด', 11], ['สิบ', 10], ['เก้า', 9], ['แปด', 8], ['เจ็ด', 7], ['หก', 6],
        ['ห้า', 5], ['สี่', 4], ['สาม', 3], ['สอง', 2], ['หนึ่ง', 1]
    ];
    const prefix = action === 'read' ? 'อ่าน(?:ให้)?' : '(?:เลือก|เลือกรายการ|รายการ|ลำดับ)';
    const digitMatch = text.match(new RegExp(`${prefix}(?:รายการ|ลำดับ|ที่)?(\\d+)(?:รายการ)?`));
    if (digitMatch) return Number(digitMatch[1]);
    for (const [word, number] of words) {
        if (new RegExp(`${prefix}(?:รายการ|ลำดับ|ที่)?${word}(?:รายการ)?`).test(text)) return number;
    }
    return null;
}

function readSearchResultsByVoice(count) {
    const mode = document.getElementById('search-mode')?.value || 'data';
    const results = getActiveSearchResults();
    if (!results.length) return speak('ยังไม่มีผลการค้นหา กรุณาค้นหาก่อน');
    const numberToRead = Math.min(Math.max(1, count || 3), results.length);
    const items = results.slice(0, numberToRead).map((result, index) =>
        `รายการที่ ${index + 1} ${getSearchResultName(result, mode)}`
    );
    speak(`พบ ${results.length} รายการ ${items.join(' , ')}`, true);
}

async function selectSearchResultByVoice(number, navigate = false) {
    const mode = document.getElementById('search-mode')?.value || 'data';
    const results = getActiveSearchResults();
    const index = number - 1;
    if (!Number.isInteger(index) || index < 0 || index >= results.length) {
        return speak(`ไม่พบรายการที่ ${number} ในผลการค้นหา`);
    }

    if (mode === 'map') {
        await selectPlaceSearchResult(index);
        const place = window.currentPlaceSearchResults?.[index];
        if (!navigate) return speak(`เลือก ${getSearchResultName(place, mode)} แล้ว พูดว่า นำทาง เพื่อเริ่มเส้นทาง หรือแตะหมุดเพื่อปักหมุด`);
        if (!Number.isFinite(Number(place?.lat)) || !Number.isFinite(Number(place?.lng))) {
            return speak('ไม่พบพิกัดสำหรับนำทาง');
        }
        speak(`เริ่มนำทางไปยัง ${getSearchResultName(place, mode)}`);
        return startNavigationToPoint({ ...place, type: 'place' });
    }

    const job = results[index];
    selectedJobId = job.id;
    openSheet(job);
    document.getElementById('search-results')?.classList.remove('active');
    if (!navigate) return speak(`เลือกรายการที่ ${number} ${getSearchResultName(job, mode)}`);
    speak(`เดินทางไปยังรายการที่ ${number}`);
    return startNav();
}

function formatSpokenDistance(distance) {
    if (!Number.isFinite(distance)) return '';
    return distance >= 1000
        ? `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)} กิโลเมตร`
        : `${Math.max(0, Math.round(distance))} เมตร`;
}

function isNavigationQuestion(text) {
    return voiceHasAny(text, [
        'เหลือกี่กิโล', 'เหลืออีกกี่กิโล', 'อีกกี่กิโล', 'ระยะทางเท่าไร', 'เหลืออีกเท่าไร',
        'ไกลแค่ไหน', 'ถึงหรือยัง', 'อีกนานไหม', 'ไปที่ไหน', 'กำลังไปไหน', 'เป้าหมายคืออะไร',
        'จุดหมายคืออะไร', 'เส้นทางเป็นยังไง', 'สถานะการนำทาง', 'บอกเส้นทาง'
    ]);
}

function answerNavigationQuestion(text, force = false) {
    const target = getNavigationTarget();
    if (!target) {
        speak('ยังไม่มีเป้าหมาย กรุณาเลือกแปลง ค้นหาสถานที่ หรือแตะแผนที่สองครั้งเพื่อปักหมุด', force);
        return;
    }
    const asksTarget = voiceHasAny(text, ['ไปที่ไหน', 'กำลังไปไหน', 'เป้าหมาย', 'จุดหมาย', 'บอกเส้นทาง']);
    let distance = null;
    if (userMarker && map) distance = map.distance(userMarker.getLatLng(), [target.lat, target.lng]);
    else if (activeRouteSummary?.totalDistance && isNavigating) distance = activeRouteSummary.totalDistance;
    const distanceText = Number.isFinite(distance) ? ` เหลือประมาณ ${formatSpokenDistance(distance)}` : '';
    let etaText = '';
    if (activeRouteSummary?.totalTime && isNavigating) {
        const initialDistance = Number(activeNavigationTarget?.initialDistance) || distance;
        const remainingRatio = Number.isFinite(distance) && initialDistance > 0 ? Math.min(1, distance / initialDistance) : 1;
        const minutes = Math.max(1, Math.round((activeRouteSummary.totalTime * remainingRatio) / 60));
        etaText = ` ใช้เวลาประมาณ ${minutes} นาที`;
    }
    const prefix = asksTarget ? `เป้าหมายคือ ${target.name}` : `เส้นทางไป ${target.name}`;
    speak(`${prefix}${distanceText}${etaText}`, force);
}

function extractVoiceSearchCommand(transcript) {
    const spoken = String(transcript || '').trim();
    if (/รายการที่|แปลงถัดไป|จุดถัดไป/.test(spoken)) return null;

    const dataMatch = spoken.match(/^(?:ช่วย)?ค้นหาข้อมูลแปลง(?:ที่ดิน)?\s*(.*)$/i);
    if (dataMatch) return { mode: 'data', query: dataMatch[1].trim(), label: 'ข้อมูลแปลง' };

    const placeMatch = spoken.match(/^(?:ช่วย)?ค้นหาสถานที่\s*(.*)$/i);
    if (placeMatch) return { mode: 'map', query: placeMatch[1].trim(), label: 'สถานที่' };

    const mapMatch = spoken.match(/^(?:ช่วย)?(?:ค้นหาในแผนที่|หาร้าน|หาสถานที่|หาเส้นทางไป|นำทางไป|พาไป)\s*(.+)$/i);
    return mapMatch?.[1]?.trim() ? { mode: 'map', query: mapMatch[1].trim(), label: 'สถานที่' } : null;
}

async function startVoiceSearch(transcript, { readResults = false } = {}) {
    const command = extractVoiceSearchCommand(transcript);
    if (!command) return false;
    const mode = document.getElementById('search-mode');
    const input = document.getElementById('inp-search');
    if (!mode || !input) return false;
    mode.value = command.mode;
    onSearchModeChange(true);
    input.value = command.query;
    input.focus();
    if (!command.query) {
        speak(`พร้อมค้นหา${command.label} กรุณาพูดคำที่ต้องการค้นหา`);
        return true;
    }
    await doSearch();
    if (readResults) {
        speak(`ค้นหา${command.label} ${command.query} แล้ว`, true);
        readSearchResultsByVoice(3);
    } else {
        speak(`ค้นหา${command.label} ${command.query} แล้ว เลือกรายการที่ต้องการบนหน้าจอ`);
    }
    return true;
}

async function handleVoiceCommand(transcript) {
    const cleanTranscript = normalizeVoiceText(transcript);

    const isUnmute = cleanTranscript.includes("unmutemic") || cleanTranscript.includes("unmutevoice") || cleanTranscript.includes("เปิดไมค์") || cleanTranscript.includes("เปิดไม");
    if (isVoiceMuted) {
        if (isUnmute) {
            isVoiceMuted = false;
            updateVoiceControlUI(true);
            speak("เปิดไมค์");
        }
        return;
    }

    const isMute = !cleanTranscript.includes("เปิด") && !cleanTranscript.includes("open") && (
                   cleanTranscript.includes("mutemic") || cleanTranscript.includes("mutevoice") || cleanTranscript.includes("standbyvoice") || cleanTranscript.includes("ปิดไมค์") || cleanTranscript.includes("ปิดไม")
    );
    if (isMute) {
        isVoiceMuted = true;
        updateVoiceControlUI('muted');
        speak("ปิดไมค์");
        return;
    }

    if (isNavigationQuestion(cleanTranscript)) {
        answerNavigationQuestion(cleanTranscript, true);
        return;
    }

    if (isLatestNavigationCommand(cleanTranscript)) {
        await startLatestNavigationByVoice();
        return;
    }

    const followLocation = getVoiceLocationFollowRequest(cleanTranscript);
    if (followLocation !== null) {
        setLocationFollowByVoice(followLocation);
        return;
    }

    if (voiceOperationMode === 'driving') {
        await handleDrivingVoiceCommand(cleanTranscript);
        return;
    }

    if (await startVoiceSearch(transcript)) return;

    if (window.Swal && Swal.isVisible()) {
        const isStopReading = cleanTranscript.includes("หยุดอ่าน") || cleanTranscript.includes("หยุดพูด") || (cleanTranscript === "หยุด" && document.getElementById('swal-raw-data-container'));
        if (isStopReading) {
            stopReadingSequence();
            speak("หยุดอ่าน", true);
            return;
        }

        const isReadDetails = cleanTranscript.includes("อ่านรายละเอียด") || cleanTranscript.includes("อ่านข้อมูลดิบ") || cleanTranscript.includes("อ่านข้อมูล") || cleanTranscript.includes("อ่านตาราง") || cleanTranscript.includes("อ่านทั้งหมด");
        const isReadLine = cleanTranscript.includes("อ่านบรรทัดที่") || cleanTranscript.includes("อ่านตั้งแต่บรรทัดที่");

        if (isReadDetails || isReadLine) {
            const job = findJobById(selectedJobId || lastSelectedJobId);
            if (job) {
                const container = document.getElementById('swal-raw-data-container');
                if (container) {
                    const rows = Object.keys(job.properties).sort().map(key => {
                        const value = typeof job.properties[key] === 'object' ? JSON.stringify(job.properties[key]) : job.properties[key];
                        return { key, value: value !== undefined && value !== null ? value : '-' };
                    });

                    if (rows.length > 0) {
                        let startLine = 1;
                        let countLines = rows.length;

                        if (isReadLine) {
                            const lineIdx = cleanTranscript.indexOf("บรรทัดที่");
                            if (lineIdx !== -1) {
                                const afterLine = cleanTranscript.substring(lineIdx + "บรรทัดที่".length);
                                const parsedStart = parseNumber(afterLine);
                                if (parsedStart !== null) {
                                    startLine = parsedStart;
                                }
                            }

                            const toIdx = cleanTranscript.indexOf("ถึง");
                            if (toIdx !== -1) {
                                const afterTo = cleanTranscript.substring(toIdx + "ถึง".length);
                                const endLine = parseNumber(afterTo);
                                if (endLine !== null && endLine >= startLine) {
                                    countLines = endLine - startLine + 1;
                                }
                            } else {
                                const countIdx = cleanTranscript.indexOf("จำนวน");
                                if (countIdx !== -1) {
                                    const afterCount = cleanTranscript.substring(countIdx + "จำนวน".length);
                                    const parsedCount = parseNumber(afterCount);
                                    if (parsedCount !== null) {
                                        countLines = parsedCount;
                                    }
                                } else {
                                    if (cleanTranscript.includes("อ่านตั้งแต่")) {
                                        countLines = rows.length - startLine + 1;
                                    } else {
                                        countLines = 1;
                                    }
                                }
                            }
                        }

                        if (startLine < 1 || startLine > rows.length) {
                            speak(`ไม่มีบรรทัดที่ ${startLine}`, true);
                            return;
                        }

                        countLines = Math.min(countLines, rows.length - startLine + 1);
                        if (countLines <= 0) {
                            speak("จำนวนบรรทัดไม่ถูกต้อง", true);
                            return;
                        }

                        startReadingSequence(rows, startLine, countLines);
                    } else {
                        speak("ไม่มีข้อมูลให้อ่าน", true);
                    }
                }
            }
            return;
        }

        const isScrollDown = cleanTranscript.includes("เลื่อนลง") || (cleanTranscript.includes("ลง") && !cleanTranscript.includes("ตกลง")) || cleanTranscript.includes("scrolldown");
        const isScrollUp = cleanTranscript.includes("เลื่อนขึ้น") || cleanTranscript.includes("ขึ้น") || cleanTranscript.includes("scrollup");
        if (isScrollDown) {
            const container = document.getElementById('swal-raw-data-container');
            if (container) {
                container.scrollBy({ top: 200, behavior: 'smooth' });
                speak("เลื่อนลง");
                return;
            }
        } else if (isScrollUp) {
            const container = document.getElementById('swal-raw-data-container');
            if (container) {
                container.scrollBy({ top: -200, behavior: 'smooth' });
                speak("เลื่อนขึ้น");
                return;
            }
        }

        const isConfirm = cleanTranscript.includes("ตกลง") || cleanTranscript.includes("ยืนยัน") || cleanTranscript.includes("เอาเลย") || cleanTranscript.includes("ลบเลย") || cleanTranscript.includes("ใช่") || cleanTranscript.includes("ok") || cleanTranscript.includes("confirm");
        const isCancel = cleanTranscript.includes("ยกเลิก") || cleanTranscript.includes("ไม่ลบ") || cleanTranscript.includes("ไม่") || cleanTranscript.includes("cancel") || cleanTranscript.includes("close") || cleanTranscript.includes("ปิด");
        if (isConfirm) {
            Swal.clickConfirm();
            speak("ตกลง");
        } else if (isCancel) {
            Swal.clickCancel();
            speak("ยกเลิก");
        }
        return;
    }

    const isSave = cleanTranscript.includes("savesurvey") || cleanTranscript.includes("เซฟเซอร์เวย์") || cleanTranscript.includes("เซฟเซอเวย์") || cleanTranscript.includes("บันทึกข้อมูล") || 
                   (cleanTranscript.includes("บันทึก") && !cleanTranscript.includes("เปิดบันทึก") && !cleanTranscript.includes("เปิดกล่องบันทึก") && !cleanTranscript.includes("เปิดแบบฟอร์ม") && !cleanTranscript.includes("ปิดบันทึก") && !cleanTranscript.includes("ปิดกล่องบันทึก") && !cleanTranscript.includes("ลบบันทึก") && !cleanTranscript.includes("ลบการบันทึก"));

    const isNext = cleanTranscript.includes("nextpoint") || cleanTranscript.includes("nexpoint") || cleanTranscript.includes("แปลงถัดไป") || cleanTranscript.includes("จุดถัดไป") || cleanTranscript.includes("เน็กพอยต์") || cleanTranscript.includes("เน็กซ์พอยต์");
    const isCancelNav = cleanTranscript.includes("cancelnavigation") || cleanTranscript.includes("stopnavigation") || cleanTranscript.includes("cancelroute") || cleanTranscript.includes("ยกเลิกการนำทาง") || cleanTranscript.includes("ยกเลิกนำทาง") || cleanTranscript.includes("หยุดนำทาง");
    const isDeleteSurvey = cleanTranscript.includes("deletesurvey") || cleanTranscript.includes("deleterecord") || cleanTranscript.includes("ลบการบันทึก") || cleanTranscript.includes("ลบบันทึก") || cleanTranscript.includes("ลบข้อมูลสำรวจ");

    const isShowLabels = cleanTranscript.includes("showlabel") || cleanTranscript.includes("showlabels") || cleanTranscript.includes("openlabel") || cleanTranscript.includes("openlabels") || cleanTranscript.includes("turnonlabel") || cleanTranscript.includes("turnonlabels") || cleanTranscript.includes("เปิดป้ายชื่อ") || cleanTranscript.includes("แสดงป้ายชื่อ") || cleanTranscript.includes("เปิดป้าย") || cleanTranscript.includes("แสดงป้าย");
    const isHideLabels = !cleanTranscript.includes("เปิด") && !cleanTranscript.includes("open") && (cleanTranscript.includes("hidelabel") || cleanTranscript.includes("hidelabels") || cleanTranscript.includes("closelabel") || cleanTranscript.includes("closelabels") || cleanTranscript.includes("turnofflabel") || cleanTranscript.includes("turnofflabels") || cleanTranscript.includes("ปิดป้ายชื่อ") || cleanTranscript.includes("ซ่อนป้ายชื่อ") || cleanTranscript.includes("ปิดป้าย") || cleanTranscript.includes("ซ่อนป้าย"));

    const isShowPlot = cleanTranscript.includes("showplot") || cleanTranscript.includes("showplots") || cleanTranscript.includes("showboundary") || cleanTranscript.includes("showboundaries") || cleanTranscript.includes("plotmode") || cleanTranscript.includes("แสดงรูปแปลง") || cleanTranscript.includes("แสดงขอบเขตแปลง") || cleanTranscript.includes("แสดงแปลง") || cleanTranscript.includes("โหมดแปลง");
    const isShowPin = cleanTranscript.includes("showpin") || cleanTranscript.includes("showpins") || cleanTranscript.includes("showmarker") || cleanTranscript.includes("showmarkers") || cleanTranscript.includes("pinmode") || cleanTranscript.includes("แสดงหมุด") || cleanTranscript.includes("โหมดหมุด") || cleanTranscript.includes("ปักหมุด") || cleanTranscript.includes("สั่งแสดงหมุด") || cleanTranscript.includes("แสดงหมุดแผนที่");
    const isToggleBaseMap = cleanTranscript.includes("switchmap") || cleanTranscript.includes("changemap") || cleanTranscript.includes("togglemap") || cleanTranscript.includes("switchbasemap") || cleanTranscript.includes("togglebasemap") || cleanTranscript.includes("สลับแผนที่") || cleanTranscript.includes("เปลี่ยนแผนที่") || cleanTranscript.includes("สลับแผนที่ฐาน") || cleanTranscript.includes("เปลี่ยนแผนที่ฐาน");
    const isShowDetails = cleanTranscript.includes("showdetail") || cleanTranscript.includes("showdetails") || cleanTranscript.includes("opendetail") || cleanTranscript.includes("opendetails") || cleanTranscript.includes("ขอดูรายละเอียด") || cleanTranscript.includes("ของดูรายละเอียด") || cleanTranscript.includes("ดูรายละเอียด");

    const isClearNote = cleanTranscript.includes("clearnote") || cleanTranscript.includes("clearnotes") || cleanTranscript.includes("clearalltext") || cleanTranscript.includes("cleartext") || cleanTranscript.includes("ลบข้อความทั้งหมด") || cleanTranscript.includes("ลบหมายเหตุทั้งหมด") || cleanTranscript.includes("ลบข้อความ") || cleanTranscript.includes("ลบหมายเหตุ") || cleanTranscript.includes("ลบทั้งหมด") || cleanTranscript.includes("ล้างข้อความทั้งหมด") || cleanTranscript.includes("ล้างข้อความ") || cleanTranscript.includes("เคลียร์ข้อความทั้งหมด") || cleanTranscript.includes("เคลียร์ข้อความ") || cleanTranscript.includes("เคลียร์โน้ต") || cleanTranscript.includes("ลบโน้ต");
    const isCloseSheet = !cleanTranscript.includes("เปิด") && !cleanTranscript.includes("open") && (cleanTranscript.includes("closesheet") || cleanTranscript.includes("closedetails") || cleanTranscript.includes("closedetail") || cleanTranscript.includes("closebox") || cleanTranscript.includes("closewindow") || cleanTranscript.includes("cancel") || cleanTranscript.includes("ปิดบันทึก") || cleanTranscript.includes("ปิดกล่องบันทึก") || cleanTranscript.includes("ปิดกล่อง") || cleanTranscript.includes("ปิดรายละเอียด") || cleanTranscript.includes("ปิดหน้าต่าง") || cleanTranscript.includes("ยกเลิกบันทึก") || cleanTranscript.includes("ยกเลิกรายละเอียด") || (cleanTranscript.includes("ปิด") && !cleanTranscript.includes("ปิดป้ายชื่อ") && !cleanTranscript.includes("ปิดป้าย") && !cleanTranscript.includes("ปิดระบบ")) || (cleanTranscript.includes("ยกเลิก") && !cleanTranscript.includes("ยกเลิกการนำทาง") && !cleanTranscript.includes("ยกเลิกนำทาง")));
    const isFocusSearch = !cleanTranscript.includes("ลบ") && !cleanTranscript.includes("ล้าง") && (cleanTranscript.includes("ค้นหา") || cleanTranscript.includes("ช่องค้นหา") || cleanTranscript.includes("เปิดค้นหา") || cleanTranscript.includes("search"));
    const isReadSearchItems = cleanTranscript.includes("อ่าน") && cleanTranscript.includes("รายการ");
    const isSelectSearchItem = !isReadSearchItems && (cleanTranscript.includes("เลือกรายการ") || cleanTranscript.includes("รายการที่") || cleanTranscript.includes("ลำดับที่"));
    const isNavigateSearchItem = isSelectSearchItem && cleanTranscript.includes("เดินทาง");
    const isStartNavigation = /^(?:เริ่ม)?(?:นำทาง|เดินทาง)(?:ต่อ)?$/.test(cleanTranscript) || cleanTranscript === 'ไปเลย' || cleanTranscript === 'เริ่มเส้นทาง';

    const isSurvey = !isSave && !isNext && !isCancelNav && !isDeleteSurvey && !isShowLabels && !isHideLabels && !isShowPlot && !isShowPin && !isToggleBaseMap && !isShowDetails && !isClearNote && !isCloseSheet && !isFocusSearch && !isReadSearchItems && !isSelectSearchItem && !isStartNavigation && (cleanTranscript.includes("survey") || cleanTranscript.includes("สำรวจ") || cleanTranscript.includes("เปิดบันทึก") || cleanTranscript.includes("เปิดกล่องบันทึก") || cleanTranscript.includes("เปิดแบบฟอร์ม") || cleanTranscript.includes("เซอร์เวย์") || cleanTranscript.includes("เซอเวย์") || cleanTranscript.includes("เสวย"));

    if (isSurvey) {
        let job = null;
        if (isNavigating) {
            job = findJobById(selectedJobId);
        } else {
            if (userMarker) {
                job = findJobContainingUser();
            }
            if (!job) {
                job = findJobById(selectedJobId);
            } else {
                if (selectedJobId !== job.id) {
                    openSheet(job);
                }
            }
        }

        if (job) {
            openSheet(job);
            const sheet = document.getElementById('sheet');
            if (sheet) { sheet.classList.remove('minimized'); sheet.classList.add('active'); }
            const noteInput = document.getElementById('sheet-note');
            if (noteInput?.disabled) enableEdit();
            focusVoiceNoteField();
            window.setTimeout(focusVoiceNoteField, 260);
            speak("เปิดกล่องบันทึกข้อมูล พร้อมบันทึกหมายเหตุ");
        } else {
            speak("กรุณาเลือกแปลงที่ดินก่อน");
        }
    } else if (isSave) {
        const job = findJobById(selectedJobId);
        if (job) {
            const btnSave = document.getElementById('btn-save');
            if (btnSave && !btnSave.classList.contains('hidden')) { speak("บันทึกข้อมูลเรียบร้อย"); saveData(); } else speak("ไม่สามารถบันทึกได้ในโหมดนี้");
        } else {
            speak("ไม่มีข้อมูลให้บันทึก");
        }
    } else if (isCloseSheet) {
        if (selectedJobId) { speak("ปิดกล่องบันทึกข้อมูล"); closeSheet(); } else speak("ไม่มีกล่องบันทึกเปิดอยู่");
    } else if (isNext) {
        await routeToNextPoint();
    } else if (isCancelNav) {
        if (isNavigating) { speak("ยกเลิกการนำทางเรียบร้อย"); await stopNav(); } else speak("ไม่ได้อยู่ในโหมดนำทาง");
    } else if (isDeleteSurvey) {
        const job = findJobById(selectedJobId);
        if (job) { speak("เปิดกล่องข้อยืนยันการลบ"); await deleteSurveyData(); } else speak("กรุณาเลือกแปลงที่ดินที่ต้องการลบข้อมูลก่อน");
    } else if (isClearNote) {
        const noteInput = document.getElementById('sheet-note');
        const searchInput = document.getElementById('inp-search');
        if (searchInput && document.activeElement === searchInput) {
            searchInput.value = '';
            doSearch();
            speak("ลบข้อความ");
        } else if (noteInput && !noteInput.disabled) {
            speak("คุณต้องการลบข้อความทั้งหมดใช่หรือไม่");
            const confirm = await Swal.fire({
                title: 'ลบข้อความทั้งหมด?', text: 'คุณต้องการลบข้อความหมายเหตุทั้งหมดใช่หรือไม่?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'ลบทั้งหมด', cancelButtonText: 'ยกเลิก'
            });
            if (confirm.isConfirmed) {
                noteInput.value = '';
                noteInput.dispatchEvent(new Event('input'));
                noteInput.focus();
                speak("ลบข้อความทั้งหมดเรียบร้อย");
            } else { speak("ยกเลิกการลบข้อความ"); }
        } else { speak("ไม่มีกล่องข้อความให้ลบ"); }
    } else if (isShowLabels) {
        if (!showPinLabels) togglePinLabels();
        speak("เปิดป้าย");
    } else if (isHideLabels) {
        if (showPinLabels) togglePinLabels();
        speak("ปิดป้าย");
    } else if (isShowPlot) {
        if (viewMode !== 'original') { viewMode = 'original'; document.getElementById('btn-view').innerHTML = '<i class="fa-solid fa-draw-polygon"></i>'; renderMap(); speak("แสดงขอบเขตแปลงที่ดิน"); } else speak("แสดงขอบเขตแปลงอยู่แล้ว");
    } else if (isShowPin) {
        if (viewMode !== 'pin') { viewMode = 'pin'; document.getElementById('btn-view').innerHTML = '<i class="fa-solid fa-map-pin"></i>'; renderMap(); speak("แสดงหมุด"); } else speak("แสดงหมุดอยู่แล้ว");
    } else if (isToggleBaseMap) {
        toggleBaseMap();
        const mapType = currentBaseMap === 'hybrid' ? 'แผนที่ดาวเทียม' : 'แผนที่ถนน';
        speak("สลับแผนที่ฐานเป็น" + mapType);
    } else if (isShowDetails) {
        const jobId = selectedJobId || lastSelectedJobId;
        const job = findJobById(jobId);
        if (job) {
            selectedJobId = job.id;
            viewJsonData();
            speak("แสดงข้อมูลดิบ");
        } else {
            speak("กรุณาเลือกแปลงที่ดินก่อน");
        }
    } else if (isFocusSearch) {
        const searchInput = document.getElementById('inp-search');
        if (searchInput) { searchInput.focus(); searchInput.select(); speak("ค้นหา"); }
    } else if (isStartNavigation) {
        await startNavigationToCurrentVoiceTarget();
    } else if (isReadSearchItems) {
        readSearchResultsByVoice(parseThaiResultNumber(cleanTranscript, 'read') || 3);
    } else if (isSelectSearchItem) {
        const itemNumber = parseThaiResultNumber(cleanTranscript);
        if (!itemNumber) speak("กรุณาระบุลำดับรายการให้ถูกต้อง");
        else await selectSearchResultByVoice(itemNumber, isNavigateSearchItem);
    } else {
        const noteInput = document.getElementById('sheet-note');
        const searchInput = document.getElementById('inp-search');
        const sheet = document.getElementById('sheet');
        const isSheetActive = sheet && sheet.classList.contains('active') && !sheet.classList.contains('minimized');
        if (searchInput && document.activeElement === searchInput) {
            const startVal = searchInput.value.trim();
            searchInput.value = startVal ? (startVal + " " + transcript) : transcript;
            doSearch();
            speak("ค้นหา " + transcript);
        } else if (noteInput && !noteInput.disabled && (document.activeElement === noteInput || isSheetActive)) {
            const startVal = noteInput.value.trim();
            noteInput.value = startVal ? (startVal + " " + transcript) : transcript;
            noteInput.dispatchEvent(new Event('input'));
            speak("จดบันทึกเรียบร้อย");
        }
    }
}

async function routeToNextPoint() {
    if (!userMarker) {
        speak("จีพีเอสไม่พร้อมใช้งาน");
        return Swal.fire('รอ GPS', '', 'info');
    }
    const filteredJobs = getFilteredJobs().filter(j => j.status !== 'done' && j.status !== 'navigating' && j.id !== selectedJobId);
    if (filteredJobs.length === 0) {
        speak("ไม่มีงานค้างแล้ว");
        return Swal.fire('ยอดเยี่ยม', 'ไม่มีงานค้างในพื้นที่นี้', 'success');
    }
    let min = Infinity, near = null;
    const u = userMarker.getLatLng();
    filteredJobs.forEach(j => {
        const lat = Number(j.lat);
        const lng = Number(j.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
            const d = map.distance(u, L.latLng(lat, lng));
            if (d < min) {
                min = d;
                near = j;
            }
        }
    });
    if (near) {
        selectedJobId = near.id;
        map.setView([near.lat, near.lng], Math.max(map.getZoom(), 16));
        const sheet = document.getElementById('sheet');
        if (sheet) {
            sheet.classList.remove('minimized');
            sheet.classList.add('active');
        }
        renderMap();
        speak("กำลังนำทางไปยังจุดถัดไป");
        startNav();
    }
}

function toggleVoiceControl() {
    if (!recognition) {
        const success = initVoiceRecognition();
        if (!success) {
            Swal.fire('การสั่งการด้วยเสียง', 'ไม่รองรับ Web Speech API ในเบราว์เซอร์นี้', 'error');
            return;
        }
    }

    if (isVoiceActive) {
        isVoiceActive = false;
        isVoiceMuted = false;
        try {
            recognition.stop();
        } catch (e) {}
        speak("ปิดระบบสั่งงานด้วยเสียง");
    } else {
        isVoiceActive = true;
        isVoiceMuted = false;
        try {
            recognition.start();
            speak("เปิดระบบสั่งงานด้วยเสียง");
        } catch (e) {
            console.error("Speech Recognition start error:", e);
            isVoiceActive = false;
        }
    }
}

function updateVoiceControlUI(active) {
    const btn = document.getElementById('btn-voice');
    if (!btn) return;
    if (voiceOperationMode === 'driving' && active) {
        btn.classList.remove('bg-white', 'text-gray-400', 'bg-red-500', 'bg-amber-500', 'animate-pulse', 'border-red-500', 'border-amber-500');
        btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
        btn.innerHTML = '<i class="fa-solid fa-car-side"></i>';
        btn.title = 'โหมดขับขี่ปลอดภัย: รับเฉพาะคำสั่งนำทาง';
    } else if (active === true) {
        btn.classList.remove('bg-blue-600', 'border-blue-600');
        btn.classList.remove('bg-white', 'text-gray-400', 'bg-amber-500', 'border-amber-500');
        btn.classList.add('bg-red-500', 'text-white', 'animate-pulse', 'border-red-500');
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        btn.title = 'โหมดปกติ: เปิดรับคำสั่งเสียงทั้งหมด';
    } else if (active === 'muted') {
        btn.classList.remove('bg-white', 'text-gray-400', 'bg-red-500', 'bg-blue-600', 'animate-pulse', 'border-red-500', 'border-blue-600');
        btn.classList.add('bg-amber-500', 'text-white', 'border-amber-500');
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    } else {
        btn.classList.remove('bg-red-500', 'bg-amber-500', 'bg-blue-600', 'text-white', 'animate-pulse', 'border-red-500', 'border-amber-500', 'border-blue-600');
        btn.classList.add('bg-white', 'text-gray-400');
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    }
}

async function deleteSurveyData() {
    const job = findJobById(selectedJobId);
    if (!job) return;

    const hasImages = job.properties && job.properties.images && job.properties.images.length > 0;

    let htmlContent = `
        <div class="text-sm text-gray-600 text-left space-y-2">
            <p>ระบบจะลบผลการสำรวจ (หมายเหตุ, รูปถ่าย, วันที่) และคืนค่าสถานะแปลงนี้ให้เป็น <b>"รอการตรวจสอบ"</b></p>
            <p class="text-red-500 font-bold">* แปลงที่ดินจะยังคงแสดงอยู่บนแผนที่ตามปกติ</p>
    `;

    if (hasImages) {
        htmlContent += `
            <div class="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-2">
                <input type="checkbox" id="swal-delete-cloud-images" class="w-4 h-4 rounded text-red-650 focus:ring-red-500 cursor-pointer">
                <label for="swal-delete-cloud-images" class="text-xs font-bold text-gray-700 cursor-pointer select-none">
                    ลบรูปภาพทั้งหมด (${job.properties.images.length} รูป) ออกจาก Cloudinary ด้วย
                </label>
            </div>
        `;
    }

    htmlContent += `</div>`;

    const result = await Swal.fire({
        title: 'ลบข้อมูลการสำรวจ?',
        html: htmlContent,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'ยืนยันการลบข้อมูลสำรวจ',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const chk = document.getElementById('swal-delete-cloud-images');
            return {
                deleteFromCloud: chk ? chk.checked : false
            };
        }
    });

    if (result.isConfirmed) {
        const deleteFromCloud = (result.value && result.value.deleteFromCloud) || false;

        justDeletedJobId = job.id;
        selectedJobId = null;
        isMapClickBlocked = true;
        closeSheet();

        showLoading(true, 'กำลังลบผลการสำรวจ...');
        try {
            if (deleteFromCloud && hasImages) {
                await Promise.all(job.properties.images.map(async (img) => {
                    const publicId = img ? (img.public_id || getPublicIdFromUrl(typeof img === 'string' ? img : img.url)) : null;
                    if (publicId) {
                        try {
                            await fetch(GAS_URL + "?publicId=" + encodeURIComponent(publicId), { mode: 'no-cors' });
                        } catch (err) {
                            console.error("ลบ Cloudinary พลาด:", err);
                        }
                    }
                }));
            }

            job.status = 'waiting';
            job.properties.note = '';
            job.properties.date = '';
            job.properties.images = [];

            await saveJobToSupabase(job);
            renderMap();
            showLoading(false);

            await Swal.fire({ toast: true, position: 'top', backdrop: false, icon: 'success', title: 'ลบผลการสำรวจและคืนค่าสถานะแล้ว', timer: 1500, showConfirmButton: false });
        } catch (e) {
            showLoading(false);
            Swal.fire('ทำรายการไม่สำเร็จ', e.message, 'error');
        } finally {
            setTimeout(() => {
                justDeletedJobId = null;
                isMapClickBlocked = false;
            }, 2000);
        }
    }
}

function getFilteredJobs() {
    const search = document.getElementById('inp-search').value.toLowerCase().trim();
    const amphoe = document.getElementById('sel-amphoe').value;
    const tambon = document.getElementById('sel-tambon').value;

    return dbJobs.filter(j => {
        const matchCat = j.category === currentUser.category;
        const p = j.properties || {};
        const txt = search;

        let matchS = txt === "";

        if (!matchS) {
            // =========================================================
            // 🎯 กำหนดจุดค้นหาตรงนี้ (ผมแยกตัวแปรมาให้ดูและแก้ง่ายๆ ครับ)
            // =========================================================

            // 1. ค้นหาจาก ไอดี / ชื่อแปลง (หมวด 0)
            const findName = (p.name || "").toString().toLowerCase().includes(txt);

            // 2. ค้นหาจาก ช่องเชื่อมโยงค้นหา (หมวด 1)
            const findSearchField = (p.search_field || "").toString().toLowerCase().includes(txt);

            // 3. ค้นหาจาก หมายเหตุ (note)
            const findNote = (p.note || "").toString().toLowerCase().includes(txt);

            // ถ้าเจอคำค้นหาในช่องใดช่องหนึ่ง ให้ถือว่าค้นหาเจอ 
            // (ถ้าคุณไม่อยากให้หาในหมายเหตุ ให้ลบ || findNote ออกได้เลยครับ)
            if (findName || findSearchField || findNote) {
                matchS = true;
            }
        }

        const valA = (p.amphoe || p.AMPH_NAME || p.AMPHOE || p.district || "").toString().trim();
        const valT = (p.tambon || p.TUMB_NAME || p.TAMBON || p.subdistrict || "").toString().trim();
        const matchA = amphoe === "" || valA === amphoe;
        const matchT = tambon === "" || valT === tambon;

        // A saved hand-drawn pin/boundary is an active survey result. Keep it
        // visible in its work group even while the Base Map search/filter is
        // narrowed, otherwise it appears to vanish immediately after save.
        const isSavedCustomDrawing = p.is_custom_draw === true && j.status === 'done';
        return matchCat && (isSavedCustomDrawing || (matchS && matchA && matchT));
    });
}

function bindGeomanEvents(layer, jobId) {
    if (!layer) return;

    const bindToSingleLayer = (l) => {
        // จำกัดไม่ให้ทำการหมุนบน Marker และ Circle เพื่อเลี่ยงข้อผิดพลาด
        const isMarker = l instanceof L.Marker || (typeof l.getLatLng === 'function' && typeof l.getBounds !== 'function');
        const isCircle = typeof l.getRadius === 'function';
        if (isMarker || isCircle) {
            if (l.pm) {
                l.pm.setOptions({ allowRotation: false });
            }
        }

        // ดักจับเหตุการณ์การแก้ไข ย้าย และหมุน
        const keepGeometry = () => {
            queueGeomanUpdate(l, jobId);
            showEditedShapeMeasurements(l, jobId);
            scheduleCustomDrawingGeometrySave(jobId);
            showPendingActionsBar();
        };
        // Show dimensions as soon as this saved polygon is selected for
        // editing, then redraw them continuously as its vertices change.
        l.on('pm:enable', () => showEditedShapeMeasurements(l, jobId));
        l.on('pm:change pm:vertexadded pm:vertexremoved', () => showEditedShapeMeasurements(l, jobId));
        l.on('pm:edit pm:dragend pm:rotateend', () => {
            keepGeometry();
        });
        l.on('pm:revert', () => {
            clearTimeout(customDrawingGeometrySaveTimers.get(jobId));
            customDrawingGeometrySaveTimers.delete(jobId);
            dequeueGeomanUpdate(jobId);
            showPendingActionsBar();
        });
    };

    if (typeof layer.eachLayer === 'function') {
        layer.eachLayer(sub => {
            bindToSingleLayer(sub);
        });
    } else {
        bindToSingleLayer(layer);
    }
}

function showEditedShapeMeasurements(layer, jobId) {
    const job = findJobById(jobId);
    if (!job?.properties?.is_custom_draw || typeof layer?.getLatLngs !== 'function') return;
    const drawingShape = job.properties.drawing_shape === 'Rectangle' ? 'Rectangle' : 'Polygon';
    drawingMeasurePinned = true;
    scheduleDrawingMeasurementRender(layer, drawingShape, true);
}

function showEditablePolygonMeasurements(layer) {
    if (typeof layer?.getLatLngs !== 'function') return;
    const points = getDrawingMeasurePoints(layer);
    if (points.length < 3) return;
    pinCompletedDrawingMeasurements(layer, layer instanceof L.Rectangle ? 'Rectangle' : 'Polygon');
}

// --- คิวจัดการเก็บพิกัดที่มีการขยับ/แก้ไขชั่วคราว ---
function queueGeomanUpdate(l, jobId) {
    let lat = 0;
    let lng = 0;
    let geometry = {};
    let isCircle = false;
    let radius = 0;

    if (typeof l.getRadius === 'function') {
        // Circle (วงกลม)
        const center = l.getLatLng();
        lat = center.lat;
        lng = center.lng;
        isCircle = true;
        radius = l.getRadius();
        geometry = {
            type: 'Point',
            coordinates: [lng, lat]
        };
    } else if (l instanceof L.Marker || (typeof l.getLatLng === 'function' && typeof l.getBounds !== 'function')) {
        // Marker (จุดพิกัด)
        const pos = l.getLatLng();
        lat = pos.lat;
        lng = pos.lng;
        geometry = {
            type: 'Point',
            coordinates: [lng, lat]
        };
    } else if (typeof l.getBounds === 'function') {
        // Polygon หรือ Rectangle (รูปแปลงสี่เหลี่ยม/หลายเหลี่ยม)
        geometry = l.toGeoJSON().geometry;
        const bounds = l.getBounds();
        const center = bounds.getCenter();
        lat = center.lat;
        lng = center.lng;
    }

    window.pendingGeomanUpdates.set(jobId, { lat, lng, geometry, isCircle, radius });

    // Calculate new area and update job object properties in-place
    let newAreaFormatted = '-';
    if (isCircle) {
        const areaSqm = calculateCircleAreaInSqm(radius);
        newAreaFormatted = formatThaiArea(areaSqm);
    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
        const coords = getFlatCoordinates(l);
        const areaSqm = calculatePolygonAreaInSqm(coords);
        newAreaFormatted = formatThaiArea(areaSqm);
    }

    const job = findJobById(jobId);
    if (job) {
        job.lat = lat;
        job.lng = lng;
        job.geometry = geometry;
        if (!job.properties) job.properties = {};
        if (isCircle) {
            job.properties.is_circle = true;
            job.properties.radius = radius;
        }
        job.properties.area = newAreaFormatted;
    }

    // Update bottom sheet area input real-time if sheet is open for this shape
    if (selectedJobId === jobId) {
        const areaInput = document.getElementById('sheet-area');
        if (areaInput) {
            areaInput.value = newAreaFormatted;
        }
    }
}

function dequeueGeomanUpdate(jobId) {
    if (window.pendingGeomanUpdates) {
        window.pendingGeomanUpdates.delete(jobId);
    }
}

async function savePendingGeomanUpdates() {
    if (!window.pendingGeomanUpdates || window.pendingGeomanUpdates.size === 0) return;

    const updates = Array.from(window.pendingGeomanUpdates.entries());
    window.pendingGeomanUpdates.clear(); // ล้างคิวทันทีเพื่อป้องกันการบันทึกซ้อน

    showLoading(true, 'กำลังบันทึกการเปลี่ยนแปลงรูปแปลง...');
    try {
        for (const [jobId, data] of updates) {
            const job = dbJobs.find(x => x.id === jobId);
            if (job) {
                job.lat = data.lat;
                job.lng = data.lng;
                job.geometry = data.geometry;
                if (!job.properties) job.properties = {};
                if (data.isCircle) {
                    job.properties.is_circle = true;
                    job.properties.radius = data.radius;
                }
                await saveJobToSupabase(job);
            }
        }
        Swal.fire({ toast: true, icon: 'success', title: 'บันทึกการเปลี่ยนแปลงรูปแปลงสำเร็จ', timer: 1500, showConfirmButton: false });
    } catch (err) {
        console.error("Geoman pending update error:", err);
        Swal.fire('เกิดข้อผิดพลาด', 'บันทึกล้มเหลว: ' + err.message, 'error');
        renderMap(); // โหลดพิกัดเดิมกลับมา
    } finally {
        showLoading(false);
    }
}

// --- Measurement Ruler Tool ---
let isRulerActive = false;
let rulerPoints = [];
let rulerMarkersGroup = null;
let rulerLine = null;
let rulerPolygon = null;
let rulerHintLine = null;
let rulerIsClosed = false;
let drawingMeasureGroup = null;
let drawingMeasureLayer = null;
let drawingMeasurePinned = false;
let drawingMeasureTimer = null;
let queuedDrawingMeasureArgs = null;

function initDrawingMeasureGroup() {
    if (!drawingMeasureGroup && map) drawingMeasureGroup = L.layerGroup().addTo(map);
}

function clearDrawingMeasurements(force = true) {
    if (drawingMeasurePinned && !force) return;
    if (drawingMeasureTimer) window.clearTimeout(drawingMeasureTimer);
    drawingMeasureTimer = null;
    queuedDrawingMeasureArgs = null;
    drawingMeasureGroup?.clearLayers();
    drawingMeasureLayer = null;
    drawingMeasurePinned = false;
}

function getDrawingMeasurePoints(layer) {
    const unwrap = value => Array.isArray(value) && value.length && Array.isArray(value[0]) ? unwrap(value[0]) : value;
    const points = unwrap(layer?.getLatLngs?.() || []);
    return Array.isArray(points) ? points.filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) : [];
}

function addMapSideLabel(group, from, to) {
    L.marker(rulerSegmentMidpoint(from, to), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'ruler-label-anchor', iconSize: [1, 1], iconAnchor: [0, 0] })
    }).bindTooltip(formatDistanceTH(from.distanceTo(to)), {
        permanent: true,
        direction: 'center',
        offset: [0, -12],
        className: 'ruler-segment-tooltip'
    }).addTo(group).openTooltip();
}

function renderDrawingMeasurements(layer, shape, isClosed = false) {
    if (!layer || !['Polygon', 'Rectangle'].includes(shape)) return clearDrawingMeasurements();
    initDrawingMeasureGroup();
    drawingMeasureGroup.clearLayers();
    const points = getDrawingMeasurePoints(layer);
    if (points.length < 2) return;
    for (let index = 1; index < points.length; index++) addMapSideLabel(drawingMeasureGroup, points[index - 1], points[index]);
    if (!isClosed) return;
    addMapSideLabel(drawingMeasureGroup, points[points.length - 1], points[0]);
    const area = calculatePolygonArea(points);
    const bounds = L.polygon(points).getBounds();
    // Put completed-plot area above its boundary so a small plot remains
    // visible and tappable after drawing.
    const labelPoint = L.latLng(bounds.getNorth(), bounds.getCenter().lng);
    L.marker(labelPoint, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'ruler-label-anchor', iconSize: [1, 1], iconAnchor: [0, 0] })
    }).bindTooltip(`<div class="ruler-area-main">${formatAreaRaiTH(area)}</div><div class="ruler-area-sqm">${formatAreaSquareMeters(area)}</div>`, {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'ruler-area-tooltip'
    }).addTo(drawingMeasureGroup).openTooltip();
}

function scheduleDrawingMeasurementRender(layer, shape, isClosed = false, immediate = false) {
    queuedDrawingMeasureArgs = { layer, shape, isClosed };
    if (drawingMeasureTimer) {
        if (!immediate) return;
        window.clearTimeout(drawingMeasureTimer);
        drawingMeasureTimer = null;
    }
    const render = () => {
        drawingMeasureTimer = null;
        const next = queuedDrawingMeasureArgs;
        queuedDrawingMeasureArgs = null;
        if (next) renderDrawingMeasurements(next.layer, next.shape, next.isClosed);
    };
    if (immediate) render();
    else drawingMeasureTimer = window.setTimeout(render, 70);
}

function watchDrawingMeasurements(event) {
    const shape = event?.shape;
    const layer = event?.workingLayer;
    if (!layer || !['Polygon', 'Rectangle'].includes(shape)) return clearDrawingMeasurements();
    drawingMeasureLayer = layer;
    drawingMeasurePinned = false;
    const refresh = () => scheduleDrawingMeasurementRender(layer, shape, false);
    layer.on('pm:change pm:vertexadded pm:vertexremoved', refresh);
    scheduleDrawingMeasurementRender(layer, shape, false, true);
}

function pinCompletedDrawingMeasurements(layer, shape) {
    if (!['Polygon', 'Rectangle'].includes(shape)) return clearDrawingMeasurements();
    drawingMeasurePinned = true;
    scheduleDrawingMeasurementRender(layer, shape, true, true);
}

function initThreePointRectanglePreview() {
    if (!threePointRectanglePreviewGroup && map) threePointRectanglePreviewGroup = L.layerGroup().addTo(map);
}

function getThreePointRectangleCorners(start, end, widthPoint) {
    if (!map || !start || !end || !widthPoint) return null;
    const zoom = map.getZoom();
    const a = map.project(start, zoom);
    const b = map.project(end, zoom);
    const c = map.project(widthPoint, zoom);
    const direction = b.subtract(a);
    const length = Math.hypot(direction.x, direction.y);
    if (length < 1) return null;
    const normal = L.point(-direction.y / length, direction.x / length);
    const width = (c.x - a.x) * normal.x + (c.y - a.y) * normal.y;
    if (Math.abs(width) < 1) return null;
    const offset = normal.multiplyBy(width);
    return [map.unproject(a, zoom), map.unproject(b, zoom), map.unproject(b.add(offset), zoom), map.unproject(a.add(offset), zoom)];
}

function renderThreePointRectanglePreview(pointer = null) {
    initThreePointRectanglePreview();
    threePointRectanglePreviewGroup.clearLayers();
    const [start, end] = threePointRectanglePoints;
    if (!start) return;
    L.circleMarker(start, { radius: 6, color: '#7c3aed', fillColor: '#fff', fillOpacity: 1, weight: 3, interactive: false }).addTo(threePointRectanglePreviewGroup);
    if (!end) return;
    L.polyline([start, end], { color: '#7c3aed', weight: 4, dashArray: '7 5', interactive: false }).addTo(threePointRectanglePreviewGroup);
    addMapSideLabel(threePointRectanglePreviewGroup, start, end);
    const corners = pointer ? getThreePointRectangleCorners(start, end, pointer) : null;
    if (!corners) return;
    L.polygon(corners, { color: '#7c3aed', fillColor: '#a78bfa', fillOpacity: .22, weight: 3, interactive: false }).addTo(threePointRectanglePreviewGroup);
    for (let index = 0; index < corners.length; index++) addMapSideLabel(threePointRectanglePreviewGroup, corners[index], corners[(index + 1) % corners.length]);
    const area = calculatePolygonArea(corners);
    const bounds = L.polygon(corners).getBounds();
    const labelPoint = L.latLng(bounds.getNorth(), bounds.getCenter().lng);
    L.marker(labelPoint, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'ruler-label-anchor', iconSize: [1, 1], iconAnchor: [0, 0] }) })
        .bindTooltip(`<div class="ruler-area-main">${formatAreaRaiTH(area)}</div><div class="ruler-area-sqm">${formatAreaSquareMeters(area)}</div>`, { permanent: true, direction: 'top', offset: [0, -8], className: 'ruler-area-tooltip' })
        .addTo(threePointRectanglePreviewGroup).openTooltip();
}

function stopThreePointRectangleMode() {
    if (!map) return;
    isThreePointRectangleMode = false;
    threePointRectanglePoints = [];
    if (threePointPreviewTimer) window.clearTimeout(threePointPreviewTimer);
    threePointPreviewTimer = null;
    threePointPreviewPointer = null;
    threePointRectanglePreviewGroup?.clearLayers();
    map.off('click', onThreePointRectangleClick);
    map.off('mousemove', onThreePointRectangleMove);
    map.getContainer().style.cursor = '';
    document.getElementById('btn-three-point-rectangle')?.classList.remove('active');
    document.getElementById('btn-three-point-rectangle')?.removeAttribute('aria-pressed');
}

// Geoman permits several global modes to be enabled at once.  That is useful
// for desktop power users, but confusing on a phone: two highlighted tools can
// compete for the next tap on the map.  Keep map interaction deliberately
// modal, so there is always just one active tool.
function disableNativeMapToolModes(except = '') {
    if (!map?.pm) return;
    if (except !== 'draw') map.pm.Draw?.disable?.();
    if (except !== 'edit') map.pm.disableGlobalEditMode?.();
    if (except !== 'drag') map.pm.disableGlobalDragMode?.();
    if (except !== 'rotate') map.pm.disableGlobalRotateMode?.();
    if (except !== 'remove') map.pm.disableGlobalRemovalMode?.();
}

function stopRulerTool({ clear = true } = {}) {
    if (!isRulerActive) return;
    isRulerActive = false;
    const rulerBtn = document.getElementById('btn-measure-ruler');
    rulerBtn?.classList.remove('active');
    rulerBtn?.removeAttribute('aria-pressed');
    if (clear) clearRuler();
    disableRulerEvents();
}

function prepareForNativeMapTool(button) {
    const className = (button.className || '').toLowerCase();
    const title = (button.getAttribute('title') || '').toLowerCase();
    let mode = '';
    if (className.includes('action-draw') || title.includes('วาด') || title.includes('draw')) mode = 'draw';
    else if (className.includes('action-edit') || title.includes('แก้ไข') || title.includes('edit')) mode = 'edit';
    else if (className.includes('action-drag') || title.includes('ย้าย') || title.includes('drag')) mode = 'drag';
    else if (className.includes('action-rotate') || title.includes('หมุน') || title.includes('rotate')) mode = 'rotate';
    else if (className.includes('action-removal') || className.includes('action-remove') || title.includes('ลบ') || title.includes('remove')) mode = 'remove';
    if (!mode) return;

    stopRulerTool();
    stopThreePointRectangleMode();
    disableNativeMapToolModes(mode);
}

function startThreePointRectangleMode() {
    if (!map) return;
    if (isThreePointRectangleMode) return stopThreePointRectangleMode();
    stopRulerTool();
    disableNativeMapToolModes();
    clearDrawingMeasurements();
    isThreePointRectangleMode = true;
    map.getContainer().style.cursor = 'crosshair';
    threePointRectanglePoints = [];
    initThreePointRectanglePreview();
    map.on('click', onThreePointRectangleClick);
    map.on('mousemove', onThreePointRectangleMove);
    const button = document.getElementById('btn-three-point-rectangle');
    button?.classList.add('active');
    button?.setAttribute('aria-pressed', 'true');
}

function onThreePointRectangleMove(event) {
    if (!isThreePointRectangleMode || threePointRectanglePoints.length < 2) return;
    // Rebuilding map labels is expensive on older PCs; keep the preview smooth
    // without rebuilding it on every single mousemove event.
    threePointPreviewPointer = event.latlng;
    if (threePointPreviewTimer) return;
    threePointPreviewTimer = window.setTimeout(() => {
        threePointPreviewTimer = null;
        if (isThreePointRectangleMode && threePointPreviewPointer) renderThreePointRectanglePreview(threePointPreviewPointer);
    }, 45);
}

function onThreePointRectangleClick(event) {
    if (!isThreePointRectangleMode) return;
    L.DomEvent.stopPropagation(event);
    if (threePointRectanglePoints.length < 2) {
        threePointRectanglePoints.push(event.latlng);
        renderThreePointRectanglePreview();
        return;
    }
    const corners = getThreePointRectangleCorners(threePointRectanglePoints[0], threePointRectanglePoints[1], event.latlng);
    if (!corners) return;
    const layer = L.polygon(corners, { color: '#7c3aed', fillColor: '#a78bfa', fillOpacity: .22, weight: 3 });
    layer._visionThreePointRectangle = true;
    stopThreePointRectangleMode();
    layer.addTo(map);
    map.fire('pm:create', { shape: 'Rectangle', layer });
}

function initRulerGroup() {
    if (!rulerMarkersGroup && map) {
        rulerMarkersGroup = L.layerGroup().addTo(map);
    }
}

function toggleRulerTool() {
    if (isRulerActive) {
        stopRulerTool();
        return;
    }
    stopThreePointRectangleMode();
    disableNativeMapToolModes();
    isRulerActive = true;
    const rulerBtn = document.getElementById('btn-measure-ruler');
    
    if (isRulerActive) {
        if (rulerBtn) {
            rulerBtn.classList.add('active');
            rulerBtn.setAttribute('aria-pressed', 'true');
        }
        enableRulerEvents();
    }
}

function enableRulerEvents() {
    if (!map) return;
    initRulerGroup();
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', onRulerMapClick);
    map.on('mousemove', onRulerMouseMove);
    map.on('dblclick', onRulerDblClick);
}

function disableRulerEvents() {
    if (!map) return;
    map.getContainer().style.cursor = '';
    map.off('click', onRulerMapClick);
    map.off('mousemove', onRulerMouseMove);
    map.off('dblclick', onRulerDblClick);
}

function clearRuler() {
    rulerPoints = [];
    rulerIsClosed = false;
    if (rulerMarkersGroup) rulerMarkersGroup.clearLayers();
    rulerLine = null;
    rulerPolygon = null;
    rulerHintLine = null;
    hideRulerPanel();
}

function formatDistanceTH(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(2) + ' กม.';
    }
    return meters.toFixed(1) + ' ม.';
}

function formatAreaRaiTH(sqMeters) {
    const totalWah = sqMeters / 4;
    const rai = Math.floor(totalWah / 400);
    const remainderWah = totalWah % 400;
    const ngan = Math.floor(remainderWah / 100);
    const wah = remainderWah % 100;
    return `${rai}-${ngan}-${wah.toFixed(2).padStart(5, '0')} ไร่-งาน-ตร.ว.`;
}

function formatAreaSquareMeters(sqMeters) {
    return `${Number(sqMeters || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตร.ม.`;
}

function calculatePolylineDistance(latlngs) {
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
        total += latlngs[i].distanceTo(latlngs[i + 1]);
    }
    return total;
}

function calculatePolygonArea(latlngs) {
    if (latlngs.length < 3) return 0;
    let area = 0;
    const RAD = Math.PI / 180;
    const R = 6378137;
    for (let i = 0; i < latlngs.length; i++) {
        const p1 = latlngs[i];
        const p2 = latlngs[(i + 1) % latlngs.length];
        area += (p2.lng - p1.lng) * RAD * (2 + Math.sin(p1.lat * RAD) + Math.sin(p2.lat * RAD));
    }
    return Math.abs(area * R * R / 2);
}

function onRulerMapClick(e) {
    if (!isRulerActive) return;
    const latlng = e.latlng;
    if (rulerIsClosed) {
        clearRuler();
        initRulerGroup();
    }
    if (rulerPoints.length >= 3 && isNearRulerStart(latlng)) {
        closeRulerShape();
        return;
    }
    rulerPoints.push(latlng);
    updateRulerGraphics();
}

function onRulerMouseMove(e) {
    if (!isRulerActive || rulerPoints.length === 0 || rulerIsClosed) return;
    const currentLatLng = e.latlng;
    const tempPoints = [...rulerPoints, currentLatLng];
    
    if (rulerHintLine) {
        rulerHintLine.setLatLngs([rulerPoints[rulerPoints.length - 1], currentLatLng]);
    } else {
        rulerHintLine = L.polyline([rulerPoints[rulerPoints.length - 1], currentLatLng], {
            color: '#6366f1',
            dashArray: '6, 6',
            weight: 2
        }).addTo(rulerMarkersGroup);
    }
    
    showRulerPanel(calculatePolylineDistance(tempPoints), 0, false);
}

function onRulerDblClick(e) {
    if (!isRulerActive) return;
    L.DomEvent.stopPropagation(e);
    if (rulerPoints.length >= 3) closeRulerShape();
}

function isNearRulerStart(latlng) {
    if (!map || !rulerPoints.length) return false;
    return map.latLngToContainerPoint(latlng).distanceTo(map.latLngToContainerPoint(rulerPoints[0])) <= 22;
}

function rulerSegmentMidpoint(from, to) {
    return L.latLng((from.lat + to.lat) / 2, (from.lng + to.lng) / 2);
}

function addRulerSegmentLabel(from, to) {
    L.marker(rulerSegmentMidpoint(from, to), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'ruler-label-anchor', iconSize: [1, 1], iconAnchor: [0, 0] })
    }).bindTooltip(formatDistanceTH(from.distanceTo(to)), {
        permanent: true,
        direction: 'center',
        offset: [0, -12],
        className: 'ruler-segment-tooltip'
    }).addTo(rulerMarkersGroup).openTooltip();
}

function closeRulerShape() {
    if (rulerPoints.length < 3 || rulerIsClosed) return;
    rulerIsClosed = true;
    if (rulerHintLine) {
        rulerMarkersGroup.removeLayer(rulerHintLine);
        rulerHintLine = null;
    }
    updateRulerGraphics();
}

function updateRulerGraphics() {
    initRulerGroup();
    rulerMarkersGroup.clearLayers();
    rulerLine = null;
    rulerPolygon = null;
    rulerHintLine = null;

    rulerPoints.forEach(point => L.circleMarker(point, {
        radius: 6, color: '#4f46e5', fillColor: '#ffffff', fillOpacity: 1, weight: 3, interactive: false
    }).addTo(rulerMarkersGroup));

    if (rulerPoints.length >= 2) {
        const linePoints = rulerIsClosed ? [...rulerPoints, rulerPoints[0]] : rulerPoints;
        rulerLine = L.polyline(linePoints, { color: '#4f46e5', weight: 4, opacity: 0.9 }).addTo(rulerMarkersGroup);
        for (let index = 1; index < rulerPoints.length; index++) addRulerSegmentLabel(rulerPoints[index - 1], rulerPoints[index]);
        if (rulerIsClosed) addRulerSegmentLabel(rulerPoints[rulerPoints.length - 1], rulerPoints[0]);
    }

    const area = rulerIsClosed ? calculatePolygonArea(rulerPoints) : 0;
    if (rulerIsClosed) {
        rulerPolygon = L.polygon(rulerPoints, { color: '#6366f1', fillColor: '#818cf8', fillOpacity: 0.25, weight: 2 }).addTo(rulerMarkersGroup);
        const bounds = rulerPolygon.getBounds();
        const labelPoint = L.latLng(bounds.getNorth(), bounds.getCenter().lng);
        L.marker(labelPoint, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({ className: 'ruler-label-anchor', iconSize: [1, 1], iconAnchor: [0, 0] })
        }).bindTooltip(`<div class="ruler-area-main">${formatAreaRaiTH(area)}</div><div class="ruler-area-sqm">${formatAreaSquareMeters(area)}</div>`, {
            permanent: true,
            direction: 'top',
            offset: [0, -8],
            className: 'ruler-area-tooltip'
        }).addTo(rulerMarkersGroup).openTooltip();
    }

    const linePoints = rulerIsClosed ? [...rulerPoints, rulerPoints[0]] : rulerPoints;
    showRulerPanel(calculatePolylineDistance(linePoints), area, rulerIsClosed);
}

function showRulerPanel(distMeters, areaSqMeters, isClosed = false) {
    let panel = document.getElementById('ruler-info-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'ruler-info-panel';
        panel.className = 'fixed top-36 left-1/2 -translate-x-1/2 z-[999] bg-slate-900/90 backdrop-blur-md text-white px-4 py-2.5 rounded-2xl shadow-2xl border border-indigo-500/40 flex items-center gap-3 text-xs animate-fade-in';
        document.body.appendChild(panel);
    }
    
    let html = `
        <div class="flex items-center gap-2">
            <i class="fa-solid fa-ruler-combined text-indigo-400 text-sm"></i>
            <div>
                <div class="font-bold text-white flex items-center gap-1.5">
                    <span>ระยะทาง: ${formatDistanceTH(distMeters)}</span>
                </div>
                ${isClosed ? `<div class="text-[11px] text-emerald-300 font-semibold mt-0.5">เนื้อที่: ${formatAreaRaiTH(areaSqMeters)}</div><div class="text-[10px] text-emerald-100">${formatAreaSquareMeters(areaSqMeters)}</div>` : '<div class="text-[10px] text-slate-300">แตะจุดเริ่มต้นหรือดับเบิลคลิกเพื่อปิดรูปและคำนวณเนื้อที่</div>'}
            </div>
        </div>
        <button onclick="clearRuler()" title="ล้างค่าการวัด" class="ml-2 w-7 h-7 rounded-full bg-slate-800 hover:bg-red-600 text-gray-300 hover:text-white flex items-center justify-center transition cursor-pointer">
            <i class="fa-solid fa-rotate-left text-xs"></i>
        </button>
    `;
    panel.innerHTML = html;
    panel.style.display = 'flex';
}

function hideRulerPanel() {
    const panel = document.getElementById('ruler-info-panel');
    if (panel) panel.style.display = 'none';
}

function injectRulerButtonToGeoman() {
    if (document.getElementById('btn-measure-ruler')) return;

    const toolbars = Array.from(document.querySelectorAll('.leaflet-pm-toolbar'));
    const manageToolbar = toolbars.find(toolbar =>
        toolbar.dataset.groupLabel === 'จัดการ' || toolbar.className.includes('leaflet-pm-edit')
    ) || toolbars[1] || toolbars[0];
    if (!manageToolbar) return;

    const buttons = Array.from(manageToolbar.querySelectorAll('.leaflet-buttons-control-button'));
    const rotateButton = buttons.find(button => {
        const title = (button.getAttribute('title') || '').toLowerCase();
        return button.className.includes('rotate')
            || button.querySelector('.leaflet-pm-icon-rotate')
            || title.includes('หมุน')
            || title.includes('rotate');
    });

    // Geoman puts every control inside .button-container.  Keeping that wrapper is
    // necessary for the toolbar's flex gap to match the surrounding controls.
    const rulerContainer = document.createElement('div');
    rulerContainer.className = 'button-container pos-right';
    rulerContainer.setAttribute('title', 'ไม้บรรทัด (วัดระยะทางและพื้นที่)');

    const rulerButton = document.createElement('a');
    rulerButton.id = 'btn-measure-ruler';
    rulerButton.className = 'leaflet-buttons-control-button ruler-control';
    rulerButton.href = '#';
    rulerButton.setAttribute('role', 'button');
    rulerButton.setAttribute('title', 'ไม้บรรทัด (วัดระยะทางและพื้นที่)');
    rulerButton.setAttribute('aria-label', 'ไม้บรรทัดวัดระยะทางและพื้นที่');
    rulerButton.innerHTML = '<div class="control-icon"><i class="fa-solid fa-ruler-combined" style="font-size:18px;color:#374151;"></i></div>';
    rulerButton.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        toggleRulerTool();
    };
    rulerContainer.appendChild(rulerButton);

    // Put the ruler directly below Rotate in the Manage toolbar.
    const rotateContainer = rotateButton?.closest('.button-container');
    if (rotateContainer?.parentNode) {
        rotateContainer.parentNode.insertBefore(rulerContainer, rotateContainer.nextSibling);
    } else {
        manageToolbar.appendChild(rulerContainer);
    }
}

function injectThreePointRectangleButton() {
    if (document.getElementById('btn-three-point-rectangle')) return;
    const drawToolbar = Array.from(document.querySelectorAll('.leaflet-pm-toolbar')).find(toolbar =>
        toolbar.dataset.groupLabel === 'สร้าง' || toolbar.className.includes('leaflet-pm-draw')
    );
    if (!drawToolbar) return;
    const nativeRectangle = Array.from(drawToolbar.querySelectorAll('.leaflet-buttons-control-button')).find(button => {
        const title = (button.getAttribute('title') || '').toLowerCase();
        return title.includes('rectangle') || title.includes('สี่เหลี่ยม') || button.className.toLowerCase().includes('rectangle') || Boolean(button.querySelector('.leaflet-pm-icon-rectangle'));
    });
    const container = document.createElement('div');
    container.className = 'button-container pos-right';
    container.setAttribute('title', 'วาดสี่เหลี่ยม 3 จุด');
    const button = document.createElement('a');
    button.id = 'btn-three-point-rectangle';
    button.className = 'leaflet-buttons-control-button';
    button.href = '#';
    button.setAttribute('role', 'button');
    button.setAttribute('title', 'วาดสี่เหลี่ยม 3 จุด');
    button.setAttribute('aria-label', 'วาดสี่เหลี่ยม 3 จุด: เริ่ม แนวยาว ความกว้าง');
    button.innerHTML = '<div class="control-icon"><i class="fa-solid fa-vector-square" style="font-size:19px;color:#374151;"></i></div>';
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); startThreePointRectangleMode(); };
    container.appendChild(button);
    const nativeContainer = nativeRectangle?.closest('.button-container');
    if (nativeContainer?.parentNode) {
        nativeContainer.parentNode.insertBefore(container, nativeContainer);
        nativeContainer.style.display = 'none';
    } else {
        drawToolbar.appendChild(container);
    }
}

function decorateGeomanToolbars() {
    document.querySelectorAll('.leaflet-pm-toolbar').forEach((toolbar, index) => {
        const className = toolbar.className || '';
        const label = className.includes('leaflet-pm-draw')
            ? 'สร้าง'
            : className.includes('leaflet-pm-edit')
                ? 'จัดการ'
                : (index === 0 ? 'สร้าง' : 'จัดการ');
        toolbar.dataset.groupLabel = label;
        toolbar.querySelectorAll('.leaflet-buttons-control-button').forEach(button => {
            const accessibleName = button.getAttribute('title') || `${label}แผนที่`;
            if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', accessibleName);

            // Keep Geoman's native rotate control intact. Replacing its generated
            // icon DOM can break the plugin's own rotate handler on some versions.
            const isRotate = button.classList.contains('action-rotate') || 
                             button.querySelector('.leaflet-pm-icon-rotate') || 
                             (button.getAttribute('title') || '').includes('หมุน') || 
                             (button.getAttribute('title') || '').toLowerCase().includes('rotate');
            if (isRotate) {
                button.setAttribute('aria-label', 'หมุนรูปแปลง');
            }

            // Capture before Geoman handles the click.  Existing modes are
            // stopped first, then Geoman can activate the button just tapped.
            if (!button.id && !button.dataset.exclusiveToolBound) {
                button.dataset.exclusiveToolBound = 'true';
                button.addEventListener('click', () => prepareForNativeMapTool(button), true);
            }
        });
    });
    injectRulerButtonToGeoman();
    injectThreePointRectangleButton();
}

function renderGeomanToggleButton(btn, isOpen) {
    if (!btn) return;
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    btn.innerHTML = isOpen
        ? '<i class="fa-solid fa-xmark"></i><span class="pm-toggle-label">ซ่อน</span>'
        : '<i class="fa-solid fa-pen-ruler"></i><span class="pm-toggle-label">เครื่องมือ</span>';
}

let geomanPositioningReady = false;

function positionGeomanToolbars() {
    const container = document.querySelector('.leaflet-bottom.leaflet-right');
    const fabContainer = document.getElementById('fab-container');
    const mapElement = document.getElementById('map');
    if (!container || !fabContainer || !mapElement || fabContainer.offsetParent === null) return;

    const mapRect = mapElement.getBoundingClientRect();
    const fabRect = fabContainer.getBoundingClientRect();
    const gap = window.matchMedia('(max-width: 599px)').matches ? 8 : 10;
    // Keep the permanent toolbar above the complete FAB stack. Calculating
    // from the map bounds works after resizing, sheet changes and rotation.
    const bottom = Math.max(8, mapRect.bottom - fabRect.top + gap);
    const right = Math.max(8, mapRect.right - fabRect.right);
    const maxHeight = Math.max(120, fabRect.top - mapRect.top - gap);

    container.style.setProperty('bottom', `${Math.round(bottom)}px`, 'important');
    container.style.setProperty('right', `${Math.round(right)}px`, 'important');
    container.style.setProperty('top', 'auto', 'important');
    container.style.setProperty('max-height', `${Math.round(maxHeight)}px`, 'important');
    container.style.setProperty('overflow-y', 'auto', 'important');
    container.style.setProperty('transform', 'none', 'important');
}

function scheduleGeomanToolbarPosition() {
    requestAnimationFrame(positionGeomanToolbars);
    window.setTimeout(positionGeomanToolbars, 360);
}

function ensureGeomanToolbarPositioning() {
    if (geomanPositioningReady) return;
    geomanPositioningReady = true;

    window.addEventListener('resize', scheduleGeomanToolbarPosition, { passive: true });
    window.addEventListener('orientationchange', scheduleGeomanToolbarPosition, { passive: true });

    const fabContainer = document.getElementById('fab-container');
    const mapElement = document.getElementById('map');
    if (fabContainer) {
        fabContainer.addEventListener('transitionend', positionGeomanToolbars);
        new MutationObserver(scheduleGeomanToolbarPosition).observe(fabContainer, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
    if (mapElement && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(scheduleGeomanToolbarPosition).observe(mapElement);
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleGeomanToolbarPosition, { passive: true });
        window.visualViewport.addEventListener('scroll', scheduleGeomanToolbarPosition, { passive: true });
    }
}

// New standalone drawings are created in the database before the detail form
// is completed. Save their geometry quietly after each Edit Layer adjustment,
// so a map refresh can never replace an unfinished shape with its old outline.
function scheduleCustomDrawingGeometrySave(jobId) {
    const job = findJobById(jobId);
    if (!job?.properties?.is_custom_draw) return;
    clearTimeout(customDrawingGeometrySaveTimers.get(jobId));
    customDrawingGeometrySaveTimers.set(jobId, setTimeout(async () => {
        try {
            const latestJob = findJobById(jobId);
            if (!latestJob?.properties?.is_custom_draw) return;
            await saveJobToSupabase(latestJob);
            window.pendingGeomanUpdates.delete(jobId);
            showPendingActionsBar();
        } catch (error) {
            // Keep the queued edit in memory; an explicit save or a later
            // successful connection can retry it without losing the shape.
            console.error('Custom drawing geometry auto-save error', error);
        } finally {
            customDrawingGeometrySaveTimers.delete(jobId);
        }
    }, 450));
}

function toggleGeomanToolbar(show) {
    const container = document.querySelector('.leaflet-bottom.leaflet-right');
    const toolbars = document.querySelectorAll('.leaflet-pm-toolbar');
    const btn = document.getElementById('btn-toggle-pm');

    // If controls are not yet generated in the DOM, retry up to 15 times (1.5 seconds total)
    if (!container || toolbars.length === 0) {
        if (!window.pmToggleRetryCount) window.pmToggleRetryCount = 0;
        if (window.pmToggleRetryCount < 15) {
            window.pmToggleRetryCount++;
            setTimeout(() => toggleGeomanToolbar(show), 100);
        }
        return;
    }
    // Reset retry count once found
    window.pmToggleRetryCount = 0;
    decorateGeomanToolbars();
    ensureGeomanToolbarPositioning();
    positionGeomanToolbars();

    const shouldHide = show === false;
    localStorage.setItem('survey_pm_toolbar_visible', shouldHide ? 'false' : 'true');

    if (container) {
        if (shouldHide) {
            container.classList.add('pm-hidden');
        } else {
            container.classList.remove('pm-hidden');
        }
    }

    toolbars.forEach(toolbar => {
        if (shouldHide) {
            toolbar.classList.add('hidden');
        } else {
            toolbar.classList.remove('hidden');
        }
    });

    if (shouldHide) {
        // ซ่อนเฉพาะแผงปุ่ม: เครื่องมือที่เลือกอยู่ยังทำงานต่อได้จนกว่า
        // ผู้ใช้จะกดปุ่มเดิมเพื่อยกเลิกหรือเลือกเครื่องมือใหม่
        if (btn) {
            btn.classList.remove('bg-purple-600', 'text-white');
            btn.classList.add('bg-white', 'text-purple-600');
            renderGeomanToggleButton(btn, false);
        }
    } else {
        // แสดงเครื่องมือ
        if (btn) {
            btn.classList.add('bg-purple-600', 'text-white');
            btn.classList.remove('bg-white', 'text-purple-600');
            renderGeomanToggleButton(btn, true);
        }
    }

    if (!shouldHide) scheduleGeomanToolbarPosition();
}
window.toggleGeomanToolbar = toggleGeomanToolbar;

function togglePMEnabledSetting() {
    // Retained for old cached HTML only: drawing tools must stay available.
    localStorage.setItem('survey_enable_pm', 'true');
    toggleGeomanToolbar(localStorage.getItem('survey_pm_toolbar_visible') !== 'false');
}
window.togglePMEnabledSetting = togglePMEnabledSetting;

function toggleSpeechEnableSetting(enabled) {
    localStorage.setItem('survey_speech_enabled', enabled ? 'true' : 'false');
    isSpeechEnabled = enabled;
    const chk = document.getElementById('chk-enable-speech');
    if (chk) chk.checked = enabled;
}
window.toggleSpeechEnableSetting = toggleSpeechEnableSetting;

function showPendingActionsBar() {
    const bar = document.getElementById('pending-actions-bar');
    if (!bar) return;
    
    const newCount = window.pendingNewShapes ? window.pendingNewShapes.length : 0;
    const editCount = window.pendingGeomanUpdates ? Array.from(window.pendingGeomanUpdates.keys()).filter(key => !key.startsWith('drawn_temp_')).length : 0;
    
    if (newCount > 0 || editCount > 0) {
        bar.classList.remove('hidden');
        const textEl = document.getElementById('pending-actions-text');
        if (textEl) {
            textEl.innerText = `วาดใหม่: ${newCount} | แก้ไข: ${editCount}`;
        }
    } else {
        bar.classList.add('hidden');
    }
}
window.showPendingActionsBar = showPendingActionsBar;

async function cancelAllPendingChanges() {
    const result = await Swal.fire({
        title: 'ยืนยันการยกเลิก?',
        text: 'การวาดและแก้ไขรูปแปลงทั้งหมดที่ยังไม่ได้บันทึกจะถูกล้างออก',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'ใช่, ยกเลิกทั้งหมด',
        cancelButtonText: 'ปิด'
    });

    if (!result.isConfirmed) return;

    if (window.pendingNewShapes && window.pendingNewShapes.length > 0) {
        window.pendingNewShapes.forEach(item => {
            if (item.layer) {
                if (map && item.layer.pm && typeof item.layer.pm.disable === 'function') {
                    item.layer.pm.disable();
                }
                removeDraftDrawingLayer(item.layer);
            }
        });
    }

    window.pendingNewShapes = [];
    if (window.pendingGeomanUpdates) {
        window.pendingGeomanUpdates.clear();
    }

    if (map && map.pm) {
        map.pm.disableGlobalEditMode();
        map.pm.disableGlobalDragMode();
        map.pm.disableGlobalRotateMode();
        map.pm.disableGlobalRemovalMode();
        if (map.pm.Draw) map.pm.Draw.disable();
    }

    renderMap();
    showPendingActionsBar();

    Swal.fire({
        toast: true,
        position: 'top',
        icon: 'info',
        title: 'ยกเลิกการเปลี่ยนแปลงทั้งหมดแล้ว',
        timer: 1500,
        showConfirmButton: false
    });
}
window.cancelAllPendingChanges = cancelAllPendingChanges;

async function saveAllPendingChanges() {
    const newCount = window.pendingNewShapes ? window.pendingNewShapes.length : 0;
    const editCount = window.pendingGeomanUpdates ? Array.from(window.pendingGeomanUpdates.keys()).filter(key => !key.startsWith('drawn_temp_')).length : 0;

    if (newCount === 0 && editCount === 0) {
        Swal.fire('ไม่มีข้อมูลที่เปลี่ยนแปลง', '', 'info');
        return;
    }

    if (map && map.pm) {
        map.pm.disableGlobalEditMode();
        map.pm.disableGlobalDragMode();
        map.pm.disableGlobalRotateMode();
        map.pm.disableGlobalRemovalMode();
        if (map.pm.Draw) map.pm.Draw.disable();
    }

    const newJobsToSave = [];
    const existingJobsToUpdate = [];

    const collectedDetails = [];
    for (let i = 0; i < newCount; i++) {
        const shape = window.pendingNewShapes[i];
        
        if (shape.layer) {
            if (typeof shape.layer.getBounds === 'function') {
                map.fitBounds(shape.layer.getBounds(), { padding: [100, 100] });
            } else if (typeof shape.layer.getLatLng === 'function') {
                map.setView(shape.layer.getLatLng(), 17);
            }
        }

        let optionsHtml = '';
        categories.forEach(cat => {
            optionsHtml += `<option value="${cat}" ${cat === currentUser.category ? 'selected' : ''}>${cat}</option>`;
        });

        const { value: formValues } = await Swal.fire({
            title: `ระบุข้อมูลแปลงใหม่ (${i + 1}/${newCount})`,
            html: `
                <div class="text-left space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">ชื่อแปลง / เลขทะเบียน</label>
                        <input id="swal-job-name" class="swal2-input w-full m-0 px-3 py-2 text-sm border rounded-xl" placeholder="เช่น แปลง 101" style="box-sizing:border-box; height:auto; margin:0;" value="แปลงใหม่ ${i+1}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">รายละเอียด / หมายเหตุ</label>
                        <textarea id="swal-job-note" class="swal2-textarea w-full m-0 px-3 py-2 text-sm border rounded-xl" placeholder="เช่น รายละเอียดแปลง" style="box-sizing:border-box; height:60px; margin:0;"></textarea>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">ประเภทงาน / โครงการ</label>
                        <select id="swal-job-category" class="swal2-select w-full m-0 px-3 py-2 text-sm border rounded-xl" style="box-sizing:border-box; height:auto; margin:0; width:100%;">
                            ${optionsHtml}
                        </select>
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            cancelButtonText: 'ยกเลิกการบันทึกทั้งหมด',
            confirmButtonText: 'ถัดไป',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#ef4444',
            preConfirm: () => {
                const name = document.getElementById('swal-job-name').value.trim();
                const note = document.getElementById('swal-job-note').value.trim();
                const category = document.getElementById('swal-job-category').value;
                if (!name) {
                    Swal.showValidationMessage('กรุณาระบุชื่อแปลง');
                    return false;
                }
                return { name, note, category };
            }
        });

        if (!formValues) {
            Swal.fire({
                icon: 'info',
                title: 'ยกเลิกการบันทึกชั่วคราว',
                text: 'การบันทึกถูกระงับ ข้อมูลการวาดบนแผนที่ยังไม่ถูกลบ'
            });
            return;
        }

        collectedDetails.push(formValues);
    }

    for (let i = 0; i < newCount; i++) {
        const shape = window.pendingNewShapes[i];
        const formValues = collectedDetails[i];

        if (shape.layer) removeDraftDrawingLayer(shape.layer);

        let finalLat = shape.lat;
        let finalLng = shape.lng;
        let finalGeometry = shape.geometry;
        let finalRadius = shape.radius;

        if (window.pendingGeomanUpdates.has(shape.id)) {
            const up = window.pendingGeomanUpdates.get(shape.id);
            finalLat = up.lat;
            finalLng = up.lng;
            finalGeometry = up.geometry;
            finalRadius = up.radius;
            window.pendingGeomanUpdates.delete(shape.id);
        }

        const finalId = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '_' + i;

        const properties = {
            ...(shape.properties || {}),
            name: formValues.name,
            note: formValues.note,
            date: new Date().toISOString().split('T')[0],
            is_custom_draw: true,
            is_temp: false,
            navigator_id: null,
            navigator_name: null,
            images: []
        };
        if (shape.properties && shape.properties.is_circle) {
            properties.is_circle = true;
            properties.radius = finalRadius;
        }

        newJobsToSave.push({
            id: finalId,
            team_id: currentUser.team_id,
            lat: finalLat,
            lng: finalLng,
            geometry: finalGeometry,
            status: 'done',
            category: formValues.category,
            properties: properties,
            updated_at: new Date().toISOString()
        });
    }

    const updates = Array.from(window.pendingGeomanUpdates.entries());
    for (const [jobId, data] of updates) {
        const job = dbJobs.find(x => x.id === jobId);
        if (job) {
            job.lat = data.lat;
            job.lng = data.lng;
            job.geometry = data.geometry;
            if (!job.properties) job.properties = {};
            if (data.isCircle) {
                job.properties.is_circle = true;
                job.properties.radius = data.radius;
            }
            job.updated_at = new Date().toISOString();
            existingJobsToUpdate.push(job);
        }
    }

    showLoading(true, 'กำลังบันทึกข้อมูลรูปแปลงทั้งหมด...');
    try {
        const allSaves = [];
        
        newJobsToSave.forEach(j => {
            allSaves.push(saveJobToSupabase(j));
        });

        existingJobsToUpdate.forEach(j => {
            allSaves.push(saveJobToSupabase(j));
        });

        await Promise.all(allSaves);

        window.pendingNewShapes = [];
        window.pendingGeomanUpdates.clear();

        await syncJobsFromDB();
        showPendingActionsBar();

        Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลเรียบร้อยแล้ว',
            text: `บันทึกรูปแปลงใหม่ ${newJobsToSave.length} รายการ และอัปเดตพิกัด ${existingJobsToUpdate.length} รายการ`,
            timer: 2500,
            showConfirmButton: true
        });
    } catch (err) {
        console.error("Save all pending error:", err);
        Swal.fire('บันทึกล้มเหลว', 'เกิดข้อผิดพลาดในการบันทึก: ' + err.message, 'error');
        renderMap();
    } finally {
        showLoading(false);
    }
}
window.saveAllPendingChanges = saveAllPendingChanges;

function renderMap(fitBounds = false) {
    // ปิดการใช้งาน Geoman บน layer เดิมเพื่อป้องกันจุดยอดค้าง (orphaned helper markers)
    markersGroup.eachLayer(layer => {
        if (layer.pm && typeof layer.pm.disable === 'function') {
            layer.pm.disable();
        }
        if (typeof layer.eachLayer === 'function') {
            layer.eachLayer(sub => {
                if (sub.pm && typeof sub.pm.disable === 'function') {
                    sub.pm.disable();
                }
            });
        }
    });

    markersGroup.clearLayers();
    const filtered = getFilteredJobs();
    const group = L.featureGroup();
    filtered.slice(0, 1500).forEach(job => {
        let layer;
        const surveyFeatures = Array.isArray(job.properties?.survey_features) ? job.properties.survey_features : [];
        const hasChildSurveyFeatures = surveyFeatures.length > 0;
        const completedLayerColor = normalizeSurveyLayerColor(job.properties?.form_layer_color || getSurveyLayerColorForGeometry(job.geometry));
        let color = job.properties?.is_custom_draw === true && job.status === 'done' ? completedLayerColor
            : job.status === 'done' ? '#10b981'
            : (job.status === 'navigating' || job.status === 'checking') ? '#f97316'
                : job.status === 'problem' ? '#b91c1c' : '#ef4444';
        let fill = job.status === 'done' ? 0.4 : 0.2;
        if (hasChildSurveyFeatures) {
            color = '#facc15';
            fill = 0;
        }
        const isUnfinishedCustomDrawing = job.properties?.is_custom_draw === true && job.status !== 'done';
        // Hand-drawn boundaries are survey results in their own right. Keep
        // their actual geometry visible even while Base Map parcels use pins.
        if ((viewMode === 'original' || job.properties?.is_custom_draw === true) && job.geometry) {
            if (job.geometry.type.includes('Polygon')) {
                layer = L.geoJSON(job.geometry, { style: {
                    color: color,
                    weight: hasChildSurveyFeatures ? 3 : 2,
                    fillOpacity: fill,
                    dashArray: hasChildSurveyFeatures ? '8 6' : null,
                    className: job.status === 'navigating' ? 'job-navigating-pulse' : ''
                } });
            } else if (job.properties && job.properties.is_circle && job.properties.radius) {
                layer = L.circle([job.lat, job.lng], {
                    radius: job.properties.radius,
                    color: color,
                    weight: 2,
                    fillOpacity: fill,
                    className: job.status === 'navigating' ? 'job-navigating-pulse' : ''
                });
            } else if (job.properties?.is_custom_draw === true) {
                layer = createFixedSurveyPointMarker([job.lat, job.lng], color, job.status === 'done' ? 0.9 : 0.55);
            } else {
                let iconUrl = job.status === 'done'
                    ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
                    : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png';
                let mClassName = '';
                if (job.status === 'navigating') {
                    iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png';
                    mClassName = 'job-navigating-pulse';
                }
                layer = L.marker([job.lat, job.lng], {
                    // Pins represent a point, so they must keep a constant on-screen
                    // size at every zoom level.  Do not use a geographic circle here.
                    icon: L.icon({ iconUrl, iconSize: [25, 41], iconAnchor: [12, 41], className: `saved-job-pin ${mClassName}`.trim() })
                });
            }
        } else {
            let iconUrl = job.status === 'done'
                ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
                : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png';
            let mClassName = '';
            if (job.status === 'navigating') {
                iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png';
                mClassName = 'job-navigating-pulse';
            }
            layer = L.marker([job.lat, job.lng], {
                // Keep saved pins compact and readable rather than allowing a
                // zoom-dependent presentation to cover the map.
                icon: L.icon({ iconUrl, iconSize: [25, 41], iconAnchor: [12, 41], className: `saved-job-pin ${mClassName}`.trim() })
            });
        }
        if (layer) {
            layer.jobId = job.id;
            // คัดลอก jobId ไปยัง sublayers หากเป็น LayerGroup
            if (typeof layer.eachLayer === 'function') {
                layer.eachLayer(sub => {
                    sub.jobId = job.id;
                });
            }
            // Base Map remains read-only; standalone drawings stay editable/removable.
            if (job.properties?.is_custom_draw === true) {
                markLayerAsSurveyDrawing(layer, job.id);
            } else {
                markLayerAsBaseMap(layer);
            }
            if (isNavigating && job.id !== selectedJobId) {
                layer.on('add', () => {
                    if (typeof layer.getElement === 'function') {
                        layer.getElement()?.classList.add('dimmed-layer');
                    } else if (typeof layer.setStyle === 'function') {
                        layer.setStyle({ opacity: 0.15, fillOpacity: 0.05 });
                    } else if (typeof layer.eachLayer === 'function') {
                        layer.eachLayer(sub => {
                            if (typeof sub.getElement === 'function') {
                                sub.getElement()?.classList.add('dimmed-layer');
                            } else if (typeof sub.setStyle === 'function') {
                                sub.setStyle({ opacity: 0.15, fillOpacity: 0.05 });
                            }
                        });
                    }
                });
            }

            // Labels are attached after all layers are on the map, so they
            // can be limited to the visible viewport instead of every record.
            if (!isUnfinishedCustomDrawing) layer._visionLabelJob = job;

            layer.on('click', event => {
                // Let native Leaflet bubbling deliver one tap to the drawing
                // tool even when the tap is on top of a Base Map polygon.
                if (isMapDrawingInteractionActive()) return;

                markerJustClicked = true;
                openSheet(job);
            });
            markersGroup.addLayer(layer);
            group.addLayer(layer);

            surveyFeatures.forEach(feature => {
                const surveyLayer = createSurveyFeatureLayer(job, feature);
                if (!surveyLayer) return;
                markersGroup.addLayer(surveyLayer);
                // The child drawing must be reinitialized and brought forward only
                // after it is on the map; otherwise the Base Map polygon captures
                // the remove-tool click underneath it.
                markLayerAsSurveyDrawing(surveyLayer);
                if (typeof surveyLayer.bringToFront === 'function') surveyLayer.bringToFront();
                group.addLayer(surveyLayer);
            });
        }
    });
    if (fitBounds && filtered.length > 0) {
        try {
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        } catch (e) { }
    }
    restorePendingSurveyFeatureDrafts();
    if (!mapLabelsAreMoving) queueMapLabelRefresh(0);
    updateCounter();
}

function speak(text, force = false) {
    if (!isSpeechEnabled && !force) return;
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'th-TH';
        speechSynth.speak(u);
    }
}

// The sheet animation can briefly steal focus after a voice command. Focus
// again after it settles so the next dictated text goes directly to notes.
function focusVoiceNoteField() {
    const noteInput = document.getElementById('sheet-note');
    if (!noteInput || noteInput.disabled) return;
    noteInput.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    noteInput.focus({ preventScroll: true });
    const end = noteInput.value.length;
    noteInput.setSelectionRange?.(end, end);
}

async function startNavigationToPoint(target) {
    if (!target || !Number.isFinite(Number(target.lat)) || !Number.isFinite(Number(target.lng))) return;
    if (!userMarker) return Swal.fire('GPS ไม่พร้อม', 'กรุณาเปิดตำแหน่งก่อนเริ่มนำทาง', 'warning');
    if (isNavigating) await stopNav();

    activeNavigationTarget = {
        ...target,
        lat: Number(target.lat),
        lng: Number(target.lng),
        initialDistance: map.distance(userMarker.getLatLng(), [Number(target.lat), Number(target.lng)])
    };
    lastNavigationTarget = { ...activeNavigationTarget };
    activeRouteSummary = null;
    selectedJobId = null;
    isNavigating = true;
    if (routingControl) {
        try { map.removeControl(routingControl); } catch (error) { }
    }
    map.fitBounds(L.latLngBounds([userMarker.getLatLng(), [target.lat, target.lng]]), { padding: [100, 100] });
    document.getElementById('btn-nav-start')?.classList.add('hidden');
    document.getElementById('btn-nav-cancel')?.classList.remove('hidden');
    document.getElementById('sheet')?.classList.add('minimized');

    try {
        routingControl = L.Routing.control({
            waypoints: [userMarker.getLatLng(), L.latLng(target.lat, target.lng)],
            createMarker: () => null,
            lineOptions: { styles: [{ color: '#7c3aed', weight: 6, opacity: 0.9 }] },
            show: false,
            addWaypoints: false
        }).addTo(map);
        routingControl.on('routesfound', event => {
            activeRouteSummary = event.routes?.[0]?.summary || null;
        });
        speak(`เริ่มนำทางไป ${target.name} ระยะทางประมาณ ${formatSpokenDistance(map.distance(userMarker.getLatLng(), [target.lat, target.lng]))}`, true);
        if (navInterval) clearInterval(navInterval);
        navInterval = setInterval(async () => {
            if (!userMarker || !activeNavigationTarget) return;
            const distance = map.distance(userMarker.getLatLng(), [activeNavigationTarget.lat, activeNavigationTarget.lng]);
            if (distance <= 100) {
                const arrivedName = activeNavigationTarget.name;
                speak(`ถึง ${arrivedName} แล้ว`, true);
                await stopNav();
                removeManualTravelPin();
                Swal.fire({ toast: true, icon: 'success', title: 'ถึงจุดหมายแล้ว', timer: 2200, showConfirmButton: false });
            }
        }, 3000);
    } catch (error) {
        isNavigating = false;
        activeNavigationTarget = null;
        Swal.fire('สร้างเส้นทางไม่สำเร็จ', 'ยังเก็บหมุดไว้ คุณสามารถเปิดนำทางด้วย Google Maps ได้', 'warning');
    }
}

async function startNav() {
    if (!userMarker) return Swal.fire('GPS ไม่พร้อม', '', 'warning');
    const job = findJobById(selectedJobId);
    if (!job) return;

    // ตรวจสอบคิวความขัดแย้งการล๊อกเป้าหมายชนกัน (Concurrency lock check)
    if (supabaseClient && currentUser) {
        showLoading(true, 'กำลังตรวจสอบคิวการเดินทาง...');
        try {
            const { data, error } = await supabaseClient
                .from('plot_records')
                .select('status, navigator_id, navigator_name')
                .eq('base_plot_id', job.id)
                .eq('work_group_id', v2ActiveWorkGroup.id)
                .maybeSingle();

            if (!error && data) {
                const dbStatus = data.status;
                const dbProps = { navigator_id: data.navigator_id, navigator_name: data.navigator_name };
                if (dbStatus === 'navigating' && dbProps.navigator_id && dbProps.navigator_id !== currentUser.id) {
                    showLoading(false);
                    Swal.fire({
                        title: 'มีเพื่อนร่วมทีมกำลังเดินทางแล้ว',
                        text: `${dbProps.navigator_name || 'เพื่อนร่วมทีม'} ได้สิทธิ์เดินทางไปที่แปลงนี้ก่อนหน้าคุณแล้ว`,
                        icon: 'warning',
                        confirmButtonText: 'ตกลง'
                    });
                    // ปิดหน้าต่างและซิงค์ใหม่
                    closeSheet();
                    await syncJobsSilently();
                    return;
                }
            }
        } catch (err) {
            console.error("Concurrent navigation check failed", err);
        } finally {
            showLoading(false);
        }
    }

    viewMode = 'pin';
    document.getElementById('btn-view').innerHTML = '<i class="fa-solid fa-map-pin"></i>';

    activeNavigationTarget = {
        lat: job.lat,
        lng: job.lng,
        name: job.properties?.name || 'แปลงที่เลือก',
        type: 'plot',
        jobId: job.id,
        initialDistance: map.distance(userMarker.getLatLng(), [job.lat, job.lng])
    };
    lastNavigationTarget = { ...activeNavigationTarget };
    activeRouteSummary = null;
    isNavigating = true;
    job.prevStatus = (job.status === 'navigating') ? 'waiting' : job.status;
    job.status = 'navigating';
    if (!job.properties) job.properties = {};
    job.properties.navigator_id = currentUser.id;
    job.properties.navigator_name = currentUser.name;

    try {
        await saveJobToSupabase(job);
    } catch (e) {
        console.error("Failed to save navigation state to Supabase", e);
    }

    renderMap();
    map.fitBounds(L.latLngBounds([userMarker.getLatLng(), [job.lat, job.lng]]), { padding: [100, 100] });

    document.getElementById('btn-nav-start').classList.add('hidden');
    document.getElementById('btn-nav-cancel').classList.remove('hidden');
    document.getElementById('sheet').classList.add('minimized');

    if (routingControl) {
        try { map.removeControl(routingControl); } catch (e) { }
    }
    try {
        routingControl = L.Routing.control({
            waypoints: [userMarker.getLatLng(), L.latLng(job.lat, job.lng)],
            createMarker: () => null,
            lineOptions: { styles: [{ color: '#2563eb', weight: 6, opacity: 0.9 }] },
            show: false,
            addWaypoints: false
        }).addTo(map);
        routingControl.on('routesfound', event => {
            activeRouteSummary = event.routes?.[0]?.summary || null;
        });
        const initialDistance = map.distance(userMarker.getLatLng(), [job.lat, job.lng]);
        let distText = "";
        if (initialDistance >= 1000) {
            distText = `ระยะทางประมาณ ${(initialDistance / 1000).toFixed(1)} กิโลเมตร`;
        } else {
            distText = `ระยะทางประมาณ ${Math.round(initialDistance)} เมตร`;
        }
        speak(`เริ่มการนำทาง ${distText}`);

        if (navInterval) clearInterval(navInterval);
        let lastSpokenTime = Date.now();
        navInterval = setInterval(async () => {
            if (!userMarker) return;
            const d = map.distance(userMarker.getLatLng(), [job.lat, job.lng]);

            // Auto-switch to parcel boundaries (original view mode) if within 500 meters
            if (d < 500 && viewMode !== 'original') {
                viewMode = 'original';
                document.getElementById('btn-view').innerHTML = '<i class="fa-solid fa-map-pin"></i>';
                renderMap();
                speak("เข้าสู่ระยะห้าร้อยเมตร แสดงขอบเขตแปลงสำรวจอัตโนมัติ");
            }

            if (d < 100) {
                setVoiceOperationMode('normal', 'arrival');
                speak("ถึงที่หมายแล้ว");
                await stopNav();
                document.getElementById('sheet').classList.remove('minimized');
                document.getElementById('sheet').classList.add('active');
                Swal.fire({ toast: true, icon: 'success', title: 'ถึงแล้ว!', text: 'กรอกข้อมูลได้เลย', timer: 2000, showConfirmButton: false });
            } else {
                // Periodically speak distance (every 30 seconds)
                const now = Date.now();
                if (now - lastSpokenTime >= 30000) {
                    lastSpokenTime = now;
                    if (d >= 1000) {
                        speak(`เหลือระยะทางอีก ${(d / 1000).toFixed(1)} กิโลเมตร`);
                    } else {
                        speak(`เหลือระยะทางอีก ${Math.round(d)} เมตร`);
                    }
                }
            }
        }, 3000);
    } catch (e) { }
}

async function stopNav(skipDbSaveForJobId = null) {
    isNavigating = false;
    activeNavigationTarget = null;
    activeRouteSummary = null;
    if (routingControl) {
        try { map.removeControl(routingControl); } catch (e) { }
    }
    routingControl = null;
    if (navInterval) clearInterval(navInterval);
    document.getElementById('btn-nav-start').classList.remove('hidden');
    document.getElementById('btn-nav-cancel').classList.add('hidden');

    // Fail-safe sweep for all jobs in local memory
    if (currentUser) {
        const promises = [];
        dbJobs.forEach(j => {
            if (j.status === 'navigating' && j.properties && j.properties.navigator_id === currentUser.id) {
                if (skipDbSaveForJobId && j.id === skipDbSaveForJobId) {
                    return;
                }
                j.status = 'waiting';
                j.properties.navigator_id = null;
                j.properties.navigator_name = null;
                promises.push(saveJobToSupabase(j).catch(err => console.error("Failed to save reset state for job " + j.id, err)));
            }
        });
        if (promises.length > 0) {
            await Promise.all(promises);
        }
    }

    const job = findJobById(selectedJobId);
    if (job && (!skipDbSaveForJobId || job.id !== skipDbSaveForJobId)) {
        let targetStatus = job.prevStatus || 'waiting';
        if (targetStatus === 'navigating') {
            targetStatus = 'waiting';
        }
        job.status = targetStatus;
        if (!job.properties) job.properties = {};
        job.properties.navigator_id = null;
        job.properties.navigator_name = null;
        try {
            await saveJobToSupabase(job);
        } catch (e) {
            console.error("Failed to save stop navigation state to Supabase", e);
        }
    }
    renderMap();
}

function renderInlineRawData(job) {
    const container = document.getElementById('inline-raw-data');
    if (!container || !job) return;
    const basePlot = (typeof v2BasePlots !== 'undefined') ? v2BasePlots.find(plot => plot.id === job.id) : null;
    const rawProperties = basePlot?.source_properties || job.properties || {};
    const entries = Object.entries(rawProperties);
    if (entries.length === 0) {
        container.innerHTML = '<div class="p-3 text-xs text-gray-400">ไม่มีข้อมูลดิบ</div>';
        return;
    }
    container.innerHTML = `<table class="w-full text-[11px] border-collapse"><tbody>${entries.map(([key, value], index) => {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
            try { displayValue = JSON.stringify(value); } catch (error) { displayValue = String(value); }
        }
        return `<tr class="${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-100">
            <td class="w-[38%] px-3 py-2 align-top font-bold text-gray-600 break-words">${v2EscapeHtml(key)}</td>
            <td class="px-3 py-2 align-top text-gray-800 break-words select-text">${v2EscapeHtml(displayValue ?? '-')}</td>
        </tr>`;
    }).join('')}</tbody></table>`;
}

function renderDynamicSurveyForm(job) {
    const section = document.getElementById('dynamic-form-section');
    const container = document.getElementById('dynamic-form-fields');
    const form = getActiveSurveyForm();
    const fields = Array.isArray(form?.fields) ? [...form.fields].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) : [];
    if (!section || !container) return;
    if (!fields.length) {
        section.classList.remove('hidden');
        container.innerHTML = form
            ? '<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">แบบฟอร์มนี้ยังไม่มีช่องกรอกเพิ่มเติม คุณยังบันทึกสถานะ หมายเหตุ รูปถ่าย และพิกัดได้ตามปกติ</div>'
            : '<div class="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800"><b>ยังไม่ได้สร้างแบบฟอร์มบันทึกข้อมูล</b><p class="mt-1 text-[10px] text-violet-700">หากต้องการช่องกรอกข้อมูลเพิ่มเติมหรือ Dropdown ให้สร้างแบบฟอร์มสำหรับกลุ่มงานนี้</p><button type="button" onclick="openSurveyFormBuilderFromSheet()" class="mt-2 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[10px] font-bold text-white"><i class="fa-solid fa-table-list mr-1"></i>สร้างแบบฟอร์ม</button></div>';
        return;
    }
    section.classList.remove('hidden');
    const values = job.properties?.form_data || {};
    container.innerHTML = fields.map(field => {
        const fieldType = normalizeSurveyFieldType(field.type);
        const hasSavedValue = Object.prototype.hasOwnProperty.call(values, field.key);
        const mappedValue = hasSavedValue ? undefined : getMappedBaseMapValue(job, field);
        const value = hasSavedValue ? values[field.key] : (mappedValue ?? '');
        const common = `data-form-key="${v2EscapeHtml(field.key)}" data-form-label="${v2EscapeHtml(field.label)}" class="dynamic-form-input w-full p-3 border border-gray-300 rounded-xl bg-white outline-none focus:border-violet-500"`;
        const fieldOptions = normalizeSurveyFieldOptions(field.options);
        const mappedOptions = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
        mappedOptions.filter(Boolean).forEach(option => {
            if (!fieldOptions.some(item => item.id === option)) fieldOptions.push({ id: option, label: surveyOptionLabel(field, option), active: false });
        });
        const visibleOptions = fieldOptions.filter(option => option.active || mappedOptions.includes(option.id));
        const options = visibleOptions.map(option => `<option value="${v2EscapeHtml(option.id)}" ${String(value) === String(option.id) ? 'selected' : ''}>${v2EscapeHtml(option.label)}${option.active ? '' : ' (ค่าเดิม)'}</option>`).join('');
        let input;
        if (fieldType === 'textarea') {
            input = `<textarea ${common} rows="3" placeholder="${v2EscapeHtml(field.placeholder || '')}">${v2EscapeHtml(value || '')}</textarea>`;
        } else if (fieldType === 'select') {
            input = `<select ${common}><option value="">-- เลือก --</option>${options}</select>`;
        } else if (fieldType === 'multiselect') {
            const selected = Array.isArray(value) ? value.map(String) : [];
            input = `<select ${common} multiple size="${Math.min(5, Math.max(3, visibleOptions.length))}">${visibleOptions.map(option => `<option value="${v2EscapeHtml(option.id)}" ${selected.includes(String(option.id)) ? 'selected' : ''}>${v2EscapeHtml(option.label)}${option.active ? '' : ' (ค่าเดิม)'}</option>`).join('')}</select>`;
        } else if (fieldType === 'checkbox') {
            input = `<label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white"><input type="checkbox" ${common} style="width:22px;height:22px" ${value === true ? 'checked' : ''}><span class="text-sm text-gray-700">ใช่</span></label>`;
        } else {
            const htmlType = fieldType === 'datetime' ? 'datetime-local' : (['number', 'date', 'time'].includes(fieldType) ? fieldType : 'text');
            input = `<input type="${htmlType}" ${common} value="${v2EscapeHtml(value ?? '')}" placeholder="${v2EscapeHtml(field.placeholder || '')}">`;
        }
        const sourceHint = field.source_key
            ? `<div class="text-[9px] mt-1 ${mappedValue !== undefined ? 'text-violet-600' : 'text-amber-600'}"><i class="fa-solid fa-database mr-1"></i>${mappedValue !== undefined ? `เติมจาก Base Map: ${v2EscapeHtml(field.source_key)}` : `ไม่พบค่าใน Base Map: ${v2EscapeHtml(field.source_key)}`}</div>`
            : '';
        return `<div><label class="text-xs font-bold text-gray-600 ml-1 mb-1 block">${v2EscapeHtml(field.label)}${field.required ? ' <span class="text-red-500">*</span>' : ''}</label>${input}${sourceHint}</div>`;
    }).join('');
    container.querySelectorAll('.dynamic-form-input').forEach(input => input.addEventListener('input', updateDynamicFormProgress));
    updateDynamicFormProgress();
}

function collectDynamicSurveyForm() {
    const form = getActiveSurveyForm();
    const fields = Array.isArray(form?.fields) ? form.fields : [];
    const values = {};
    const missing = [];
    document.querySelectorAll('#dynamic-form-fields .dynamic-form-input').forEach(input => {
        let value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.multiple) value = Array.from(input.selectedOptions).map(option => option.value);
        else if (input.type === 'number') value = input.value === '' ? '' : Number(input.value);
        else value = input.value;
        values[input.dataset.formKey] = value;
    });
    fields.forEach(field => {
        const value = values[field.key];
        const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
        if (field.required && empty) missing.push(field.label);
    });
    return { values, missing, version: form?.version || 0, schema: JSON.parse(JSON.stringify(fields)) };
}

function updateDynamicFormProgress() {
    const progress = document.getElementById('dynamic-form-progress');
    const form = getActiveSurveyForm();
    const fields = Array.isArray(form?.fields) ? form.fields : [];
    if (!progress) return;
    const { values } = collectDynamicSurveyForm();
    const completed = fields.filter(field => {
        const value = values[field.key];
        return value === true || (Array.isArray(value) ? value.length > 0 : value !== '' && value !== null && value !== undefined);
    }).length;
    progress.textContent = `${completed}/${fields.length}`;
}

function openSheet(job) {
    if (isMapClickBlocked) return;
    if (justDeletedJobId && job.id === justDeletedJobId) return;

    selectedJobId = job.id;
    lastSelectedJobId = job.id;
    window.imagesToDeleteFromCloud = [];
    window.originalImagesBackup = job.properties.images ? JSON.parse(JSON.stringify(job.properties.images)) : [];

    const p = job.properties;
    const surveyFeatureCount = Array.isArray(p.survey_features) ? p.survey_features.length : 0;
    document.getElementById('sheet-title').innerText = p.name || 'รายละเอียด';
    const childLabel = p.is_custom_draw === true ? 'รายการย่อย' : 'รูปวาด';
    document.getElementById('sheet-meta').innerText = `${p.amphoe || p.AMPH_NAME || '-'} / ${p.tambon || p.TUMB_NAME || '-'} · ${childLabel} ${surveyFeatureCount}`;
    document.getElementById('sheet-name').value = p.name || '';
    document.getElementById('sheet-note').value = p.note || '';
    renderInlineRawData(job);
    renderDynamicSurveyForm(job);
    renderSurveyFeatureList(job);

    if (document.getElementById('sheet-area')) {
        document.getElementById('sheet-area').value = p.area || '-';
    }
    if (document.getElementById('sheet-source')) {
        document.getElementById('sheet-source').value = p.import_source || '-';
    }

    const btnSave = document.getElementById('btn-save');
    const btnEdit = document.getElementById('btn-edit');
    const btnNavStart = document.getElementById('btn-nav-start');
    const btnNavCancel = document.getElementById('btn-nav-cancel');
    const btnDelete = document.getElementById('btn-delete-job');
    const navWarning = document.getElementById('sheet-nav-warning');
    const navWarningText = document.getElementById('sheet-nav-warning-text');

    const isNavByOther = job.status === 'navigating' && p.navigator_id && p.navigator_id !== currentUser.id;
    const isDone = job.status === 'done';
    const isTemp = p && p.is_temp === true;

    if (isNavByOther) {
        // Locked by another user
        if (navWarning && navWarningText) {
            navWarningText.innerText = `🔴 ${p.navigator_name || 'เพื่อนร่วมทีม'} กำลังนำทางไปยังแปลงนี้ (ไม่อนุญาตให้แก้ไข/เลือก)`;
            navWarning.classList.remove('hidden');
        }
        btnNavStart.classList.add('hidden');
        btnNavCancel.classList.add('hidden');
        btnSave.classList.add('hidden');
        btnEdit.classList.add('hidden');
        if (btnDelete) btnDelete.classList.add('hidden');
        toggleInputs(false);
        renderImageGallery(p.images || [], false);
    } else if (isTemp) {
        if (navWarning) navWarning.classList.add('hidden');
        btnNavStart.classList.add('hidden');
        btnNavCancel.classList.add('hidden');
        btnSave.classList.remove('hidden');
        btnEdit.classList.add('hidden');
        if (btnDelete) {
            btnDelete.classList.remove('hidden');
            btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ยกเลิกการวาด / ลบ';
            btnDelete.className = 'w-full bg-red-600 text-white py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2 hover:bg-red-700 transition duration-200';
        }
        toggleInputs(true);
        renderImageGallery(p.images || [], true);
    } else {
        // Not locked by others
        if (navWarning) navWarning.classList.add('hidden');

        // Hide delete button if it's not done (i.e. waiting/navigating) and not custom draw (custom draw is always status=done but deletable)
        if (btnDelete) {
            if (isDone || (p && p.is_custom_draw)) {
                btnDelete.classList.remove('hidden');
                // Customize label and styling for custom draw
                if (p && p.is_custom_draw) {
                    btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ลบข้อมูลรูปแปลง/หมุด';
                    btnDelete.className = 'w-full bg-red-600 text-white py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2 hover:bg-red-700 transition duration-200';
                } else {
                    btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ลบรายการนี้';
                    btnDelete.className = 'w-full bg-red-50 text-red-500 py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2';
                }
            } else {
                btnDelete.classList.add('hidden');
            }
        }

        if (isDone) {
            btnSave.classList.add('hidden');
            btnEdit.classList.remove('hidden');
            btnNavStart.classList.add('hidden');
            btnNavCancel.classList.add('hidden');
            toggleInputs(false);
            renderImageGallery(p.images || [], false);
        } else {
            btnSave.classList.remove('hidden');
            btnEdit.classList.add('hidden');

            const isNavByMe = isNavigating && job.id === selectedJobId;
            if (isNavByMe) {
                btnNavStart.classList.add('hidden');
                btnNavCancel.classList.remove('hidden');
            } else {
                btnNavStart.classList.remove('hidden');
                btnNavCancel.classList.add('hidden');
            }

            toggleInputs(true);
            renderImageGallery(p.images || [], true);
        }
    }

    document.getElementById('fab-container').classList.add('sheet-open');
    document.getElementById('map').classList.add('sheet-open');
    const sheet = document.getElementById('sheet');
    sheet.classList.remove('minimized');
    sheet.classList.add('active');
    sheet.style.transform = '';

    if (!isNavigating) map.flyTo([job.lat, job.lng], Math.max(map.getZoom(), 16));
}

function toggleInputs(enabled) {
    document.getElementById('sheet-name').disabled = !enabled;
    document.getElementById('sheet-note').disabled = !enabled;

    const btnCamera = document.getElementById('btn-camera');
    if (btnCamera) btnCamera.disabled = !enabled;
    document.querySelectorAll('#dynamic-form-fields .dynamic-form-input').forEach(input => { input.disabled = !enabled; });
}

function openSheetSilently(job) {
    const p = job.properties;
    const surveyFeatureCount = Array.isArray(p.survey_features) ? p.survey_features.length : 0;
    document.getElementById('sheet-title').innerText = p.name || 'รายละเอียด';
    const childLabel = p.is_custom_draw === true ? 'รายการย่อย' : 'รูปวาด';
    document.getElementById('sheet-meta').innerText = `${p.amphoe || p.AMPH_NAME || '-'} / ${p.tambon || p.TUMB_NAME || '-'} · ${childLabel} ${surveyFeatureCount}`;

    const nameEl = document.getElementById('sheet-name');
    const noteEl = document.getElementById('sheet-note');
    if (document.activeElement !== nameEl) nameEl.value = p.name || '';
    if (document.activeElement !== noteEl) noteEl.value = p.note || '';
    renderInlineRawData(job);
    renderDynamicSurveyForm(job);
    renderSurveyFeatureList(job);

    if (document.getElementById('sheet-area')) {
        document.getElementById('sheet-area').value = p.area || '-';
    }

    const btnSave = document.getElementById('btn-save');
    const btnEdit = document.getElementById('btn-edit');
    const btnNavStart = document.getElementById('btn-nav-start');
    const btnNavCancel = document.getElementById('btn-nav-cancel');
    const btnDelete = document.getElementById('btn-delete-job');
    const navWarning = document.getElementById('sheet-nav-warning');
    const navWarningText = document.getElementById('sheet-nav-warning-text');

    const isNavByOther = job.status === 'navigating' && p.navigator_id && p.navigator_id !== currentUser.id;
    const isDone = job.status === 'done';
    const isTemp = p && p.is_temp === true;

    if (isNavByOther) {
        if (navWarning && navWarningText) {
            navWarningText.innerText = `🔴 ${p.navigator_name || 'เพื่อนร่วมทีม'} กำลังนำทางไปยังแปลงนี้ (ไม่อนุญาตให้แก้ไข/เลือก)`;
            navWarning.classList.remove('hidden');
        }
        btnNavStart.classList.add('hidden');
        btnNavCancel.classList.add('hidden');
        btnSave.classList.add('hidden');
        btnEdit.classList.add('hidden');
        if (btnDelete) btnDelete.classList.add('hidden');
        toggleInputs(false);
        renderImageGallery(p.images || [], false);
    } else if (isTemp) {
        if (navWarning) navWarning.classList.add('hidden');
        btnNavStart.classList.add('hidden');
        btnNavCancel.classList.add('hidden');
        btnSave.classList.remove('hidden');
        btnEdit.classList.add('hidden');
        if (btnDelete) {
            btnDelete.classList.remove('hidden');
            btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ยกเลิกการวาด / ลบ';
            btnDelete.className = 'w-full bg-red-600 text-white py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2 hover:bg-red-700 transition duration-200';
        }
        toggleInputs(true);
        renderImageGallery(p.images || [], true);
    } else {
        if (navWarning) navWarning.classList.add('hidden');

        if (btnDelete) {
            btnDelete.classList.remove('hidden');
            if (p && p.is_custom_draw) {
                btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ลบข้อมูลรูปแปลง/หมุด';
                btnDelete.className = 'w-full bg-red-600 text-white py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2 hover:bg-red-700 transition duration-200';
            } else {
                btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ลบรายการนี้';
                btnDelete.className = 'w-full bg-red-50 text-red-500 py-3 rounded-xl text-sm font-bold mt-2 flex items-center justify-center gap-2';
            }
        }

        if (isDone) {
            btnSave.classList.add('hidden');
            btnEdit.classList.remove('hidden');
            btnNavStart.classList.add('hidden');
            btnNavCancel.classList.add('hidden');
            toggleInputs(false);
            renderImageGallery(p.images || [], false);
        } else {
            btnSave.classList.remove('hidden');
            btnEdit.classList.add('hidden');

            const isNavByMe = isNavigating && job.id === selectedJobId;
            if (isNavByMe) {
                btnNavStart.classList.add('hidden');
                btnNavCancel.classList.remove('hidden');
            } else {
                btnNavStart.classList.remove('hidden');
                btnNavCancel.classList.add('hidden');
            }

            toggleInputs(true);
            renderImageGallery(p.images || [], true);
        }
    }
}

function enableEdit() {
    toggleInputs(true);
    document.getElementById('btn-save').classList.remove('hidden');
    document.getElementById('btn-edit').classList.add('hidden');

    const job = findJobById(selectedJobId);
    if (job) {
        window.imagesToDeleteFromCloud = [];
        window.originalImagesBackup = job.properties.images ? JSON.parse(JSON.stringify(job.properties.images)) : [];
        const images = job.properties.images || [];
        renderImageGallery(images, true);
    }
}

async function closeSheet(e, { preserveSavedState = false } = {}) {
    if (e) e.stopPropagation();

    // Only the explicit close button returns to a search list opened from its
    // “details” action. Map taps and save flows keep their existing behavior.
    const shouldRestoreSearch = Boolean(e && restoreSearchAfterSheet);
    restoreSearchAfterSheet = false;

    if (selectedJobId) {
        const job = findJobById(selectedJobId);
        if (job) {
            const btnSave = document.getElementById('btn-save');
            const isEditing = btnSave && !btnSave.classList.contains('hidden');
            // Closing with the X discards an unfinished edit.  A successful
            // save also closes this sheet, but must retain the freshly uploaded
            // image list in memory so re-opening the marker/drawing shows it.
            if (!preserveSavedState && isEditing && window.originalImagesBackup) {
                if (job.properties.images) {
                    job.properties.images.forEach(img => {
                        if (img && img.isTemp && img.url && img.url.startsWith('blob:')) {
                            URL.revokeObjectURL(img.url);
                        }
                    });
                }
                job.properties.images = JSON.parse(JSON.stringify(window.originalImagesBackup));
            }
        }
    }

    document.getElementById('sheet').classList.remove('active');
    document.getElementById('sheet').classList.remove('minimized');
    document.getElementById('fab-container').classList.remove('sheet-open');
    document.getElementById('map').classList.remove('sheet-open');
    if (isNavigating) stopNav();
    selectedJobId = null;
    window.imagesToDeleteFromCloud = [];
    window.originalImagesBackup = [];

    // Clear UI inputs when closing sheet
    document.getElementById('sheet-name').value = '';
    document.getElementById('sheet-note').value = '';
    const inlineRawData = document.getElementById('inline-raw-data');
    if (inlineRawData) inlineRawData.innerHTML = '';
    const dynamicFields = document.getElementById('dynamic-form-fields');
    const dynamicSection = document.getElementById('dynamic-form-section');
    if (dynamicFields) dynamicFields.innerHTML = '';
    if (dynamicSection) dynamicSection.classList.add('hidden');
    renderImageGallery([], false);

    if (shouldRestoreSearch) {
        window.setTimeout(() => {
            const input = document.getElementById('inp-search');
            if (input?.value.trim()) doSearch();
        }, 120);
    }
}


function toggleSheetSize() {
    document.getElementById('sheet').classList.toggle('minimized');
}

async function findNearestNewJob() {
    if (!userMarker) return Swal.fire('รอ GPS', '', 'info');

    if (isNavigating) {
        const result = await Swal.fire({
            title: 'ยกเลิกเส้นทางเดิม?',
            text: 'คุณกำลังนำทางอยู่ ต้องการยกเลิกเส้นทางเดิมเพื่อค้นหาและนำทางไปยังแปลงที่อยู่ใกล้ที่สุดใหม่หรือไม่?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'ยกเลิกเส้นทางเดิม',
            cancelButtonText: 'นำทางต่อ',
            allowOutsideClick: false
        });
        if (!result.isConfirmed) {
            return;
        }
        await stopNav();
    }

    const filteredJobs = getFilteredJobs().filter(j => j.status !== 'done' && j.status !== 'navigating' && j.id !== selectedJobId);
    if (filteredJobs.length === 0) return Swal.fire('ยอดเยี่ยม', 'ไม่มีงานค้างในพื้นที่นี้', 'success');
    let min = Infinity, near = null;
    const u = userMarker.getLatLng();
    filteredJobs.forEach(j => {
        const lat = Number(j.lat);
        const lng = Number(j.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
            const d = map.distance(u, L.latLng(lat, lng));
            if (d < min) { min = d; near = j; }
        }
    });
    if (near) {
        openSheet(near);
        await startNav();
    }
}

function viewJsonData() {
    const job = findJobById(selectedJobId);
    if (!job) return;

    const sheet = document.getElementById('sheet');
    const fabContainer = document.getElementById('fab-container');
    const wasMinimized = sheet.classList.contains('minimized');
    const wasActive = sheet.classList.contains('active');

    // Slide details sheet out of view completely & lower z-index so it doesn't overlay Swal modal
    sheet.classList.remove('active');
    sheet.style.zIndex = '1000';
    if (fabContainer) fabContainer.classList.remove('sheet-open');

    let html = '<div id="swal-raw-data-container" class="text-left text-xs max-h-[60vh] overflow-y-auto"><table class="w-full border-collapse border border-gray-200 rounded-xl overflow-hidden">';
    Object.keys(job.properties).sort().forEach(key => {
            const value = typeof job.properties[key] === 'object' ? JSON.stringify(job.properties[key]) : job.properties[key];
            html += `
                        <tr class="border-b border-gray-150 hover:bg-gray-50">
                            <td class="font-bold p-2.5 text-gray-500 bg-gray-100/50 w-1/3 border-r border-gray-150">${v2EscapeHtml(key)}</td>
                            <td class="p-2.5 text-gray-800 break-all">${v2EscapeHtml(value !== undefined && value !== null ? value : '-')}</td>
                        </tr>
                    `;
    });
    html += '</table></div>';

    Swal.fire({
        title: 'ข้อมูลต้นฉบับ (ทั้งหมด)',
        html: html,
        width: '90%',
        confirmButtonText: 'ปิด',
        confirmButtonColor: '#4b5563',
        allowOutsideClick: false,
        didClose: () => {
            stopReadingSequence();
        }
    }).then(() => {
        // Restore sheet state and default z-index
        sheet.style.zIndex = '';
        if (wasActive) {
            sheet.classList.add('active');
            if (fabContainer) fabContainer.classList.add('sheet-open');
        }
        if (wasMinimized) {
            sheet.classList.add('minimized');
        } else {
            sheet.classList.remove('minimized');
        }
    });
}

let tempImportFeatures = [];
let onConfirmImportCallback = null;

function toggleImportCategoryInput() {
    const select = document.getElementById('import-category-select');
    const input = document.getElementById('import-category-custom');
    if (select && input) {
        if (select.value === 'CUSTOM_NEW') {
            input.classList.remove('hidden');
            input.focus();
        } else {
            input.classList.add('hidden');
        }
    }
}
window.toggleImportCategoryInput = toggleImportCategoryInput;

async function deleteImportCategory() {
    const select = document.getElementById('import-category-select');
    if (!select) return;
    const catToDelete = select.value;

    if (catToDelete === 'CUSTOM_NEW') {
        Swal.fire('แจ้งเตือน', 'ไม่สามารถลบตัวเลือกประเภทงานใหม่ได้', 'warning');
        return;
    }
    if (['ทั่วไป', 'ตรวจสอบ', 'เร่งด่วน'].includes(catToDelete)) {
        Swal.fire('แจ้งเตือน', `ไม่สามารถลบประเภทงานเริ่มต้น "${catToDelete}" ได้`, 'warning');
        return;
    }

    // Check if there are maps/jobs in dbJobs with this category
    const inUse = dbJobs.some(j => j.category === catToDelete);
    if (inUse) {
        Swal.fire({
            icon: 'error',
            title: 'ไม่สามารถลบได้',
            text: `ประเภทงาน "${catToDelete}" มีแปลงแผนที่นำเข้าใช้อยู่ในระบบ กรุณาลบข้อมูลแผนที่นำเข้าประเภทนี้ออกก่อนลบประเภทงาน`,
            confirmButtonText: 'ตกลง',
            confirmButtonColor: '#ef4444'
        });
        return;
    }

    // Confirm delete
    const result = await Swal.fire({
        title: 'ยืนยันการลบประเภทงาน?',
        text: `คุณต้องการลบประเภทงาน "${catToDelete}" ออกจากรายการตัวเลือกตัวเลือกลิสต์ใช่หรือไม่?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ลบข้อมูล',
        cancelButtonText: 'ยกเลิก'
    });

    if (!result.isConfirmed) return;

    // Delete from categories
    categories = categories.filter(c => c !== catToDelete);
    localStorage.setItem('survey_cats_v16', JSON.stringify(categories));

    // Re-populate import mapping category list
    const catSelect = document.getElementById('import-category-select');
    if (catSelect) {
        catSelect.innerHTML = '';
        categories.forEach(cat => {
            catSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
        catSelect.innerHTML += '<option value="CUSTOM_NEW">-- พิมพ์ระบุประเภทงานใหม่ --</option>';
        catSelect.value = categories[0] || 'ทั่วไป';
        toggleImportCategoryInput();
    }

    // Update profile UI because active category selection list could have changed
    updateUserInfo();

    Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `ลบประเภทงาน "${catToDelete}" สำเร็จ`,
        timer: 1500,
        showConfirmButton: false
    });
}
window.deleteImportCategory = deleteImportCategory;


function toggleProfileCategoryInput() {
    const select = document.getElementById('sel-profile-category');
    const input = document.getElementById('inp-profile-category');
    if (select && input) {
        if (select.value === 'CUSTOM_NEW') {
            input.classList.remove('hidden');
            input.focus();
        } else {
            input.classList.add('hidden');
        }
    }
}
window.toggleProfileCategoryInput = toggleProfileCategoryInput;

function showFieldMapping(feats, onConfirm) {
    closeSettingsModal();
    tempImportFeatures = feats;
    onConfirmImportCallback = onConfirm;

    // Extract all keys
    const allKeys = new Set();
    feats.forEach(f => {
        const p = f.properties || f;
        Object.keys(p).forEach(k => {
            if (typeof p[k] !== 'object') allKeys.add(k);
        });
    });
    const keysArray = Array.from(allKeys).sort();

    const fields = ['id', 'search', 'amphoe', 'tambon', 'area', 'note', 'status'];
    fields.forEach(f => {
        const select = document.getElementById(`map-field-${f}`);
        if (select) {
            select.innerHTML = '<option value="">-- ไม่ระบุ (ข้าม) --</option>';
            keysArray.forEach(k => {
                select.innerHTML += `<option value="${k}">${k}</option>`;
            });
        }
    });

    // Populate category select dropdown
    const catSelect = document.getElementById('import-category-select');
    if (catSelect) {
        catSelect.innerHTML = '';
        categories.forEach(cat => {
            catSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
        catSelect.innerHTML += '<option value="CUSTOM_NEW">-- พิมพ์ระบุประเภทงานใหม่ --</option>';
        catSelect.value = currentUser.category || categories[0] || 'ทั่วไป';
    }

    const customInput = document.getElementById('import-category-custom');
    if (customInput) {
        customInput.value = '';
        customInput.classList.add('hidden');
    }

    // Set default selections
    const idSel = document.getElementById('map-field-id');
    const searchSel = document.getElementById('map-field-search');
    const amphoeSel = document.getElementById('map-field-amphoe');
    const tambonSel = document.getElementById('map-field-tambon');
    const areaSel = document.getElementById('map-field-area');
    const noteSel = document.getElementById('map-field-note');
    const statusSel = document.getElementById('map-field-status');

    // Reset values first
    if (idSel) idSel.value = "";
    if (searchSel) searchSel.value = "";
    if (amphoeSel) amphoeSel.value = "";
    if (tambonSel) tambonSel.value = "";
    if (areaSel) areaSel.value = "";
    if (noteSel) noteSel.value = "";
    if (statusSel) statusSel.value = "";

    // Auto-detect best match
    keysArray.forEach(k => {
        const lower = k.toLowerCase();
        if (idSel && !idSel.value && (lower.includes('id') || lower.includes('reg') || lower.includes('name') || lower.includes('ทะเบียน'))) {
            idSel.value = k;
        }
        if (searchSel && !searchSel.value && (lower.includes('name') || lower.includes('desc') || lower.includes('remark') || lower.includes('ชื่อ') || lower.includes('หมายเหตุ'))) {
            searchSel.value = k;
        }
        if (amphoeSel && !amphoeSel.value && (lower.includes('amphoe') || lower.includes('amp') || lower.includes('อ.') || lower.includes('อำเภอ'))) {
            amphoeSel.value = k;
        }
        if (tambonSel && !tambonSel.value && (lower.includes('tambon') || lower.includes('tum') || lower.includes('ต.') || lower.includes('ตำบล'))) {
            tambonSel.value = k;
        }
        if (areaSel && !areaSel.value && (lower.includes('area') || lower.includes('size') || lower.includes('rai') || lower.includes('เนื้อที่'))) {
            areaSel.value = k;
        }
        if (noteSel && !noteSel.value && (lower.includes('note') || lower.includes('remark') || lower.includes('ข้อความ') || lower.includes('รายละเอียด') || lower.includes('comment'))) {
            noteSel.value = k;
        }
        if (statusSel && !statusSel.value && (lower.includes('status') || lower.includes('state') || lower.includes('สถานะ'))) {
            statusSel.value = k;
        }
    });

    // Show modal
    document.getElementById('import-mapping-modal').classList.add('active');
}

function closeImportMappingModal() {
    document.getElementById('import-mapping-modal').classList.remove('active');
    tempImportFeatures = [];
    onConfirmImportCallback = null;
}

// Set up Event Listener for Confirm Import
if (document.getElementById('btn-confirm-import')) {
    document.getElementById('btn-confirm-import').onclick = async () => {
        const mappedId = document.getElementById('map-field-id').value;
        const mappedSearch = document.getElementById('map-field-search').value;
        const mappedAmphoe = document.getElementById('map-field-amphoe').value;
        const mappedTambon = document.getElementById('map-field-tambon').value;
        const mappedArea = document.getElementById('map-field-area').value;
        const mappedNote = document.getElementById('map-field-note').value;
        const mappedStatus = document.getElementById('map-field-status').value;

        // Retrieve and validate selected category
        const chosenCategorySelect = document.getElementById('import-category-select').value;
        const chosenCategoryCustom = document.getElementById('import-category-custom').value.trim();
        let targetCategory = chosenCategorySelect;
        if (chosenCategorySelect === 'CUSTOM_NEW') {
            if (!chosenCategoryCustom) {
                Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุประเภทงานใหม่', 'warning');
                return;
            }
            targetCategory = chosenCategoryCustom;
        }

        // Add custom category to system list if it is new
        if (targetCategory && !categories.includes(targetCategory)) {
            categories.push(targetCategory);
            localStorage.setItem('survey_cats_v16', JSON.stringify(categories));
        }

        document.getElementById('import-mapping-modal').classList.remove('active');

        if (onConfirmImportCallback) {
            await onConfirmImportCallback({
                idKey: mappedId,
                searchKey: mappedSearch,
                amphoeKey: mappedAmphoe,
                tambonKey: mappedTambon,
                areaKey: mappedArea,
                noteKey: mappedNote,
                statusKey: mappedStatus,
                targetCategory: targetCategory
            });
        }
    };
}

async function importData(input) {
    const file = input.files[0];
    if (!file) return;
    showLoading(true, 'กำลังอ่านไฟล์และนำเข้า...');
    const r = new FileReader();
    r.onload = async (e) => {
        try {
            let raw = e.target.result.trim();
            if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
            const json = JSON.parse(raw);
            let feats = (json.type === "FeatureCollection") ? json.features : (Array.isArray(json) ? json : [json]);

            showLoading(false);
            showFieldMapping(feats, async (mapping) => {
                showLoading(true, `กำลังเขียน ${feats.length} รายการลงคลาวด์ Supabase...`);
                let count = 0;
                for (let f of feats) {
                    const p = f.properties || f;
                    let geom = f.geometry;
                    if (!geom && (f.lat || p.lat)) geom = { type: 'Point', coordinates: [parseFloat(f.lng || p.lng), parseFloat(f.lat || p.lat)] };
                    if (!geom) continue;
                    let lat, lng;
                    if (geom.type === 'Point') {
                        lng = geom.coordinates[0];
                        lat = geom.coordinates[1];
                    } else {
                        try {
                            const l = L.geoJSON(geom);
                            const c = l.getBounds().getCenter();
                            lat = c.lat;
                            lng = c.lng;
                        } catch (err) {
                            continue;
                        }
                    }

                    const idRaw = mapping.idKey && p[mapping.idKey] !== undefined && p[mapping.idKey] !== null ? p[mapping.idKey] : '';
                    const idValue = idRaw.toString().trim();
                    const nameVal = idValue || 'นำเข้า';
                    const searchVal = mapping.searchKey && p[mapping.searchKey] !== undefined && p[mapping.searchKey] !== null ? p[mapping.searchKey].toString().trim() : '';
                    const amphoeVal = mapping.amphoeKey && p[mapping.amphoeKey] !== undefined && p[mapping.amphoeKey] !== null ? p[mapping.amphoeKey].toString().trim() : '';
                    const tambonVal = mapping.tambonKey && p[mapping.tambonKey] !== undefined && p[mapping.tambonKey] !== null ? p[mapping.tambonKey].toString().trim() : '';
                    const areaVal = mapping.areaKey && p[mapping.areaKey] !== undefined && p[mapping.areaKey] !== null ? p[mapping.areaKey].toString().trim() : '';
                    const noteVal = mapping.noteKey && p[mapping.noteKey] !== undefined && p[mapping.noteKey] !== null ? p[mapping.noteKey].toString().trim() : '';
                    const statusVal = mapping.statusKey && p[mapping.statusKey] !== undefined && p[mapping.statusKey] !== null ? p[mapping.statusKey].toString().trim() : '';

                    // Check duplicate first to keep status/notes/photos if already exists
                    const cleanSource = (file.name || 'อัปโหลดไฟล์').replace(/[^a-zA-Z0-9_\u0e00-\u0e7f]/g, '_');
                    const targetCategory = mapping.targetCategory || currentUser.category || 'ทั่วไป';
                    const finalId = targetCategory + '_' + cleanSource + '_' + (idValue || 'IMP_' + Math.random().toString(36).substr(2, 9));
                    const existing = dbJobs.find(x => x.id === finalId);

                    let finalStatus = 'waiting';
                    if (statusVal) {
                        const s = statusVal.toLowerCase();
                        if (s === 'done' || s === 'เสร็จสิ้น' || s === 'เสร็จ' || s === 'สำเร็จ' || s === '1' || s === 'yes' || s === 'true') {
                            finalStatus = 'done';
                        } else if (s === 'checking' || s === 'ตรวจสอบ') {
                            finalStatus = 'checking';
                        } else {
                            finalStatus = 'waiting';
                        }
                    } else if (existing) {
                        finalStatus = existing.status;
                    } else if (noteVal) {
                        finalStatus = 'done';
                    }

                    const finalNote = noteVal || (existing ? existing.properties.note : (p.REMARK || p.note || ''));

                    let finalDate = existing && existing.properties.date ? existing.properties.date : '';
                    if (finalStatus === 'done' && !finalDate) {
                        finalDate = new Date().toISOString().split('T')[0];
                    }

                    const job = {
                        id: finalId,
                        lat,
                        lng,
                        geometry: geom,
                        status: finalStatus,
                        category: mapping.targetCategory || currentUser.category || 'ทั่วไป',
                        properties: {
                            ...p,
                            name: nameVal,
                            import_source: file.name || 'อัปโหลดไฟล์',
                            note: finalNote,
                            images: existing ? existing.properties.images : [],
                            search_field: searchVal,
                            amphoe: amphoeVal,
                            tambon: tambonVal,
                            area: areaVal,
                            date: finalDate
                        }
                    };
                    await saveJobToSupabase(job);
                    count++;
                }

                // Update active category
                const targetCategory = mapping.targetCategory || currentUser.category || 'ทั่วไป';
                currentUser.category = targetCategory;
                localStorage.setItem('survey_current_cat', targetCategory);

                // Update category lists in memory
                if (targetCategory && !categories.includes(targetCategory)) {
                    categories.push(targetCategory);
                    localStorage.setItem('survey_cats_v16', JSON.stringify(categories));
                }

                // Prefill the profile category input
                const inpProfileCat = document.getElementById('inp-profile-category');
                if (inpProfileCat) inpProfileCat.value = targetCategory;

                Swal.fire('สำเร็จ', `นำเข้าแปลงที่ดินสำเร็จ ${count} รายการ`, 'success');
                await syncJobsFromDB();
            });
        } catch (err) {
            Swal.fire('เกิดข้อผิดพลาดในการโหลดไฟล์', err.message, 'error');
        } finally {
            showLoading(false);
        }
    };
    r.readAsText(file);
    input.value = '';
}

async function saveData() {
    const job = findJobById(selectedJobId);
    if (!job) return;

    const dynamicForm = collectDynamicSurveyForm();
    if (dynamicForm.missing.length) {
        return Swal.fire('กรอกข้อมูลไม่ครบ', `กรุณากรอกช่องที่จำเป็น: ${dynamicForm.missing.join(', ')}`, 'warning');
    }
    if (!job.properties) job.properties = {};
    job.properties.form_data = dynamicForm.values;
    job.properties.form_version = dynamicForm.version;
    job.properties.form_schema = dynamicForm.schema;
    job.properties.form_layer_type = getActiveSurveyLayerSettings().type;
    job.properties.form_layer_color = getSurveyLayerColorForGeometry(job.geometry);

    if (isNavigating) await stopNav(selectedJobId);

    const nameVal = document.getElementById('sheet-name').value;
    const noteVal = document.getElementById('sheet-note').value;
    const isTemp = job.properties && job.properties.is_temp === true;
    if (!navigator.onLine) {
        const queuedJob = isTemp ? {
            id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9), team_id: currentUser.team_id,
            lat: job.lat, lng: job.lng, geometry: job.geometry, status: 'done', category: job.category || currentUser.category,
            properties: { ...job.properties, name: nameVal || 'แปลงวาดใหม่', note: noteVal || '', date: new Date().toISOString().split('T')[0], is_custom_draw: true, is_temp: false }
        } : {
            id: job.id, team_id: job.team_id, lat: job.lat, lng: job.lng, geometry: job.geometry, status: 'done', category: job.category,
            properties: { ...job.properties, name: nameVal, note: noteVal, date: new Date().toISOString().split('T')[0], navigator_id: null, navigator_name: null }
        };
        await queueOfflineSave(queuedJob);
        if (isTemp) {
            const newShapeIndex = window.pendingNewShapes.findIndex(item => item.id === job.id);
            if (newShapeIndex !== -1) window.pendingNewShapes.splice(newShapeIndex, 1);
            window.pendingGeomanUpdates.delete(job.id);
            removeDraftDrawingLayer(job.layer);
        } else {
            job.status = 'done';
            job.properties = queuedJob.properties;
        }
        renderMap(); closeSheet(null, { preserveSavedState: true });
        if (isTemp) resumePendingDrawingTool({ layer: job.layer });
        Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'บันทึกไว้ในเครื่องแล้ว รอส่งเมื่อออนไลน์', timer: 2600, showConfirmButton: false });
        return;
    }

    showLoading(true, 'กำลังอัปโหลดรูปภาพและบันทึกข้อมูล...');
    try {
        // --- ส่วนที่ 1: ตรวจสอบและอัปโหลดรูปภาพใหม่ (ที่มีสถานะ isTemp) ---
        if (job.properties.images && job.properties.images.length > 0) {
            for (let i = 0; i < job.properties.images.length; i++) {
                let img = job.properties.images[i];

                if (img.isTemp && img.file) {
                    const formData = new FormData();
                    formData.append('file', img.file);
                    formData.append('upload_preset', cloudinaryUploadPreset);

                    const url = `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`;
                    const res = await fetch(url, { method: 'POST', body: formData });

                    if (!res.ok) throw new Error('อัปโหลดภาพไปยังคลาวด์ล้มเหลว');

                    const data = await res.json();

                    // เปลี่ยนจากรูปชั่วคราว ให้เป็นรูปจริงที่มีลิงก์จาก Cloudinary
                    job.properties.images[i] = {
                        url: data.secure_url,
                        public_id: data.public_id,
                        delete_token: data.delete_token,
                        uploadedAt: Date.now()
                    };
                }
            }
        }

        // --- ส่วนที่ 1.5: ลบรูปภาพที่ผู้ใช้สั่งลบออกจาก Cloudinary ---
        if (window.imagesToDeleteFromCloud && window.imagesToDeleteFromCloud.length > 0) {
            await Promise.all(window.imagesToDeleteFromCloud.map(async (publicId) => {
                try {
                    await fetch(GAS_URL + "?publicId=" + encodeURIComponent(publicId), { mode: 'no-cors' });
                } catch (err) {
                    console.error("ลบภาพจากคลาวด์ไม่สำเร็จ:", publicId, err);
                }
            }));
            window.imagesToDeleteFromCloud = []; // เคลียร์คิวการลบ
        }

        // --- ส่วนที่ 2: บันทึกข้อมูลข้อความลงฐานข้อมูล Supabase ---
        const hasNote = noteVal && noteVal.trim() !== "";
        const hasImages = job.properties && job.properties.images && job.properties.images.length > 0;
        const hasNoteOrImages = hasNote || hasImages;

        if (isTemp) {
            // Generate a permanent ID
            const permanentId = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            // Build permanent job object
            const savedJob = {
                id: permanentId,
                team_id: currentUser.team_id,
                lat: job.lat,
                lng: job.lng,
                geometry: job.geometry,
                status: 'done',
                category: job.category || currentUser.category,
                properties: {
                    ...job.properties,
                    name: nameVal || `แปลงวาดใหม่`,
                    note: noteVal || '',
                    date: new Date().toISOString().split('T')[0],
                    is_custom_draw: true,
                    is_temp: false,
                    navigator_id: null,
                    navigator_name: null,
                    images: job.properties.images || [],
                    form_data: dynamicForm.values,
                    form_version: dynamicForm.version,
                    form_schema: dynamicForm.schema,
                    area: job.properties.area || '-',
                    amphoe: 'วาดเอง',
                    tambon: 'แปลงชั่วคราว'
                }
            };

            if (job.properties.is_circle) {
                savedJob.properties.is_circle = true;
                savedJob.properties.radius = job.properties.radius;
            }

            await saveJobToSupabase(savedJob);

            // Remove the draft before rendering the permanent saved layer.
            removeDraftDrawingLayer(job.layer);

            // Remove from local queues
            const newShapeIndex = window.pendingNewShapes.findIndex(x => x.id === job.id);
            if (newShapeIndex !== -1) {
                window.pendingNewShapes.splice(newShapeIndex, 1);
            }
            window.pendingGeomanUpdates.delete(job.id);

            // Fetch latest data and sync map
            await syncJobsFromDB();
            closeSheet();
            resumePendingDrawingTool({ layer: job.layer });
            showPendingActionsBar();
        } else {
            job.status = 'done';
            job.properties.name = nameVal;
            job.properties.note = noteVal;
            job.properties.date = new Date().toISOString().split('T')[0];
            job.properties.navigator_id = null;
            job.properties.navigator_name = null;
            job.updated_at = new Date().toISOString();

            await saveJobToSupabase(job);
            renderMap();
            closeSheet(null, { preserveSavedState: true });
            if (isTemp) resumePendingDrawingTool({ layer: job.layer });
        }

        if (job.properties?.is_custom_draw) clearDrawingMeasurements();
        Swal.fire({ toast: true, icon: 'success', title: 'บันทึกข้อมูลเรียบร้อย', timer: 1500, showConfirmButton: false });
    } catch (e) {
        console.error("Save Data Error:", e);
        Swal.fire('บันทึกล้มเหลว', e.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteJob({ skipConfirm = false, silent = false } = {}) {
    const job = findJobById(selectedJobId);
    if (!job) return;

    // Check if temporary drawn shape
    if (job.properties && job.properties.is_temp === true) {
        const confirm = skipConfirm ? { isConfirmed: true } : await Swal.fire({
            title: 'ยืนยันการลบรูปแปลงที่วาดใหม่?',
            text: 'คุณต้องการลบหรือยกเลิกการวาดรูปแปลงนี้ใช่หรือไม่?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'ยืนยันการลบ',
            cancelButtonText: 'ยกเลิก'
        });

        if (!confirm.isConfirmed) return;

        // Revoke temporary image blobs
        if (job.properties.images) {
            job.properties.images.forEach(img => {
                if (img && img.isTemp && img.url && img.url.startsWith('blob:')) {
                    URL.revokeObjectURL(img.url);
                }
            });
        }
        // Remove the unpersisted draft itself, including any Geoman wrapper.
        removeDraftDrawingLayer(job.layer);
        // Remove from pending queues
        const newShapeIndex = window.pendingNewShapes.findIndex(x => x.id === job.id);
        if (newShapeIndex !== -1) {
            window.pendingNewShapes.splice(newShapeIndex, 1);
        }
        window.pendingGeomanUpdates.delete(job.id);

        clearDrawingMeasurements();
        closeSheet();
        showPendingActionsBar();
        if (!silent) Swal.fire({ toast: true, position: 'top', backdrop: false, icon: 'success', title: 'ยกเลิกการวาดเรียบร้อย', timer: 1500, showConfirmButton: false });
        return;
    }

    // Check if custom drawn item
    if (job.properties && job.properties.is_custom_draw === true) {
        const hasImages = job.properties.images && job.properties.images.length > 0;
        const confirm = skipConfirm ? { isConfirmed: true } : await Swal.fire({
            title: 'ยืนยันลบข้อมูลรูปแปลง/หมุด?',
            text: 'ระบบจะลบข้อมูลรูปแปลง/หมุด และรูปถ่ายทั้งหมดออกจากระบบอย่างถาวร',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'ยืนยันการลบถาวร',
            cancelButtonText: 'ยกเลิก'
        });

        if (confirm.isConfirmed) {
            justDeletedJobId = job.id;
            selectedJobId = null;
            isMapClickBlocked = true;
            closeSheet();

            if (!silent) showLoading(true, 'กำลังลบข้อมูลรูปแปลง/หมุด...');
            try {
                // 1. Delete images from Cloudinary
                if (hasImages) {
                    await Promise.all(job.properties.images.map(async (img) => {
                        const publicId = img ? (img.public_id || getPublicIdFromUrl(typeof img === 'string' ? img : img.url)) : null;
                        if (publicId) {
                            try {
                                await fetch(GAS_URL + "?publicId=" + encodeURIComponent(publicId), { mode: 'no-cors' });
                            } catch (err) {
                                console.error("ลบ Cloudinary พลาด:", err);
                            }
                        }
                    }));
                }

                // 2. Delete row from Supabase
                await deleteJobFromSupabase(job.id);
                // 3. Remove from dbJobs
                const jobIndex = dbJobs.findIndex(j => j.id === job.id);
                if (jobIndex !== -1) {
                    dbJobs.splice(jobIndex, 1);
                }

                // 4. Render map
                clearDrawingMeasurements();
                renderMap();
                if (!silent) showLoading(false);
                if (!silent) await Swal.fire({ toast: true, position: 'top', backdrop: false, icon: 'success', title: 'ลบข้อมูลรูปแปลง/หมุดเรียบร้อยแล้ว', timer: 1500, showConfirmButton: false });
            } catch (e) {
                if (!silent) showLoading(false);
                Swal.fire('ล้มเหลวในการลบข้อมูล', e.message, 'error');
            } finally {
                setTimeout(() => {
                    justDeletedJobId = null;
                    isMapClickBlocked = false;
                }, 2000);
            }
        }
        return;
    }

    if (job.status === 'done') {
        await deleteSurveyData();
    } else {
        Swal.fire({
            icon: 'error',
            title: 'ไม่สามารถลบได้',
            text: 'ไม่สามารถลบแปลงที่ดินที่นำเข้าออกจากระบบได้',
            confirmButtonText: 'ตกลง',
            confirmButtonColor: '#ef4444'
        });
        return;
    }
}

function navGoogle() {
    const j = findJobById(selectedJobId);
    const target = j || activeNavigationTarget || manualTravelTarget;
    if (!target) return Swal.fire('ยังไม่มีเป้าหมาย', 'เลือกแปลง ค้นหาสถานที่ หรือแตะแผนที่สองครั้งเพื่อปักหมุดก่อน', 'info');
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`, '_blank');
}

function updateAmphoeDropdown() {
    const s = new Set();
    dbJobs.filter(j => j.category === currentUser.category).forEach(j => {
        const p = j.properties || {};
        const a = (p.amphoe || p.AMPH_NAME || p.AMPHOE || p.district || "").toString().trim();
        if (a) s.add(a);
    });
    const el = document.getElementById('sel-amphoe');
    el.innerHTML = '<option value="">อ.ทั้งหมด</option>';
    Array.from(s).sort().forEach(a => el.innerHTML += `<option value="${a}">${a}</option>`);
    document.getElementById('sel-tambon').innerHTML = '<option value="">ต.ทั้งหมด</option>';
}

function onAmphoeChange() {
    const v = document.getElementById('sel-amphoe').value;
    const s = new Set();
    dbJobs.filter(j => {
        const p = j.properties || {};
        const a = (p.amphoe || p.AMPH_NAME || p.AMPHOE || p.district || "").toString().trim();
        return j.category === currentUser.category && a === v;
    }).forEach(j => {
        const p = j.properties || {};
        const t = (p.tambon || p.TUMB_NAME || p.TAMBON || p.subdistrict || "").toString().trim();
        if (t) s.add(t);
    });
    const el = document.getElementById('sel-tambon');
    el.innerHTML = '<option value="">ต.ทั้งหมด</option>';
    Array.from(s).sort().forEach(t => el.innerHTML += `<option value="${t}">${t}</option>`);
    renderMap(true);
}

function filterMap() { renderMap(true); }

function toggleViewMode() {
    viewMode = viewMode === 'original' ? 'pin' : 'original';
    document.getElementById('btn-view').innerHTML = viewMode === 'pin'
        ? '<i class="fa-solid fa-map-pin"></i>'
        : '<i class="fa-solid fa-draw-polygon"></i>';
    renderMap();
}

function toggleBaseMap() {
    map.removeLayer(maps[currentBaseMap]);
    currentBaseMap = currentBaseMap === 'hybrid' ? 'street' : 'hybrid';
    map.addLayer(maps[currentBaseMap]);
}

// --- Premium Settings Modal Logic ---
function openDashboard(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const group = v2ActiveWorkGroup?.id ? `?workGroup=${encodeURIComponent(v2ActiveWorkGroup.id)}` : '';
    window.location.assign(`dashboard.html${group}`);
}

function closeDashboard() { document.getElementById('dashboard-screen')?.classList.add('hidden'); }

async function loadDashboardProfiles() {
    if (!supabaseClient || !currentUser?.team_id) return;
    try {
        const { data, error } = await supabaseClient.from('profiles').select('id,display_name,email,updated_at').eq('team_id', currentUser.team_id);
        if (error) throw error;
        dashboardProfiles = data || [];
    } catch (error) { console.warn('Dashboard profile load failed', error); }
}

function dashboardDateYear(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? String(date.getFullYear()) : '';
}

function dashboardDonut(items) {
    const total = items.reduce((sum, [, count]) => sum + count, 0) || 1;
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];
    let cursor = 0;
    const segments = items.map(([, count], index) => {
        const start = cursor; cursor += count / total * 100;
        return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(', ');
    return `<div class="flex flex-col sm:flex-row items-center gap-5"><div class="w-48 h-48 rounded-full shrink-0" style="background:conic-gradient(${segments});"><div class="w-28 h-28 bg-white rounded-full m-10 flex flex-col items-center justify-center"><b class="text-2xl text-slate-800">${total}</b><span class="text-[10px] text-slate-500">รายการ</span></div></div><div class="w-full max-h-56 overflow-y-auto space-y-2">${items.map(([label, count], index) => `<div class="flex justify-between text-xs"><span class="min-w-0 truncate"><i class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${colors[index % colors.length]}"></i>${v2EscapeHtml(label)}</span><b>${count}</b></div>`).join('')}</div></div>`;
}

async function renderDashboard() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    container.innerHTML = '<div class="p-8 text-center text-sm text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังสรุปข้อมูล...</div>';
    await loadDashboardProfiles();
    const form = getActiveSurveyForm();
    // Work group scopes the dashboard.  Only a Dropdown explicitly marked by
    // its form owner divides the results into graph categories.
    const fields = (form?.fields || []).filter(field => field.dashboard_group === true && ['select', 'multiselect'].includes(normalizeSurveyFieldType(field.type)));
    let selectedKey = dashboardState.fieldKey || document.getElementById('dashboard-group-field')?.value || fields[0]?.key || '';
    if (selectedKey && !fields.some(field => field.key === selectedKey)) selectedKey = fields[0]?.key || '';
    dashboardState.fieldKey = selectedKey;
    const selectedField = fields.find(field => field.key === selectedKey);
    const allFeatures = dbJobs.flatMap(job => (job.properties?.survey_features || []).map(feature => ({ ...feature, parentName: job.properties?.name || job.id, parentId: job.id, fallbackRecorder: job.properties?.recorded_by })));
    const years = [...new Set(allFeatures.map(feature => dashboardDateYear(feature.recorded_at || feature.updated_at)).filter(Boolean))].sort().reverse();
    const features = allFeatures.filter(feature => feature.status === 'done' && (dashboardState.year === 'all' || dashboardDateYear(feature.recorded_at || feature.updated_at) === dashboardState.year));
    const counts = new Map();
    if (selectedField) {
        features.forEach(feature => {
            const values = Array.isArray(feature.form_data?.[selectedKey]) ? feature.form_data[selectedKey] : [feature.form_data?.[selectedKey]];
            values.filter(value => value !== undefined && value !== null && value !== '').forEach(value => {
                const label = surveyOptionLabel(selectedField, value);
                counts.set(label, (counts.get(label) || 0) + 1);
            });
        });
    }
    const max = Math.max(1, ...counts.values());
    const photoCount = features.reduce((sum, feature) => sum + (feature.images || []).length, 0);
    const completedPlots = dbJobs.filter(job => job.status === 'done').length;
    const statusCounts = ['waiting', 'navigating', 'checking', 'done', 'problem'].map(status => [status, dbJobs.filter(job => job.status === status).length]);
    const statusLabels = { waiting: 'รอดำเนินการ', navigating: 'กำลังเดินทาง', checking: 'กำลังตรวจ', done: 'เสร็จสิ้น', problem: 'มีปัญหา' };
    const byPerson = new Map();
    features.forEach(feature => { const id = feature.recorded_by || feature.fallbackRecorder || 'unknown'; byPerson.set(id, (byPerson.get(id) || 0) + 1); });
    const now = Date.now();
    const people = dashboardProfiles.map(profile => ({ ...profile, count: byPerson.get(profile.id) || 0, online: profile.id === currentUser.id ? navigator.onLine : now - new Date(profile.updated_at || 0).getTime() < 15 * 60 * 1000 }));
    const trend = new Map();
    features.forEach(feature => { const date = String(feature.recorded_at || feature.updated_at || '').slice(0, 10); if (date) trend.set(date, (trend.get(date) || 0) + 1); });
    const trendItems = Array.from(trend.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
    const trendMax = Math.max(1, ...trendItems.map(([, count]) => count));
    const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const cards = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div class="bg-white border border-slate-200 rounded-2xl p-3"><p class="text-[10px] text-slate-500">ชื่องาน</p><p class="text-sm font-black text-slate-800 truncate">${v2EscapeHtml(v2ActiveWorkGroup?.name || currentUser.category || '-')}</p></div>
        <div class="bg-white border border-slate-200 rounded-2xl p-3"><p class="text-[10px] text-slate-500">จำนวนแปลง</p><p class="text-2xl font-black text-slate-800">${dbJobs.length}</p><p class="text-[10px] text-emerald-600">เสร็จ ${completedPlots}</p></div>
        <div class="bg-white border border-slate-200 rounded-2xl p-3"><p class="text-[10px] text-slate-500">การสำรวจ</p><p class="text-2xl font-black text-slate-800">${features.length}</p><p class="text-[10px] text-slate-500">รูปถ่าย ${photoCount}</p></div>
        <div class="bg-white border border-slate-200 rounded-2xl p-3"><p class="text-[10px] text-slate-500">ทีมออนไลน์ล่าสุด</p><p class="text-2xl font-black text-slate-800">${people.filter(person => person.online).length}/${people.length}</p><p class="text-[10px] text-slate-500">ภายใน 15 นาที</p></div></div>`;
    const controls = `<div class="grid sm:grid-cols-3 gap-2 mb-4"><select id="dashboard-group-field" onchange="dashboardState.fieldKey=this.value;renderDashboard()" class="p-3 rounded-xl border border-slate-200 bg-white text-sm">${fields.length ? fields.map(field => `<option value="${v2EscapeHtml(field.key)}" ${field.key === selectedKey ? 'selected' : ''}>${v2EscapeHtml(field.label)}</option>`).join('') : '<option>ยังไม่ได้กำหนด Dropdown</option>'}</select><select onchange="dashboardState.year=this.value;renderDashboard()" class="p-3 rounded-xl border border-slate-200 bg-white text-sm"><option value="all" ${dashboardState.year === 'all' ? 'selected' : ''}>ทุกปี</option>${years.map(year => `<option value="${year}" ${dashboardState.year === year ? 'selected' : ''}>ปี ${year}</option>`).join('')}</select><div class="flex rounded-xl border border-slate-200 bg-white overflow-hidden"><button onclick="dashboardState.graph='bar';renderDashboard()" class="flex-1 text-xs font-bold ${dashboardState.graph === 'bar' ? 'bg-emerald-600 text-white' : 'text-slate-600'}"><i class="fa-solid fa-chart-bar mr-1"></i>แท่ง</button><button onclick="dashboardState.graph='donut';renderDashboard()" class="flex-1 text-xs font-bold ${dashboardState.graph === 'donut' ? 'bg-emerald-600 text-white' : 'text-slate-600'}"><i class="fa-solid fa-chart-pie mr-1"></i>โดนัท</button></div></div>`;
    const chart = !fields.length ? '<div class="p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">กำหนด Dropdown ในแบบฟอร์ม แล้วติ๊ก “ใช้ Dropdown นี้จัดกลุ่มกราฟบน Dashboard”</div>' : !sortedCounts.length ? '<div class="text-center text-sm text-slate-400 py-10">ยังไม่มีผลสำรวจของตัวกรองนี้</div>' : dashboardState.graph === 'donut' ? dashboardDonut(sortedCounts) : `<div class="max-h-[420px] overflow-y-auto pr-1">${sortedCounts.map(([label, count]) => `<button onclick='dashboardFocusCategory(${JSON.stringify(selectedKey)},${JSON.stringify(label)})' class="w-full text-left mb-3"><div class="flex justify-between text-xs font-bold text-slate-700 mb-1"><span class="truncate pr-2">${v2EscapeHtml(label)}</span><span>${count}</span></div><div class="h-4 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full bg-emerald-500" style="width:${(count / max) * 100}%"></div></div></button>`).join('')}</div>`;
    const peopleHtml = people.length ? people.map(person => `<div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"><div class="min-w-0"><p class="text-xs font-bold truncate"><i class="fa-solid fa-circle text-[8px] ${person.online ? 'text-emerald-500' : 'text-slate-300'} mr-1"></i>${v2EscapeHtml(person.display_name || person.email || 'ผู้สำรวจ')}</p><p class="text-[10px] text-slate-400">${person.online ? 'ออนไลน์ล่าสุด' : 'ไม่อยู่ล่าสุด'} · ${person.count} การสำรวจ</p></div><b class="text-sm text-slate-700">${person.count}</b></div>`).join('') : '<p class="text-sm text-slate-400">ยังไม่พบรายชื่อผู้สำรวจ</p>';
    const statusHtml = statusCounts.map(([status, count]) => `<div class="flex justify-between text-xs py-1"><span>${statusLabels[status]}</span><b>${count}</b></div>`).join('');
    const trendHtml = trendItems.length ? `<div class="h-40 flex items-end gap-1 overflow-x-auto">${trendItems.map(([date, count]) => `<div class="min-w-8 flex-1 h-full flex flex-col justify-end items-center"><span class="text-[9px] font-bold">${count}</span><div class="w-full max-w-7 bg-blue-500 rounded-t" style="height:${Math.max(8, count / trendMax * 110)}px"></div><span class="text-[8px] text-slate-400 mt-1 whitespace-nowrap">${date.slice(5)}</span></div>`).join('')}</div>` : '<p class="text-sm text-slate-400 py-8 text-center">ยังไม่มีข้อมูลแนวโน้ม</p>';
    container.innerHTML = `${cards}${controls}<div class="grid lg:grid-cols-2 gap-4"><section class="bg-white rounded-2xl border border-slate-200 p-4"><h2 class="font-black text-slate-800 mb-4">กราฟผลสำรวจ${selectedField ? `: ${v2EscapeHtml(selectedField.label)}` : ''}</h2>${chart}</section><section class="bg-white rounded-2xl border border-slate-200 p-4"><h2 class="font-black text-slate-800 mb-3">ผู้สำรวจและผลงาน</h2>${peopleHtml}</section><section class="bg-white rounded-2xl border border-slate-200 p-4"><h2 class="font-black text-slate-800 mb-3">สถานะแปลง</h2>${statusHtml}</section><section class="bg-white rounded-2xl border border-slate-200 p-4"><h2 class="font-black text-slate-800 mb-3">แนวโน้ม 14 วันล่าสุด</h2>${trendHtml}</section></div>`;
}

function dashboardFocusCategory(fieldKey, label) {
    const field = (getActiveSurveyForm()?.fields || []).find(item => item.key === fieldKey);
    const feature = dbJobs.flatMap(job => (job.properties?.survey_features || []).map(item => ({ job, item }))).find(({ item }) => {
        const values = Array.isArray(item.form_data?.[fieldKey]) ? item.form_data[fieldKey] : [item.form_data?.[fieldKey]];
        return values.some(value => surveyOptionLabel(field, value) === label);
    });
    if (!feature) return;
    closeDashboard();
    openSheet(feature.job);
    focusSurveyFeature(feature.job.id, feature.item.id);
}

function openToolsMenu() {
    const modal = document.getElementById('custom-settings-modal');
    modal.classList.add('active');

    switchSettingsTab('profile');
}

async function closeSettingsModal(e) {
    if (e) e.stopPropagation();
    const modal = document.getElementById('custom-settings-modal');
    if (!modal?.classList.contains('active')) return;

    if (activeSettingsTab === 'form' && isSurveyFormDraftDirty()) {
        const saved = await saveSurveyFormDefinition({ silent: true });
        if (!saved) return;
    }
    modal.classList.remove('active');
}

let activeSettingsTab = 'profile';
function switchSettingsTab(tab) {
    activeSettingsTab = tab;
    const tabs = ['profile', 'geojson', 'form', 'voice'];
    tabs.forEach(t => {
        const btn = document.getElementById(`stab-${t}`);
        const content = document.getElementById(`scontent-${t}`);
        if (t === tab) {
            btn.classList.add('active');
            content.classList.remove('hidden');
        } else {
            btn.classList.remove('active');
            content.classList.add('hidden');
        }
    });

    if (tab === 'profile') {
        loadTeamMembers();
    } else if (tab === 'geojson') {
        const groupLabel = document.getElementById('export-active-work-group');
        if (groupLabel) groupLabel.textContent = v2ActiveWorkGroup?.name || currentUser?.category || 'ทั่วไป';
        renderImportedMapsList();
    } else if (tab === 'form') {
        loadSurveyFormBuilder();
    }
}

const SURVEY_FIELD_TYPES = {
    text: 'ข้อความสั้น', textarea: 'ข้อความหลายบรรทัด', number: 'ตัวเลข',
    date: 'วันที่', time: 'เวลา', datetime: 'วันที่และเวลา', select: 'Dropdown',
    multiselect: 'เลือกหลายรายการ', checkbox: 'ใช่ / ไม่ใช่'
};

function normalizeSurveyFieldType(value) {
    const type = String(value || 'text').trim().toLowerCase();
    if (/^(select|dropdown|drop-down|ดรอปดาวน์|ดรอปดาว|ตัวเลือก)$/.test(type)) return 'select';
    if (/^(multiselect|multi-select|เลือกหลายรายการ)$/.test(type)) return 'multiselect';
    if (/^(checkbox|boolean|bool|ใช่\/ไม่ใช่)$/.test(type)) return 'checkbox';
    if (/^(textarea|longtext|ข้อความหลายบรรทัด)$/.test(type)) return 'textarea';
    if (/^(number|numeric|integer|decimal|ตัวเลข)$/.test(type)) return 'number';
    if (/^(datetime|datetime-local|วันที่และเวลา)$/.test(type)) return 'datetime';
    if (/^(date|วันที่)$/.test(type)) return 'date';
    if (/^(time|เวลา)$/.test(type)) return 'time';
    return 'text';
}

function surveyFieldKey(value, index = 1) {
    const normalized = String(value || '').trim().toLowerCase()
        .replace(/[^a-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || `field_${index}`;
}

function getActiveSurveyForm() {
    return v2SurveyForms.find(form => form.work_group_id === v2ActiveWorkGroup?.id) || null;
}

function normalizeSurveyLayerType(value) {
    const type = String(value || 'both').trim().toLowerCase();
    return ['point', 'polygon'].includes(type) ? type : 'both';
}

function normalizeSurveyLayerColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#10b981';
}

function getActiveSurveyLayerSettings() {
    const form = getActiveSurveyForm();
    const legacyColor = normalizeSurveyLayerColor(form?.layer_color);
    return {
        type: normalizeSurveyLayerType(form?.layer_type),
        color: legacyColor,
        pointColor: normalizeSurveyLayerColor(form?.layer_point_color || legacyColor),
        polygonColor: normalizeSurveyLayerColor(form?.layer_polygon_color || legacyColor)
    };
}

function getSurveyLayerColorForShape(shape) {
    const settings = getActiveSurveyLayerSettings();
    return shape === 'Marker' || shape === 'Point' ? settings.pointColor : settings.polygonColor;
}

function getSurveyLayerColorForGeometry(geometry) {
    return getSurveyLayerColorForShape(geometry?.type === 'Point' ? 'Point' : 'Polygon');
}

function renderSurveyLayerColorControls(form = getActiveSurveyForm()) {
    const container = document.getElementById('survey-layer-color-controls');
    if (!container) return;
    const legacyColor = normalizeSurveyLayerColor(form?.layer_color);
    const pointColor = document.getElementById('survey-form-point-color')?.value || normalizeSurveyLayerColor(form?.layer_point_color || legacyColor);
    const polygonColor = document.getElementById('survey-form-polygon-color')?.value || normalizeSurveyLayerColor(form?.layer_polygon_color || legacyColor);
    const selectedType = document.getElementById('survey-form-layer-type')?.value || 'both';
    const colorCard = (id, label, icon, color, inactive) => `<label class="rounded-xl border border-violet-200 bg-white p-2 text-[10px] font-bold text-violet-800 ${inactive ? 'opacity-55' : ''}"><span class="flex items-center gap-1.5"><i class="fa-solid ${icon}"></i>${label}<span id="${id}-swatch" class="ml-auto h-3 w-3 rounded-full border border-slate-300" style="background:${color}"></span></span><input id="${id}" type="color" value="${color}" oninput="updateSurveyLayerColorSwatch('${id}')" class="mt-1 h-8 w-full cursor-pointer rounded-lg border border-violet-100 bg-white p-0.5"></label>`;
    container.innerHTML = colorCard('survey-form-point-color', 'สี Point', 'fa-location-dot', pointColor, selectedType === 'polygon')
        + colorCard('survey-form-polygon-color', 'สี Polygon', 'fa-draw-polygon', polygonColor, selectedType === 'point');
}

function updateSurveyLayerColorSwatch(inputId) {
    const input = document.getElementById(inputId);
    const swatch = document.getElementById(`${inputId}-swatch`);
    if (input && swatch) swatch.style.background = input.value;
}
window.renderSurveyLayerColorControls = renderSurveyLayerColorControls;
window.updateSurveyLayerColorSwatch = updateSurveyLayerColorSwatch;

function openSurveyFormBuilderFromSheet() {
    openToolsMenu();
    window.setTimeout(() => switchSettingsTab('form'), 0);
}
window.openSurveyFormBuilderFromSheet = openSurveyFormBuilderFromSheet;

function isSurveyShapeAllowed(shape) {
    const layerType = getActiveSurveyLayerSettings().type;
    if (layerType === 'both') return true;
    if (layerType === 'point') return shape === 'Marker';
    return ['Polygon', 'Rectangle', 'Circle'].includes(shape);
}

function collectBaseMapFieldPaths(value, prefix = '', output = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return output;
    Object.entries(value).forEach(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            collectBaseMapFieldPaths(child, path, output, depth + 1);
        } else {
            output.add(path);
        }
    });
    return output;
}

function getAvailableBaseMapFieldPaths() {
    const fields = new Set();
    v2BasePlots
        .filter(plot => plot.source_properties?.is_custom_draw !== true)
        .forEach(plot => collectBaseMapFieldPaths(plot.source_properties || {}, '', fields));
    const internalFields = new Set(['is_custom_draw', 'source_type', 'drawing_shape', 'work_group_id']);
    return Array.from(fields).filter(path => !internalFields.has(path)).sort((a, b) => a.localeCompare(b, 'th')).slice(0, 500);
}

function getValueByFieldPath(source, path) {
    if (!source || !path) return undefined;
    return path.split('.').reduce((value, key) => (value !== null && value !== undefined ? value[key] : undefined), source);
}

// Dropdown values use a stable id, rather than the label users see.  This is
// what lets an administrator rename an option without changing the meaning of
// thousands of previously saved survey records.
function normalizeSurveyFieldOptions(options = []) {
    return (Array.isArray(options) ? options : []).map((option, index) => {
        if (option && typeof option === 'object') {
            return {
                id: String(option.id || `option_${index}_${String(option.label || '').replace(/\W+/g, '_')}`),
                label: String(option.label ?? option.value ?? ''),
                active: option.active !== false
            };
        }
        const label = String(option ?? '').trim();
        return { id: `legacy_${index}_${label.replace(/\W+/g, '_')}`, label, active: true };
    }).filter(option => option.label);
}

function surveyOptionLabel(field, value) {
    const option = normalizeSurveyFieldOptions(field?.options).find(item => item.id === String(value));
    return option ? option.label : String(value ?? '');
}

function buildSurveyOptionsFromText(text, previousOptions = []) {
    const oldOptions = normalizeSurveyFieldOptions(previousOptions);
    const labels = String(text || '').split(/\r?\n|,|\|/).map(value => value.trim()).filter(Boolean);
    const used = new Set();
    const active = labels.map((label, index) => {
        // Same line preserves an id on rename; matching label preserves an id
        // when a user reorders the list.
        let old = oldOptions.find(item => !used.has(item.id) && item.label === label);
        if (!old) old = oldOptions[index] && !used.has(oldOptions[index].id) ? oldOptions[index] : null;
        const id = old?.id || `option_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
        used.add(id);
        return { id, label, active: true };
    });
    // Removed options stay archived: historic results remain intelligible but
    // cannot be selected in a newly created survey.
    return [...active, ...oldOptions.filter(item => !used.has(item.id)).map(item => ({ ...item, active: false }))];
}

function migrateSurveyFormValues(values, oldFields, newFields) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { values, changed: false };
    const output = { ...values };
    let changed = false;
    (newFields || []).forEach(nextField => {
        const oldField = (oldFields || []).find(field => field.id === nextField.id) || (oldFields || []).find(field => field.key === nextField.key);
        if (!oldField) return;
        const oldKey = oldField.key;
        const newKey = nextField.key;
        if (!Object.prototype.hasOwnProperty.call(output, oldKey)) return;
        let value = output[oldKey];
        const oldOptions = normalizeSurveyFieldOptions(oldField.options);
        const nextOptions = normalizeSurveyFieldOptions(nextField.options);
        const mapOne = item => {
            const text = String(item ?? '');
            if (nextOptions.some(option => option.id === text)) return item;
            const oldOption = oldOptions.find(option => option.id === text || option.label === text);
            const matched = oldOption && nextOptions.find(option => option.id === oldOption.id);
            return matched ? matched.id : item;
        };
        if (['select', 'multiselect'].includes(normalizeSurveyFieldType(nextField.type))) {
            const mapped = Array.isArray(value) ? value.map(mapOne) : mapOne(value);
            if (JSON.stringify(mapped) !== JSON.stringify(value)) { value = mapped; changed = true; }
        }
        if (oldKey !== newKey) { delete output[oldKey]; changed = true; }
        if (JSON.stringify(output[newKey]) !== JSON.stringify(value)) { output[newKey] = value; changed = true; }
    });
    return { values: output, changed };
}

async function migrateSavedSurveyFormValues(oldFields, newFields, workGroupId = v2ActiveWorkGroup?.id) {
    let records = v2PlotRecords.filter(record => record.work_group_id === workGroupId);
    // The builder can now edit another visible work group without switching
    // the map. Fetch that group's records before migrating field definitions.
    if (workGroupId && workGroupId !== v2ActiveWorkGroup?.id) {
        const { data, error } = await supabaseClient.from('plot_records').select('*').eq('work_group_id', workGroupId);
        if (error) throw error;
        records = data || [];
    }
    let changedCount = 0;
    for (const record of records) {
        const props = JSON.parse(JSON.stringify(record.record_properties || {}));
        const parent = migrateSurveyFormValues(props.form_data || {}, oldFields, newFields);
        let changed = parent.changed || JSON.stringify(props.form_schema || []) !== JSON.stringify(newFields);
        props.form_data = parent.values;
        props.form_schema = newFields;
        if (Array.isArray(props.survey_features)) {
            props.survey_features = props.survey_features.map(feature => {
                const migrated = migrateSurveyFormValues(feature.form_data || {}, oldFields, newFields);
                if (migrated.changed || JSON.stringify(feature.form_schema || []) !== JSON.stringify(newFields)) changed = true;
                return { ...feature, form_data: migrated.values, form_schema: newFields };
            });
        }
        if (!changed) continue;
        const { error } = await supabaseClient.from('plot_records').update({ record_properties: props, updated_at: new Date().toISOString() }).eq('id', record.id);
        if (error) throw error;
        record.record_properties = props;
        changedCount++;
    }
    return changedCount;
}

function getMappedBaseMapValue(job, field) {
    if (!field?.source_key) return undefined;
    const plotId = job.properties?.base_plot_id || job.id;
    const plot = v2BasePlots.find(item => item.id === plotId);
    const rawValue = getValueByFieldPath(plot?.source_properties || {}, field.source_key);
    if (rawValue === null || rawValue === undefined) return undefined;
    const fieldType = normalizeSurveyFieldType(field.type);
    if (fieldType === 'checkbox') {
        return rawValue === true || /^(1|true|yes|y|ใช่)$/i.test(String(rawValue).trim());
    }
    if (fieldType === 'multiselect') {
        return Array.isArray(rawValue) ? rawValue.map(String) : String(rawValue).split(/,|\|/).map(value => value.trim()).filter(Boolean);
    }
    if (fieldType === 'number') {
        const numeric = Number(rawValue);
        return Number.isFinite(numeric) ? numeric : '';
    }
    return typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
}

function getSurveyFormForWorkGroup(workGroupId) {
    return v2SurveyForms.find(form => form.work_group_id === workGroupId) || null;
}

function getSurveyFormBuilderGroup() {
    const groups = v2VisibleWorkGroups();
    const selectedId = document.getElementById('survey-form-work-group')?.value || surveyFormBuilderGroupId || v2ActiveWorkGroup?.id;
    return groups.find(group => group.id === selectedId) || groups.find(group => group.id === v2ActiveWorkGroup?.id) || groups[0] || null;
}

function loadSurveyFormBuilder() {
    const groups = v2VisibleWorkGroups();
    const groupSelect = document.getElementById('survey-form-work-group');
    if (groupSelect) {
        const desiredId = surveyFormBuilderGroupId && groups.some(group => group.id === surveyFormBuilderGroupId)
            ? surveyFormBuilderGroupId
            : v2ActiveWorkGroup?.id;
        groupSelect.innerHTML = groups.length
            ? groups.map(group => `<option value="${group.id}">${v2EscapeHtml(group.name)}${group.id === v2ActiveWorkGroup?.id ? ' (กลุ่มที่กำลังใช้งาน)' : ''}</option>`).join('')
            : '<option value="">ยังไม่มีกลุ่มงาน</option>';
        groupSelect.value = desiredId || groups[0]?.id || '';
    }
    const targetGroup = getSurveyFormBuilderGroup();
    surveyFormBuilderGroupId = targetGroup?.id || null;
    const form = getSurveyFormForWorkGroup(targetGroup?.id);
    surveyFormDraftFields = JSON.parse(JSON.stringify(form?.fields || [])).map(field => ({ ...field, type: normalizeSurveyFieldType(field.type) }));
    const groupLabel = document.getElementById('form-active-work-group');
    const nameInput = document.getElementById('survey-form-name');
    if (groupLabel) groupLabel.textContent = targetGroup?.name || currentUser?.category || 'ทั่วไป';
    if (nameInput) nameInput.value = form?.name || `แบบฟอร์ม ${targetGroup?.name || currentUser?.category || 'ทั่วไป'}`;
    const layerTypeInput = document.getElementById('survey-form-layer-type');
    if (layerTypeInput) layerTypeInput.value = normalizeSurveyLayerType(form?.layer_type);
    renderSurveyLayerColorControls(form);
    surveyFormDraftBaseline = JSON.stringify(surveyFormDraftFields);
    surveyFormNameBaseline = nameInput?.value || '';
    surveyFormLayerSettingsBaseline = JSON.stringify({
        type: layerTypeInput?.value || 'both',
        pointColor: document.getElementById('survey-form-point-color')?.value || '#10b981',
        polygonColor: document.getElementById('survey-form-polygon-color')?.value || '#10b981'
    });

    const sourceSelect = document.getElementById('copy-form-source');
    if (sourceSelect) {
        const visibleGroupIds = new Set(v2VisibleWorkGroups().map(group => group.id));
        const sources = v2SurveyForms.filter(item => item.work_group_id !== targetGroup?.id && visibleGroupIds.has(item.work_group_id) && Array.isArray(item.fields) && item.fields.length);
        sourceSelect.innerHTML = sources.length
            ? sources.map(item => {
                const group = v2WorkGroups.find(entry => entry.id === item.work_group_id);
                return `<option value="${item.id}">${v2EscapeHtml(group?.name || item.name)} — ${item.fields.length} ช่องกรอก</option>`;
            }).join('')
            : '<option value="">ยังไม่มีแบบฟอร์มจากงานอื่น</option>';
    }
    renderSurveyFormFieldsList();
}

function isSurveyFormDraftDirty() {
    const currentName = document.getElementById('survey-form-name')?.value || '';
    const currentLayerSettings = JSON.stringify({
        type: document.getElementById('survey-form-layer-type')?.value || 'both',
        pointColor: document.getElementById('survey-form-point-color')?.value || '#10b981',
        polygonColor: document.getElementById('survey-form-polygon-color')?.value || '#10b981'
    });
    return currentName !== surveyFormNameBaseline
        || JSON.stringify(surveyFormDraftFields) !== surveyFormDraftBaseline
        || currentLayerSettings !== surveyFormLayerSettingsBaseline;
}

function renderSurveyFormFieldsList() {
    const list = document.getElementById('survey-form-fields-list');
    const count = document.getElementById('form-field-count');
    if (!list) return;
    if (count) count.textContent = `${surveyFormDraftFields.length} ช่อง`;
    if (!surveyFormDraftFields.length) {
        list.innerHTML = '<div class="text-center text-xs text-gray-400 border border-dashed border-gray-300 rounded-2xl py-6">ฟอร์มว่าง: ยังบันทึกสถานะ หมายเหตุ รูปถ่าย และพิกัดได้ตามปกติ<br><span class="text-[10px]">เพิ่มช่องกรอกหรือนำเข้าจาก Excel ได้ภายหลัง</span></div>';
        return;
    }
    list.innerHTML = surveyFormDraftFields.map((field, index) => `
        <div class="flex items-center gap-2 p-2.5 bg-white border border-gray-200 rounded-xl shadow-sm" draggable="true"
             ondragstart="startSurveyFieldDrag(${index})" ondragover="event.preventDefault()" ondrop="dropSurveyField(${index})">
            <span class="text-gray-300 cursor-grab"><i class="fa-solid fa-grip-vertical"></i></span>
            <div class="flex-1 min-w-0">
                <div class="text-xs font-bold text-gray-800 truncate">${v2EscapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}</div>
                <div class="text-[9px] text-gray-500 truncate">${v2EscapeHtml(field.key)} · ${v2EscapeHtml(SURVEY_FIELD_TYPES[normalizeSurveyFieldType(field.type)] || field.type)}${['select', 'multiselect'].includes(normalizeSurveyFieldType(field.type)) ? ` · ${normalizeSurveyFieldOptions(field.options).filter(option => option.active).length} ตัวเลือก` : ''}${field.dashboard_group ? ' · สรุป Dashboard' : ''}</div>
                ${field.source_key ? `<div class="text-[9px] text-violet-600 truncate"><i class="fa-solid fa-link mr-0.5"></i> ดึงจาก Base Map: ${v2EscapeHtml(field.source_key)}</div>` : ''}
            </div>
            <button onclick="moveSurveyFormField(${index},-1)" class="w-8 h-8 rounded-lg bg-gray-50 text-gray-500" title="ขึ้น"><i class="fa-solid fa-chevron-up"></i></button>
            <button onclick="moveSurveyFormField(${index},1)" class="w-8 h-8 rounded-lg bg-gray-50 text-gray-500" title="ลง"><i class="fa-solid fa-chevron-down"></i></button>
            <button onclick="editSurveyFormField(${index})" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>
            <button onclick="removeSurveyFormField(${index})" class="w-8 h-8 rounded-lg bg-red-50 text-red-500" title="ลบ"><i class="fa-solid fa-trash"></i></button>
        </div>`).join('');
}

let surveyFieldDragIndex = null;
function startSurveyFieldDrag(index) { surveyFieldDragIndex = index; }
function dropSurveyField(index) {
    if (surveyFieldDragIndex === null || surveyFieldDragIndex === index) return;
    const [field] = surveyFormDraftFields.splice(surveyFieldDragIndex, 1);
    surveyFormDraftFields.splice(index, 0, field);
    surveyFieldDragIndex = null;
    renderSurveyFormFieldsList();
}
function moveSurveyFormField(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= surveyFormDraftFields.length) return;
    [surveyFormDraftFields[index], surveyFormDraftFields[target]] = [surveyFormDraftFields[target], surveyFormDraftFields[index]];
    renderSurveyFormFieldsList();
}

async function openSurveyFieldEditor(existing = null, index = -1) {
    const existingType = normalizeSurveyFieldType(existing?.type);
    const typeOptions = Object.entries(SURVEY_FIELD_TYPES).map(([value, label]) =>
        `<option value="${value}" ${existingType === value ? 'selected' : ''}>${label}</option>`).join('');
    const availableSourceFields = getAvailableBaseMapFieldPaths();
    if (existing?.source_key && !availableSourceFields.includes(existing.source_key)) availableSourceFields.unshift(existing.source_key);
    const sourceOptions = availableSourceFields.map(path => `<option value="${v2EscapeHtml(path)}" ${existing?.source_key === path ? 'selected' : ''}>${v2EscapeHtml(path)}</option>`).join('');
    const result = await Swal.fire({
        title: existing ? 'แก้ไขช่องกรอก' : 'เพิ่มช่องกรอก',
        html: `<div class="text-left space-y-2">
            <label class="text-xs font-bold">ชื่อช่อง</label><input id="ff-label" class="swal2-input !m-0 !w-full" value="${v2EscapeHtml(existing?.label || '')}">
            <label class="text-xs font-bold">รหัสฟิลด์ <span class="font-normal text-gray-400">(ไม่บังคับ)</span></label><input id="ff-key" class="swal2-input !m-0 !w-full" value="${v2EscapeHtml(existing?.key || '')}" placeholder="เว้นว่างไว้ได้ ระบบกำหนดให้อัตโนมัติ">
            <label class="text-xs font-bold">ประเภทข้อมูล</label><select id="ff-type" class="swal2-select !m-0 !w-full">${typeOptions}</select>
            <div class="p-2.5 rounded-xl border border-violet-200 bg-violet-50">
                <label class="text-xs font-bold text-violet-800">ฟังก์ชันฟิลด์: ดึงข้อมูลจาก Base Map</label>
                <select id="ff-source-key" class="swal2-select !m-0 !mt-1 !w-full"><option value="">ไม่ดึงข้อมูลอัตโนมัติ</option>${sourceOptions}</select>
                <p class="text-[10px] text-violet-600 mt-1">เมื่อสำรวจหรือวาดในแปลง ระบบจะเติมค่าจากคอลัมน์นี้ให้อัตโนมัติ</p>
            </div>
            <label class="text-xs font-bold">คำแนะนำในช่อง <span class="font-normal text-gray-400">(ใส่หรือไม่ใส่ก็ได้)</span></label><input id="ff-placeholder" class="swal2-input !m-0 !w-full" value="${v2EscapeHtml(existing?.placeholder || '')}" placeholder="เช่น ระบุชื่อผู้ครอบครอง">
            <label class="text-xs font-bold">ตัวเลือก Dropdown (หนึ่งรายการต่อบรรทัด)</label><textarea id="ff-options" class="swal2-textarea !m-0 !w-full" rows="4">${v2EscapeHtml(normalizeSurveyFieldOptions(existing?.options).filter(option => option.active).map(option => option.label).join('\n'))}</textarea>
            <button type="button" id="ff-add-option-line" class="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-bold text-violet-700"><i class="fa-solid fa-plus mr-1"></i>เพิ่มตัวเลือกบรรทัดถัดไป</button>
            <p class="text-[10px] text-gray-500">แก้ชื่อในบรรทัดเดิมได้เลย ผลสำรวจเก่าจะเปลี่ยนชื่อให้ด้วย; ลบออกจากรายการจะเก็บเป็นค่าเก่าเพื่อไม่ให้ข้อมูลสูญหาย</p>
            <label class="flex items-center gap-2 text-xs font-bold"><input id="ff-dashboard-group" type="checkbox" ${existing?.dashboard_group ? 'checked' : ''}> ใช้ Dropdown นี้จัดกลุ่มกราฟบน Dashboard</label>
            <label class="flex items-center gap-2 text-xs font-bold"><input id="ff-required" type="checkbox" ${existing?.required ? 'checked' : ''}> จำเป็นต้องกรอก</label>
        </div>`,
        showCancelButton: true, confirmButtonText: 'ตกลง', cancelButtonText: 'ยกเลิก',
        allowOutsideClick: false,
        didOpen: () => {
            const typeSelect = document.getElementById('ff-type');
            document.getElementById('ff-options')?.addEventListener('input', event => {
                if (event.target.value.trim() && !['select', 'multiselect'].includes(typeSelect.value)) typeSelect.value = 'select';
            });
            document.getElementById('ff-add-option-line')?.addEventListener('click', () => {
                const options = document.getElementById('ff-options');
                if (!options) return;
                options.value += options.value && !options.value.endsWith('\n') ? '\n' : '';
                options.focus();
                if (!['select', 'multiselect'].includes(typeSelect.value)) typeSelect.value = 'select';
            });
        },
        preConfirm: () => {
            const label = document.getElementById('ff-label').value.trim();
            if (!label) return Swal.showValidationMessage('กรุณาระบุชื่อช่อง');
            const key = surveyFieldKey(document.getElementById('ff-key').value || label, index >= 0 ? index + 1 : surveyFormDraftFields.length + 1);
            const duplicate = surveyFormDraftFields.some((field, fieldIndex) => field.key === key && fieldIndex !== index);
            if (duplicate) return Swal.showValidationMessage('รหัสฟิลด์นี้ถูกใช้แล้ว');
            const parsedOptions = buildSurveyOptionsFromText(document.getElementById('ff-options').value, existing?.options || []);
            let selectedType = normalizeSurveyFieldType(document.getElementById('ff-type').value);
            if (parsedOptions.length && !['select', 'multiselect'].includes(selectedType)) selectedType = 'select';
            return {
                id: existing?.id || `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                label, key, type: selectedType,
                source_key: document.getElementById('ff-source-key').value,
                placeholder: document.getElementById('ff-placeholder').value.trim(),
                required: document.getElementById('ff-required').checked,
                dashboard_group: ['select', 'multiselect'].includes(selectedType) && document.getElementById('ff-dashboard-group').checked,
                options: parsedOptions
            };
        }
    });
    if (!result.isConfirmed) return;
    if (index >= 0) surveyFormDraftFields[index] = result.value;
    else surveyFormDraftFields.push(result.value);
    renderSurveyFormFieldsList();
}

function addSurveyFormField() { return openSurveyFieldEditor(); }
function editSurveyFormField(index) { return openSurveyFieldEditor(surveyFormDraftFields[index], index); }
function removeSurveyFormField(index) { surveyFormDraftFields.splice(index, 1); renderSurveyFormFieldsList(); }

function copySurveyFormFromWorkGroup() {
    const id = document.getElementById('copy-form-source')?.value;
    const source = v2SurveyForms.find(form => form.id === id);
    if (!source) return Swal.fire('ยังไม่มีแบบฟอร์ม', 'กรุณาสร้างแบบฟอร์มในกลุ่มงานอื่นก่อน', 'info');
    surveyFormDraftFields = JSON.parse(JSON.stringify(source.fields || [])).map((field, index) => ({ ...field, id: `field_${Date.now()}_${index}` }));
    document.getElementById('survey-form-name').value = `${source.name} (สำเนา)`;
    document.getElementById('survey-form-layer-type').value = normalizeSurveyLayerType(source.layer_type);
    document.getElementById('survey-form-point-color').value = normalizeSurveyLayerColor(source.layer_point_color || source.layer_color);
    document.getElementById('survey-form-polygon-color').value = normalizeSurveyLayerColor(source.layer_polygon_color || source.layer_color);
    updateSurveyLayerColorSwatch('survey-form-point-color');
    updateSurveyLayerColorSwatch('survey-form-polygon-color');
    renderSurveyFormFieldsList();
}

async function onSurveyFormWorkGroupChange() {
    if (isSurveyFormDraftDirty()) {
        const confirmed = await Swal.fire({ title: 'เปลี่ยนกลุ่มงานสำหรับแบบฟอร์ม?', text: 'การแก้ไขที่ยังไม่ได้บันทึกในกลุ่มเดิมจะไม่ถูกเก็บ', icon: 'warning', showCancelButton: true, confirmButtonText: 'เปลี่ยนกลุ่ม', cancelButtonText: 'อยู่กลุ่มเดิม' });
        if (!confirmed.isConfirmed) {
            const select = document.getElementById('survey-form-work-group');
            if (select) select.value = surveyFormBuilderGroupId || v2ActiveWorkGroup?.id || '';
            return;
        }
    }
    surveyFormBuilderGroupId = document.getElementById('survey-form-work-group')?.value || null;
    loadSurveyFormBuilder();
}
window.onSurveyFormWorkGroupChange = onSurveyFormWorkGroupChange;

function mapImportedSurveyFieldType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (/textarea|หลายบรรทัด|รายละเอียด/.test(type)) return 'textarea';
    if (/number|numeric|integer|decimal|ตัวเลข|จำนวน/.test(type)) return 'number';
    if (/datetime|วัน.*เวลา/.test(type)) return 'datetime';
    if (/date|วันที่/.test(type)) return 'date';
    if (/time|เวลา/.test(type)) return 'time';
    if (/multi|หลายรายการ/.test(type)) return 'multiselect';
    if (/select|dropdown|drop.?down|ตัวเลือก/.test(type)) return 'select';
    if (/bool|checkbox|ใช่.*ไม่ใช่/.test(type)) return 'checkbox';
    return normalizeSurveyFieldType(type);
}

async function importSurveyFormExcel(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
        if (!rows.length) throw new Error('ไม่พบข้อมูลในชีตแรก');
        const headers = Object.keys(rows[0]);
        const findHeader = aliases => headers.find(header => aliases.some(alias => header.trim().toLowerCase() === alias));
        const labelHeader = findHeader(['label', 'name', 'field', 'ชื่อฟิลด์', 'ชื่อช่อง', 'รายการฟิลด์']);
        const keyHeader = findHeader(['key', 'code', 'รหัสฟิลด์', 'รหัส']);
        const typeHeader = findHeader(['type', 'data type', 'ประเภท', 'ชนิดข้อมูล']);
        const requiredHeader = findHeader(['required', 'จำเป็น', 'บังคับ']);
        const optionsHeader = findHeader(['options', 'ตัวเลือก', 'dropdown']);
        const placeholderHeader = findHeader(['placeholder', 'คำแนะนำ', 'ตัวอย่าง']);
        const sourceHeader = findHeader(['source_key', 'source field', 'base map field', 'ฟิลด์ต้นทาง', 'ดึงจาก base map', 'คอลัมน์ base map']);
        const structuredTemplate = Boolean(typeHeader || keyHeader || ['ชื่อฟิลด์', 'ชื่อช่อง', 'รายการฟิลด์'].includes(String(labelHeader || '').trim().toLowerCase()));
        let imported;
        if (structuredTemplate) {
            imported = rows.map((row, index) => {
                const label = String(row[labelHeader] || row[keyHeader] || '').trim();
                const requiredText = String(row[requiredHeader] || '').trim().toLowerCase();
                return {
                    id: `field_${Date.now()}_${index}`,
                    label,
                    key: surveyFieldKey(row[keyHeader] || label, index + 1),
                    type: mapImportedSurveyFieldType(row[typeHeader]),
                    required: /^(1|true|yes|y|ใช่|บังคับ)$/.test(requiredText),
                    placeholder: String(row[placeholderHeader] || '').trim(),
                    source_key: String(row[sourceHeader] || '').trim(),
                    options: buildSurveyOptionsFromText(String(row[optionsHeader] || ''))
                };
            }).filter(field => field.label);
        } else {
            imported = headers.map((header, index) => ({
                id: `field_${Date.now()}_${index}`, label: header, key: surveyFieldKey(header, index + 1),
                type: mapImportedSurveyFieldType(rows[0][header]), required: false, placeholder: '', options: []
            }));
        }
        const usedKeys = new Set();
        imported.forEach((field, index) => {
            let key = field.key;
            while (usedKeys.has(key)) key = `${field.key}_${index + 1}`;
            field.key = key; usedKeys.add(key);
        });
        surveyFormDraftFields = imported;
        renderSurveyFormFieldsList();
        Swal.fire({ toast: true, icon: 'success', title: `นำเข้า ${imported.length} ช่องแล้ว สามารถเรียงและแก้ไขต่อได้`, timer: 2200, showConfirmButton: false });
    } catch (error) {
        Swal.fire('นำเข้าแบบฟอร์มไม่สำเร็จ', error.message, 'error');
    } finally {
        input.value = '';
    }
}

function downloadSurveyFormTemplate() {
    const rows = [
        { 'ชื่อฟิลด์': 'เลขทะเบียน', 'รหัสฟิลด์': 'registration_no', 'ประเภท': 'text', 'จำเป็น': 'ใช่', 'ตัวเลือก': '', 'คำแนะนำ': '', 'ฟิลด์ต้นทาง': 'REGISTRATION_NO' },
        { 'ชื่อฟิลด์': 'ประเภทการใช้ประโยชน์', 'รหัสฟิลด์': 'land_use', 'ประเภท': 'dropdown', 'จำเป็น': 'ใช่', 'ตัวเลือก': 'เกษตร|ที่อยู่อาศัย|พาณิชย์|อื่นๆ', 'คำแนะนำ': '', 'ฟิลด์ต้นทาง': 'LAND_USE' },
        { 'ชื่อฟิลด์': 'จำนวน', 'รหัสฟิลด์': 'amount', 'ประเภท': 'number', 'จำเป็น': 'ไม่', 'ตัวเลือก': '', 'คำแนะนำ': 'กรอกเป็นตัวเลข', 'ฟิลด์ต้นทาง': '' }
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 42 }, { wch: 28 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Form Fields');
    XLSX.writeFile(workbook, 'SurveyPro_Form_Template.xlsx');
}

async function saveSurveyFormDefinition(options = {}) {
    const silent = options.silent === true;
    const targetGroup = getSurveyFormBuilderGroup();
    if (!targetGroup || !currentUser) return;
    const name = document.getElementById('survey-form-name')?.value.trim();
    const layerType = normalizeSurveyLayerType(document.getElementById('survey-form-layer-type')?.value);
    const pointColor = normalizeSurveyLayerColor(document.getElementById('survey-form-point-color')?.value);
    const polygonColor = normalizeSurveyLayerColor(document.getElementById('survey-form-polygon-color')?.value);
    if (!name) { Swal.fire('กรุณาตั้งชื่อแบบฟอร์ม', '', 'warning'); return false; }
    const existing = getSurveyFormForWorkGroup(targetGroup.id);
    const previousFields = JSON.parse(JSON.stringify(existing?.fields || []));
    showLoading(true, 'กำลังบันทึกแบบฟอร์ม...');
    try {
        const payload = {
            team_id: currentUser.team_id, work_group_id: targetGroup.id, name,
            version: (existing?.version || 0) + 1,
            fields: surveyFormDraftFields.map((field, index) => ({
                ...field,
                options: normalizeSurveyFieldOptions(field.options),
                sort_order: index
            })),
            layer_type: layerType,
            layer_color: layerType === 'polygon' ? polygonColor : pointColor,
            layer_point_color: pointColor,
            layer_polygon_color: polygonColor,
            created_by: existing?.created_by || currentUser.id,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabaseClient.from('survey_forms').upsert(payload, { onConflict: 'team_id,work_group_id' }).select().single();
        if (error) throw error;
        const migratedCount = await migrateSavedSurveyFormValues(previousFields, data.fields || [], targetGroup.id);
        v2SurveyForms = [...v2SurveyForms.filter(form => form.work_group_id !== data.work_group_id), data];
        if (migratedCount) await syncJobsSilently();
        surveyFormDraftFields = JSON.parse(JSON.stringify(data.fields || []));
        surveyFormDraftBaseline = JSON.stringify(surveyFormDraftFields);
        surveyFormNameBaseline = data.name;
        surveyFormLayerSettingsBaseline = JSON.stringify({
            type: normalizeSurveyLayerType(data.layer_type),
            pointColor: normalizeSurveyLayerColor(data.layer_point_color || data.layer_color),
            polygonColor: normalizeSurveyLayerColor(data.layer_polygon_color || data.layer_color)
        });
        renderSurveyFormFieldsList();
        Swal.fire({ toast: true, icon: 'success', title: silent ? 'บันทึกแบบฟอร์มอัตโนมัติแล้ว' : `บันทึกแบบฟอร์มเวอร์ชัน ${data.version} แล้ว${migratedCount ? ` · อัปเดตผลเดิม ${migratedCount} รายการ` : ''}`, timer: 2200, showConfirmButton: false });
        return true;
    } catch (error) {
        Swal.fire('บันทึกแบบฟอร์มไม่สำเร็จ', error.message, 'error');
        return false;
    } finally { showLoading(false); }
}

function copyUserCode() {
    const code = document.getElementById('profile-user-code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'คัดลอกรหัสเข้าคลิปบอร์ดแล้ว', timer: 1500, showConfirmButton: false });
    });
}

// --- Team Collaboration Logic ---
async function loadTeamMembers() {
    if (!supabaseClient || !currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('id, email, display_name, user_code')
            .eq('team_id', currentUser.team_id);

        if (error) throw error;

        const listEl = document.getElementById('team-members-list');
        listEl.innerHTML = '';

        data.forEach(m => {
            const isSelf = m.id === currentUser.id;
            const isOwner = currentUser.team_id === currentUser.id;

            let actionBtn = '';
            if (isSelf) {
                actionBtn = `<span class="text-[9px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">คุณ (หัวหน้า)</span>`;
                if (currentUser.team_id !== currentUser.id) {
                    actionBtn = `<span class="text-[9px] bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">คุณ</span>`;
                }
            } else if (isOwner) {
                actionBtn = `<button onclick="removeTeamMember('${m.id}')" class="text-[10px] text-red-500 hover:text-red-700 font-bold"><i class="fa-solid fa-user-minus"></i> ลบ</button>`;
            }

            listEl.innerHTML += `
                        <div data-team-member-id="${m.id}" class="flex items-center justify-between p-2 border border-gray-100 rounded-xl bg-gray-50/50">
                            <div>
                                <div class="text-xs font-bold text-gray-850">${m.display_name || 'ผู้ใช้ร่วมกัน'}</div>
                                <div class="text-[10px] text-gray-400">${m.email} (${m.user_code})</div>
                            </div>
                            <div class="flex items-center gap-1">${actionBtn}</div>
                        </div>`;
        });

        if (data.length <= 1) {
            listEl.innerHTML += `<div class="team-empty-state text-[11px] text-gray-400 text-center py-3">ยังไม่มีสมาชิกอื่นในทีมสำรวจนี้</div>`;
        }
    } catch (e) {
        console.error("Load team members error", e);
    }
}

async function addTeamMemberByCode() {
    const code = document.getElementById('inp-add-member-code').value.trim();
    if (!code) return Swal.fire('กรุณาระบุรหัส', 'ใส่รหัสของสมาชิกที่ต้องการร่วมสำรวจด้วยกัน', 'warning');
    if (code === currentUser.user_code) return Swal.fire('ผิดพลาด', 'คุณไม่สามารถเพิ่มตัวคุณเองได้', 'warning');

    showLoading(true, 'กำลังหาข้อมูลสมาชิก...');
    try {
        // ค้นหาผู้ใช้อื่นที่มี user_code นี้
        const { data: member, error: findErr } = await supabaseClient
            .from('profiles')
            .select('id, display_name')
            .eq('user_code', code)
            .single();

        if (findErr || !member) {
            throw new Error('ไม่พบข้อมูลรหัสสมาชิกนี้ กรุณาตรวจสอบรหัสของเพื่อนคุณอีกครั้ง');
        }

        // This RPC has the narrowly scoped server-side permission needed to
        // update another user's team_id while RLS remains enabled.
        const { data: joinedRows, error: updErr } = await supabaseClient
            .rpc('add_team_member_by_code', { member_code: code });
        if (updErr) throw updErr;
        const joinedMember = Array.isArray(joinedRows) ? joinedRows[0] : joinedRows;
        if (!joinedMember?.id) throw new Error('เพิ่มสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');

        document.getElementById('inp-add-member-code').value = '';
        Swal.fire('สำเร็จ', `เพิ่มคุณ ${joinedMember.display_name || member.display_name} เข้าทีมสำรวจร่วมกันแล้ว`, 'success');
        await loadTeamMembers();
        // Render immediately even if the profiles read is still catching up after
        // the team-id update, so the owner can see the successful addition now.
        const listEl = document.getElementById('team-members-list');
        if (listEl && !listEl.querySelector(`[data-team-member-id="${member.id}"]`)) {
            listEl.querySelectorAll('.team-empty-state').forEach(el => el.remove());
            const shown = joinedMember;
            listEl.insertAdjacentHTML('beforeend', `<div data-team-member-id="${shown.id}" class="flex items-center justify-between p-2 border border-gray-100 rounded-xl bg-gray-50/50"><div class="min-w-0"><div class="text-xs font-bold text-gray-850 truncate">${v2EscapeHtml(shown.display_name || 'ผู้ใช้ร่วมกัน')}</div><div class="text-[10px] text-gray-400 truncate">${v2EscapeHtml(shown.email || '')} (${v2EscapeHtml(shown.user_code || code)})</div></div><span class="text-[9px] bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">สมาชิกใหม่</span></div>`);
        }
    } catch (e) {
        Swal.fire('ล้มเหลว', e.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function leaveTeam() {
    if (currentUser.team_id === currentUser.id) {
        return Swal.fire('แจ้งเตือน', 'คุณกำลังทำงานคนเดียว (เป็นหัวหน้าทีมของตัวเอง)', 'info');
    }

    Swal.fire({
        title: 'ออกจากทีมสำรวจ?',
        text: 'คุณจะไม่เห็นจุดบนแผนที่ของทีมนี้ และระบบจะรีเซ็ตห้องทำงานส่วนตัวให้คุณใหม่',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444'
    }).then(async (r) => {
        if (r.isConfirmed) {
            showLoading(true, 'กำลังดึงข้อมูลออกจากทีม...');
            try {
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({ team_id: currentUser.id })
                    .eq('id', currentUser.id);

                if (error) throw error;

                currentUser.team_id = currentUser.id;
                Swal.fire('สำเร็จ', 'ออกจากทีมและสร้างห้องทำงานคนเดียวแล้ว', 'success');
                await loadTeamMembers();
                await syncJobsFromDB();
            } catch (err) {
                Swal.fire('ออกจากทีมล้มเหลว', err.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    });
}

async function removeTeamMember(id) {
    Swal.fire({
        title: 'ยืนยันความปลอดภัย',
        text: 'กรุณากรอกรหัสผ่านบัญชีของคุณเพื่อยืนยันการลบสมาชิกออกจากทีม',
        input: 'password',
        inputPlaceholder: 'รหัสผ่านของคุณ',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'ยืนยันรหัสผ่านเพื่อลบ',
        cancelButtonText: 'ยกเลิก',
        inputAttributes: {
            autocapitalize: 'off',
            autocorrect: 'off'
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const password = result.value;
            if (!password) {
                return Swal.fire('ผิดพลาด', 'กรุณากรอกรหัสผ่านเพื่อดำเนินการต่อ', 'error');
            }

            showLoading(true, 'กำลังตรวจสอบความถูกต้อง...');
            try {
                const currentEmail = currentUser.email;
                if (!currentEmail) throw new Error("ไม่พบอีเมลผู้ใช้งานปัจจุบัน");

                const { error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: currentEmail,
                    password: password
                });

                if (authError) throw new Error("รหัสผ่านไม่ถูกต้อง");

                showLoading(true, 'กำลังลบสมาชิกออกจากกลุ่ม...');
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({ team_id: id })
                    .eq('id', id);

                if (error) throw error;

                Swal.fire('สำเร็จ', 'นำผู้ใช้งานออกจากกลุ่มสำรวจแล้ว', 'success');
                await loadTeamMembers();
            } catch (err) {
                Swal.fire('การลบสมาชิกล้มเหลว', err.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    });
}

function renderImportedMapsList() {
    const listDiv = document.getElementById('imported-maps-list');
    if (!listDiv) return;

    if (!currentUser) {
        listDiv.innerHTML = '<div class="text-[11px] text-gray-400 text-center py-3">กรุณาเข้าสู่ระบบ</div>';
        return;
    }

    // Group jobs in dbJobs by both category and import_source
    const importJobs = dbJobs.filter(j => j.properties && j.properties.import_source);

    // Grouping
    const groups = {};
    importJobs.forEach(job => {
        const cat = job.category || 'ทั่วไป';
        const src = job.properties.import_source;
        const key = `${cat}|||${src}`;
        if (!groups[key]) {
            groups[key] = {
                category: cat,
                source: src,
                count: 0
            };
        }
        groups[key].count++;
    });

    const sources = Object.values(groups);

    if (sources.length === 0) {
        listDiv.innerHTML = '<div class="text-[11px] text-gray-400 text-center py-3">ไม่มีข้อมูลการนำเข้า</div>';
        return;
    }

    let html = '';
    sources.forEach(group => {
        let displayName = group.source;
        if (displayName.startsWith('http://') || displayName.startsWith('https://')) {
            try {
                const urlObj = new URL(displayName);
                displayName = 'ไฟล์นำเข้า: ' + (urlObj.pathname.split('/').pop() || urlObj.hostname);
            } catch (e) {
                displayName = 'Link: ' + displayName.substring(0, 30) + '...';
            }
        }

        const escapedSource = group.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const escapedCategory = group.category.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        html += `
            <div class="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition">
                <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-gray-700 truncate" title="${group.source}">${displayName}</p>
                    <div class="flex flex-wrap items-center gap-1.5 mt-1">
                        <span class="inline-flex items-center text-[9px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                            ประเภทงาน: ${group.category}
                        </span>
                        <span class="text-[10px] text-gray-500">${group.count} แปลงแผนที่</span>
                    </div>
                </div>
                <button onclick="deleteImportedMap('${escapedSource}', '${escapedCategory}')"
                    class="text-xs text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition ml-2 flex-shrink-0"
                    title="ลบข้อมูลการนำเข้านี้">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
    });

    listDiv.innerHTML = html;
}

async function deleteImportedMap(source, category) {
    if (!supabaseClient || !currentUser) return;

    const targetJobs = dbJobs.filter(j => j.category === category && j.properties && j.properties.import_source === source);
    if (targetJobs.length === 0) return;

    const result = await Swal.fire({
        title: 'ยืนยันการลบแผนที่นำเข้า?',
        text: `แปลงที่ดินทั้งหมด ${targetJobs.length} รายการ จากแหล่งข้อมูล "${source}" (ประเภทงาน: ${category}) จะถูกลบถาวรจากฐานข้อมูล รวมทั้งรูปภาพบันทึกต่างๆ (ถ้ามี)`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ลบข้อมูล',
        cancelButtonText: 'ยกเลิก'
    });

    if (!result.isConfirmed) return;

    const pwdResult = await Swal.fire({
        title: 'ยืนยันความปลอดภัย',
        text: 'กรุณากรอกรหัสผ่านบัญชีของคุณเพื่อยืนยันการลบแผนที่นำเข้า',
        input: 'password',
        inputPlaceholder: 'รหัสผ่านของคุณ',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'ยืนยันรหัสผ่านเพื่อลบ',
        cancelButtonText: 'ยกเลิก',
        inputAttributes: {
            autocapitalize: 'off',
            autocorrect: 'off'
        }
    });

    if (!pwdResult.isConfirmed) return;

    const password = pwdResult.value;
    if (!password) {
        return Swal.fire('ผิดพลาด', 'กรุณากรอกรหัสผ่านเพื่อดำเนินการต่อ', 'error');
    }

    showLoading(true, 'กำลังตรวจสอบความถูกต้อง...');
    try {
        const currentEmail = currentUser.email;
        if (!currentEmail) throw new Error("ไม่พบอีเมลผู้ใช้งานปัจจุบัน");

        const { error: authError } = await supabaseClient.auth.signInWithPassword({
            email: currentEmail,
            password: password
        });

        if (authError) throw new Error("รหัสผ่านไม่ถูกต้อง");
    } catch (e) {
        showLoading(false);
        return Swal.fire('ทำรายการไม่สำเร็จ', e.message, 'error');
    }

    showLoading(true, 'กำลังลบแผนที่นำเข้า...');

    try {
        const batchIds = targetJobs.map(j => j.id);

        const imagesToDelete = [];
        targetJobs.forEach(job => {
            if (job.properties && job.properties.images && Array.isArray(job.properties.images)) {
                job.properties.images.forEach(img => {
                    const publicId = img ? (img.public_id || getPublicIdFromUrl(typeof img === 'string' ? img : img.url)) : null;
                    if (publicId) {
                        imagesToDelete.push(publicId);
                    }
                });
            }
        });

        const { error } = await supabaseClient
            .from('jobs')
            .delete()
            .eq('category', category)
            .eq('properties->>import_source', source)
            .eq('team_id', currentUser.team_id);

        if (error) throw error;

        if (imagesToDelete.length > 0) {
            imagesToDelete.forEach(publicId => {
                fetch(GAS_URL + "?publicId=" + encodeURIComponent(publicId), { mode: 'no-cors' })
                    .catch(err => console.error("Cloudinary deletion failed on background:", err));
            });
        }

        showLoading(false);
        Swal.fire('ลบข้อมูลเรียบร้อย', `ลบแปลงที่ดินและรูปภาพทั้งหมด ${targetJobs.length} รายการออกแล้ว`, 'success');

        await syncJobsFromDB();
        renderImportedMapsList();
    } catch (e) {
        showLoading(false);
        console.error("Delete imported map error", e);
        Swal.fire('ลบล้มเหลว', e.message, 'error');
    }
}

// --- Database & Category Modifiers ---
function addCat() {
    Swal.fire({ input: 'text', title: 'เพิ่มหมวดใหม่' }).then(r => {
        if (r.value) {
            categories.push(r.value);
            localStorage.setItem('survey_cats_v16', JSON.stringify(categories));
            openToolsMenu();
        }
    });
}

function clearAll() {
    Swal.fire({
        title: 'ยืนยันล้างข้อมูลทั้งหมด?',
        text: 'จุดและข้อมูลแผนที่ในทีมของคุณจะถูกลบออกจากฐานข้อมูลคลาวด์ถาวร',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'red'
    }).then(async (r) => {
        if (r.isConfirmed) {
            showLoading(true, 'กำลังเคลียร์ข้อมูล...');
            try {
                await clearAllSupabaseJobs();
                dbJobs = [];
                renderMap();
                closeSettingsModal();
                Swal.fire('ล้างข้อมูลสำเร็จ', 'แผนที่ว่างเปล่าเรียบร้อย', 'success');
            } catch (e) {
                Swal.fire('ล้างข้อมูลไม่สำเร็จ', e.message, 'error');
            } finally {
                showLoading(false);
            }
        }
    });
}

let calCurrentDate = new Date();
let calSelectedDate = null;
let calExportJobs = [];
let calExportGroup = null;

function getDatesWithData() {
    const dates = new Map();
    calExportJobs.filter(j => j.status === 'done').forEach(j => {
        const d = j.properties.date || (j.updated_at ? j.updated_at.split('T')[0] : '');
        if (d) {
            dates.set(d, (dates.get(d) || 0) + 1);
        }
    });
    return dates;
}

function v2ComposeExportJobs(group, records) {
    const mapById = new Map(v2BaseMaps.map(item => [item.id, item]));
    const recordByPlot = new Map((records || []).map(item => [item.base_plot_id, item]));
    const mapIds = new Set(v2BaseMaps
        .filter(baseMap => baseMap.work_group_id === group.id || (!baseMap.work_group_id && group.name === 'ทั่วไป'))
        .map(baseMap => baseMap.id));
    return v2BasePlots.filter(plot => {
        if (!mapIds.has(plot.base_map_id)) return false;
        const sourceProps = plot.source_properties || {};
        return sourceProps.is_custom_draw !== true || recordByPlot.has(plot.id) || sourceProps.work_group_id === group.id;
    }).map(plot => {
        const record = recordByPlot.get(plot.id);
        const recordProps = record?.record_properties || {};
        const baseMap = mapById.get(plot.base_map_id);
        return {
            id: plot.id, lat: plot.lat, lng: plot.lng, geometry: plot.geometry,
            status: record?.status || 'waiting', category: group.name,
            updated_at: record?.updated_at || plot.updated_at,
            properties: {
                ...(plot.source_properties || {}), ...recordProps,
                name: recordProps.name || plot.display_name,
                note: record?.note || '', images: record?.images || [],
                date: record?.recorded_at ? record.recorded_at.split('T')[0] : (recordProps.date || ''),
                import_source: baseMap?.name || baseMap?.source_name || '',
                work_group_id: group.id
            }
        };
    });
}

async function loadExportWorkGroup(groupId) {
    const group = v2VisibleWorkGroups().find(item => item.id === groupId);
    if (!group) return;
    const { data, error } = await supabaseClient.from('plot_records').select('*').eq('work_group_id', group.id);
    if (error) throw error;
    calExportGroup = group;
    calExportJobs = v2ComposeExportJobs(group, data || []);
    calSelectedDate = null;
    renderExportCalendar();
}

async function openExportCalendarModal() {
    closeSettingsModal();
    calSelectedDate = null;
    calCurrentDate = new Date(); // Reset to today's month

    const titleEl = document.getElementById('export-calendar-title');
    if (titleEl) {
        titleEl.innerHTML = '<i class="fa-solid fa-file-export text-emerald-600"></i> ตั้งค่าการส่งออก';
    }

    const groupSelect = document.getElementById('export-work-group');
    if (groupSelect) {
        const visibleGroups = v2VisibleWorkGroups();
        groupSelect.innerHTML = visibleGroups.map(group => `<option value="${v2EscapeHtml(group.id)}">${v2EscapeHtml(group.name)}</option>`).join('');
        groupSelect.value = v2ActiveWorkGroup?.id || visibleGroups[0]?.id || '';
    }
    document.getElementById('export-format-excel').checked = true;
    document.getElementById('export-format-shp').checked = true;
    document.getElementById('export-format-photos').checked = true;
    document.getElementById('export-format-report').checked = false;
    const allDateMode = document.querySelector('input[name="export-date-mode"][value="all"]');
    if (allDateMode) allDateMode.checked = true;

    const actionContainer = document.getElementById('cal-action-container');
    if (actionContainer) actionContainer.classList.add('hidden');
    document.getElementById('export-calendar-modal').classList.add('active');
    onExportDateModeChange();
    try {
        await loadExportWorkGroup(groupSelect?.value);
    } catch (error) {
        Swal.fire('โหลดข้อมูลส่งออกไม่สำเร็จ', error.message, 'error');
    }
}

async function onExportWorkGroupChange() {
    try {
        showLoading(true, 'กำลังโหลดข้อมูลกลุ่มงาน...');
        await loadExportWorkGroup(document.getElementById('export-work-group')?.value);
    } catch (error) {
        Swal.fire('โหลดข้อมูลส่งออกไม่สำเร็จ', error.message, 'error');
    } finally { showLoading(false); }
}

function onExportDateModeChange() {
    const dateMode = document.querySelector('input[name="export-date-mode"]:checked')?.value;
    const calendar = document.getElementById('cal-days-grid')?.parentElement?.parentElement;
    // The calendar stays interactive in both modes; tapping a day switches
    // to date export automatically, so the control never feels disabled.
    if (calendar) calendar.classList.remove('pointer-events-none');
    const action = document.getElementById('cal-action-container');
    if (dateMode !== 'date') action?.classList.add('hidden');
}

function closeExportCalendarModal() {
    document.getElementById('export-calendar-modal').classList.remove('active');
    openToolsMenu();
}

function navigateExportCalendar(direction) {
    calCurrentDate.setMonth(calCurrentDate.getMonth() + direction);
    renderExportCalendar();
}

function renderExportCalendar() {
    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();

    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];

    const monthYearEl = document.getElementById('cal-month-year');
    if (monthYearEl) {
        monthYearEl.innerText = `${thaiMonths[month]} ${year + 543}`;
    }

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const grid = document.getElementById('cal-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const datesWithData = getDatesWithData();

    // Render empty cells for leading blank days
    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="cal-day cal-day-empty"></div>`;
    }

    // Render days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasData = datesWithData.has(dateStr);
        const isSelected = calSelectedDate === dateStr;

        let classes = "cal-day ";
        let onClickAttr = "";

        if (isSelected) {
            classes += "cal-day-selected";
            onClickAttr = `onclick="selectExportDate('${dateStr}')"`;
        } else if (hasData) {
            classes += "cal-day-has-data";
            onClickAttr = `onclick="selectExportDate('${dateStr}')"`;
        } else {
            classes += "cal-day-disabled";
        }

        grid.innerHTML += `<div class="${classes}" ${onClickAttr}>${day}</div>`;
    }
}

function selectExportDate(dateStr) {
    const dateMode = document.querySelector('input[name="export-date-mode"][value="date"]');
    if (dateMode && !dateMode.checked) {
        dateMode.checked = true;
        onExportDateModeChange();
    }
    calSelectedDate = dateStr;

    // Format for display
    const parts = dateStr.split('-');
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const count = getDatesWithData().get(dateStr) || 0;
    const displayStr = `${parseInt(parts[2])} ${thaiMonths[parseInt(parts[1]) - 1]} ${parseInt(parts[0]) + 543} (จำนวน ${count} รายการ)`;

    const displayEl = document.getElementById('cal-selected-display');
    if (displayEl) displayEl.innerText = displayStr;

    const actionContainer = document.getElementById('cal-action-container');
    if (actionContainer) actionContainer.classList.remove('hidden');

    renderExportCalendar();
}

function getExportImageEntries(job) {
    const entries = [];
    const append = (images, scope) => (images || []).forEach((image, index) => {
        const url = typeof image === 'string' ? image : image?.url;
        if (!url) return;
        const publicId = typeof image === 'object' ? image?.public_id : getPublicIdFromUrl(url);
        const sourceName = String(publicId || url.split('?')[0].split('/').pop() || `image_${index + 1}`);
        const extension = (url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'jpg').toLowerCase();
        entries.push({ url, name: `${scope}_${String(index + 1).padStart(2, '0')}_${sourceName.replace(/[^a-zA-Z0-9ก-๙_.-]+/g, '_')}.${extension}`.replace(/\.(jpg|jpeg|png|webp)\.(jpg|jpeg|png|webp)$/i, '.$2') });
    });
    append(job.properties?.images, `plot_${job.id}`);
    (job.properties?.survey_features || []).forEach((feature, index) => append(feature?.images, `feature_${job.id}_${index + 1}`));
    return entries;
}

function buildExcelExportRows(data) {
    return data.map(j => {
            const sourceColumns = {};
            Object.entries(j.properties || {}).forEach(([key, value]) => {
                if (!['images', 'search_text'].includes(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
                    sourceColumns[key] = value ?? '';
                }
            });
            const formData = j.properties?.form_data || {};
            const exportFields = Array.isArray(j.properties?.form_schema) && j.properties.form_schema.length
                ? j.properties.form_schema : (getActiveSurveyForm()?.fields || []);
            exportFields.forEach(field => {
                const value = formData[field.key];
                sourceColumns[`Form_${field.key}`] = Array.isArray(value) ? value.join(', ') : (value ?? '');
            });
            return {
                ...sourceColumns,
                ID: j.id,
                Name: j.properties.name,
                WorkGroup: j.category,
                Status: j.status,
                Tambon: j.properties.tambon || j.properties.TUMB_NAME || '',
                Amphoe: j.properties.amphoe || j.properties.AMPH_NAME || '',
                Area: j.properties.area || '',
                Note: j.properties.note,
                Lat: j.lat,
                Lng: j.lng,
                Date: j.properties.date || (j.updated_at ? j.updated_at.split('T')[0] : ''),
                SurveyFeatureCount: Array.isArray(j.properties.survey_features) ? j.properties.survey_features.length : 0,
                ImageCount: getExportImageEntries(j).length,
                ImageFileNames: getExportImageEntries(j).map(image => image.name).join('; '),
                ImageURLs: getExportImageEntries(j).map(image => image.url).join('; '),
                SurveyFeaturesGeoJSON: JSON.stringify((j.properties.survey_features || []).map(feature => ({
                    id: feature.id,
                    shape: feature.shape,
                    geometry: feature.geometry,
                    radius: feature.radius || 0,
                    created_at: feature.created_at
                })))
            };
        });
}

async function exportSurveyPhotos(jobs, filePrefix) {
    const images = jobs.flatMap(job => getExportImageEntries(job));
    if (!images.length) return Swal.fire('ไม่พบภาพถ่าย', 'ไม่มีภาพถ่ายในข้อมูลที่เลือกส่งออก', 'info');
    if (!window.JSZip) return Swal.fire('ไม่สามารถรวมภาพถ่าย', 'ไลบรารีจัดเก็บไฟล์ยังโหลดไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่', 'error');
    showLoading(true, `กำลังเตรียมภาพถ่าย ${images.length} รูป...`);
    try {
        const zip = new JSZip();
        let completed = 0;
        await Promise.all(images.map(async (image, index) => {
            try {
                const response = await fetch(image.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                zip.file(image.name || `photo_${index + 1}.jpg`, await response.blob());
                completed++;
            } catch (error) {
                console.warn('ข้ามภาพที่ดาวน์โหลดไม่สำเร็จ', image.url, error);
            }
        }));
        if (!completed) throw new Error('ดาวน์โหลดภาพถ่ายไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อหรือสิทธิ์เข้าถึงรูปภาพ');
        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filePrefix}_photos.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        if (completed < images.length) Swal.fire('ส่งออกภาพถ่ายแล้ว', `บันทึกได้ ${completed} จาก ${images.length} รูป`, 'warning');
    } catch (error) {
        Swal.fire('ส่งออกภาพถ่ายไม่สำเร็จ', error.message, 'error');
    } finally { showLoading(false); }
}

function confirmExportCalendar() {
    const dateMode = document.querySelector('input[name="export-date-mode"]:checked')?.value || 'all';
    if (dateMode === 'date' && !calSelectedDate) {
        return Swal.fire('กรุณาเลือกวัน', 'คุณยังไม่ได้เลือกวันที่ต้องการส่งออก', 'warning');
    }
    const data = calExportJobs.filter(job => {
        if (job.status !== 'done') return false;
        if (dateMode === 'all') return true;
        const date = job.properties.date || (job.updated_at ? job.updated_at.split('T')[0] : '');
        return date === calSelectedDate;
    });
    if (!data.length) return Swal.fire('ไม่มีข้อมูล', dateMode === 'all' ? 'ไม่มีข้อมูลงานเสร็จสิ้นเพื่อส่งออก' : 'ไม่มีข้อมูลงานเสร็จสิ้นในวันที่เลือก', 'warning');
    const formats = {
        excel: document.getElementById('export-format-excel')?.checked,
        shp: document.getElementById('export-format-shp')?.checked,
        photos: document.getElementById('export-format-photos')?.checked,
        report: document.getElementById('export-format-report')?.checked
    };
    if (!formats.excel && !formats.shp && !formats.photos && !formats.report) return Swal.fire('กรุณาเลือกประเภทไฟล์', 'เลือกอย่างน้อย Excel, Shapefile, ภาพถ่าย หรือรายงาน', 'warning');

    const suffix = dateMode === 'all' ? 'ALL' : calSelectedDate;
    const groupName = calExportGroup?.name || currentUser?.category || 'ทั่วไป';
    const prefix = `SURVEY_${groupName.replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_')}_${suffix}`;
    closeExportCalendarModal();
    if (formats.excel) {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildExcelExportRows(data)), 'Data');
        XLSX.writeFile(wb, `${prefix}.xlsx`);
    }
    if (formats.shp) exportSurveyShapefile(data, suffix, groupName);
    if (formats.photos) exportSurveyPhotos(data, prefix);
    if (formats.report) generateReport(data, groupName);
}

function exportSurveyShapefile(jobs, suffix = 'ALL', workGroupName = null) {
    if (!window.shpwrite) return Swal.fire('ไม่สามารถสร้าง Shapefile', 'ไลบรารีส่งออกยังโหลดไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่', 'error');
    const allFormFields = [];
    const seenFieldKeys = new Set();
    jobs.forEach(job => {
        const schema = Array.isArray(job.properties?.form_schema) && job.properties.form_schema.length
            ? job.properties.form_schema : (getActiveSurveyForm()?.fields || []);
        schema.forEach(field => { if (!seenFieldKeys.has(field.key)) { seenFieldKeys.add(field.key); allFormFields.push(field); } });
    });
    const usedNames = new Set(['PLOT_ID', 'WORKGROUP', 'STATUS', 'SURVEY_DT', 'NOTE', 'IMG_FILES']);
    const fieldMap = new Map();
    allFormFields.forEach((field, index) => {
        let name = String(field.key || `F${index + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 10) || `FIELD${index + 1}`.slice(0, 10);
        const base = name.slice(0, 8);
        let counter = 1;
        while (usedNames.has(name)) name = `${base}${counter++}`.slice(0, 10);
        usedNames.add(name); fieldMap.set(field.key, name);
    });
    const features = jobs.filter(job => job.geometry).map(job => {
        const props = {
            PLOT_ID: String(job.id).slice(0, 254),
            WORKGROUP: String(workGroupName || job.category || '').slice(0, 254),
            STATUS: String(job.status || ''),
            SURVEY_DT: String(job.properties?.date || '').slice(0, 10),
            NOTE: String(job.properties?.note || '').slice(0, 254),
            IMG_FILES: getExportImageEntries(job).map(image => image.name).join('; ').slice(0, 254)
        };
        const formData = job.properties?.form_data || {};
        fieldMap.forEach((dbfName, key) => {
            const value = formData[key];
            props[dbfName] = Array.isArray(value) ? value.join(', ').slice(0, 254) : (value ?? '');
        });
        return { type: 'Feature', geometry: job.geometry, properties: props };
    });
    if (!features.length) return Swal.fire('ไม่มี Geometry', 'ไม่พบ Point หรือ Polygon สำหรับส่งออก', 'warning');
    const safeGroup = String(workGroupName || 'survey').replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_');
    shpwrite.download({ type: 'FeatureCollection', features }, {
        file: `${safeGroup}_${suffix}`,
        folder: `${safeGroup}_${suffix}`,
        types: { point: 'points', polygon: 'polygons', line: 'lines' }
    });
}

function generateReport(jobs, selectedWorkGroupName = null) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        return Swal.fire('ป๊อปอัปถูกบล็อก', 'กรุณาอนุญาตให้เปิดหน้าต่างป๊อปอัปสำหรับเว็บไซต์นี้', 'warning');
    }

    const workGroupName = selectedWorkGroupName || v2ActiveWorkGroup?.name || currentUser?.category || 'ทั่วไป';
    const safeWorkGroupName = v2EscapeHtml(workGroupName);
    let html = `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>รายงานงาน ${safeWorkGroupName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
        body {
            font-family: 'Sarabun', sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f3f4f6;
            color: #1f2937;
        }
        .page {
            background-color: #ffffff;
            width: 210mm;
            min-height: 297mm;
            padding: 20mm;
            margin: 10mm auto;
            box-sizing: border-box;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            page-break-after: always;
            break-after: page;
            display: flex;
            flex-direction: column;
        }
        @media print {
            body {
                background-color: #ffffff;
                margin: 0;
                padding: 0;
            }
            .page {
                width: auto;
                min-height: auto;
                margin: 0;
                padding: 10mm;
                box-shadow: none;
                border-radius: 0;
            }
            .no-print {
                display: none !important;
            }
        }
        .header {
            text-align: center;
            font-size: 22px;
            font-weight: bold;
            color: #1e3a8a;
            border-bottom: 3px double #3b82f6;
            padding-bottom: 12px;
            margin-bottom: 25px;
        }
        .work-group-title {
            display: block;
            margin-top: 7px;
            font-size: 17px;
            color: #059669;
        }
        .image-gallery {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin-bottom: 25px;
        }
        .image-card {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            overflow: hidden;
            background-color: #f9fafb;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .image-card img {
            width: 100%;
            height: 200px;
            object-fit: cover;
            display: block;
        }
        .no-images {
            grid-column: span 2;
            text-align: center;
            padding: 30px;
            color: #9ca3af;
            border: 2px dashed #e5e7eb;
            border-radius: 12px;
            font-size: 14px;
        }
        .section-title {
            font-size: 16px;
            font-weight: bold;
            color: #1e3a8a;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 6px;
            margin-bottom: 15px;
            margin-top: 15px;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 180px 1fr;
            row-gap: 12px;
            column-gap: 15px;
            font-size: 14px;
            line-height: 1.6;
        }
        .info-label {
            font-weight: bold;
            color: #4b5563;
        }
        .info-value {
            color: #111827;
            word-break: break-word;
        }
        .footer {
            margin-top: auto;
            text-align: right;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #f3f4f6;
            padding-top: 10px;
        }
        /* Close Button Styles */
        .close-btn-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
        }
        .close-report-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            background-color: #ffffff;
            color: #1f2937;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 10px 20px;
            font-size: 14px;
            font-weight: bold;
            font-family: 'Sarabun', sans-serif;
            cursor: pointer;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 10px 15px -3px rgba(0, 0, 0, 0.05);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .close-report-btn:hover {
            background-color: #f9fafb;
            color: #ef4444;
            border-color: #fca5a5;
            transform: translateY(-2px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
        }
        .close-report-btn:active {
            transform: translateY(0);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .close-icon {
            width: 18px;
            height: 18px;
            stroke-width: 2.5;
        }
    </style>
</head>
<body>
    <div class="no-print close-btn-container">
        <button onclick="window.close()" class="close-report-btn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="close-icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            กลับหน้าแผนที่
        </button>
    </div>
`;

    jobs.forEach((j, index) => {
        const name = j.properties.name || '(ไม่มีชื่อแปลง)';
        const note = j.properties.note || '(ไม่มีรายละเอียดบันทึก)';
        const date = j.properties.date || (j.updated_at ? j.updated_at.split('T')[0] : '-');
        const amphoe = j.properties.amphoe || j.properties.AMPH_NAME || '-';
        const tambon = j.properties.tambon || j.properties.TUMB_NAME || '-';
        const area = j.properties.area || '-';
        const images = j.properties.images || [];
        const surveyFeatures = Array.isArray(j.properties.survey_features) ? j.properties.survey_features : [];
        const surveyFeatureSummary = surveyFeatures.length
            ? surveyFeatures.map((feature, featureIndex) => `${featureIndex + 1}. ${feature.shape || 'Shape'} (${Number(feature.lat).toFixed(6)}, ${Number(feature.lng).toFixed(6)})`).join('<br>')
            : 'ไม่มีรูปวาดเพิ่มเติม';
        const formData = j.properties.form_data || {};
        const reportFields = Array.isArray(j.properties.form_schema) && j.properties.form_schema.length
            ? j.properties.form_schema : (getActiveSurveyForm()?.fields || []);
        const formFieldsHtml = reportFields.map(field => {
            const rawValue = formData[field.key];
            const displayValue = Array.isArray(rawValue) ? rawValue.join(', ') : (rawValue ?? '-');
            return `<div class="info-label">${v2EscapeHtml(field.label)}:</div><div class="info-value">${v2EscapeHtml(displayValue)}</div>`;
        }).join('');

        let imagesHtml = '';
        const parsedImages = typeof images === 'string' ? (() => { try { return JSON.parse(images); } catch (e) { return []; } })() : images;
        if (Array.isArray(parsedImages) && parsedImages.length > 0) {
            imagesHtml = '<div class="image-gallery">';
            parsedImages.forEach(img => {
                let url = '';
                if (img) {
                    if (typeof img === 'string') {
                        if (img.startsWith('{')) {
                            try {
                                const parsed = JSON.parse(img);
                                url = parsed.url || parsed.secure_url || '';
                            } catch (e) {
                                url = img;
                            }
                        } else {
                            url = img;
                        }
                    } else if (typeof img === 'object') {
                        url = img.url || img.secure_url || '';
                    }
                }
                if (url) {
                    imagesHtml += `
                                <div class="image-card">
                                    <img src="${url}" alt="ภาพถ่ายสำรวจ">
                                </div>
                            `;
                }
            });
            imagesHtml += '</div>';
        } else {
            imagesHtml = `
                        <div class="no-images">
                            ไม่มีภาพถ่ายประกอบ
                        </div>
                    `;
        }

        html += `
    <div class="page">
        <div class="header">
            รายงานการสำรวจตรวจสอบที่ราชพัสดุ
            <span class="work-group-title">งาน: ${safeWorkGroupName}</span>
        </div>
        
        <div class="section-title">📷 ภาพถ่ายจากการสำรวจ</div>
        ${imagesHtml}
        
        <div class="section-title">📝 รายละเอียดการสำรวจ</div>
        <div class="info-grid">
            <div class="info-label">ชื่อแปลง / เลขทะเบียนที่ดิน:</div>
            <div class="info-value" style="font-weight: bold;">${name}</div>
            
            <div class="info-label">ตำบล:</div>
            <div class="info-value">${tambon}</div>
            
            <div class="info-label">อำเภอ:</div>
            <div class="info-value">${amphoe}</div>
            
            <div class="info-label">เนื้อที่แปลงที่ดิน:</div>
            <div class="info-value">${area}</div>
            
            <div class="info-label">พิกัดทางภูมิศาสตร์:</div>
            <div class="info-value">Latitude: ${j.lat}, Longitude: ${j.lng}</div>
            
            <div class="info-label">หมวดหมู่งาน:</div>
            <div class="info-value">${j.category}</div>
            
            <div class="info-label">วันที่ดำเนินการสำรวจ:</div>
            <div class="info-value">${date}</div>

            ${formFieldsHtml}
            
            <div class="info-label">บันทึกเพิ่มเติม:</div>
            <div class="info-value">${note}</div>

            <div class="info-label">รูปวาดในแปลง (${surveyFeatures.length}):</div>
            <div class="info-value">${surveyFeatureSummary}</div>
        </div>
        
        <div class="footer">
            หน้า ${index + 1} จาก ${jobs.length} | สร้างโดยระบบจัดเก็บข้อมูล Vision TR
        </div>
    </div>
                `;
    });

    html += `
    <script>
        window.onload = function() {
            window.print();
        }
    <\/script>
</body>
</html>
`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
}

function download(c, n, m) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([c], { type: m }));
    a.download = n;
    a.click();
}

function doSearch() {
    renderMap();
    const searchVal = document.getElementById('inp-search').value.trim();
    const res = document.getElementById('search-results');
    res.innerHTML = '';

    if (searchVal === '') {
        res.classList.remove('active');
        return;
    }

    const hits = getFilteredJobs();
    if (hits.length > 0) res.classList.add('active');
    else res.classList.remove('active');

    hits.slice(0, 10).forEach(j => {
        const name = j.properties.name || '(ไม่มีชื่อแปลง)';
        const searchField = j.properties.search_field || ''; // 🎯 ดึงข้อมูลช่องเชื่อมโยงมาด้วย
        const note = j.properties.note || '';

        res.innerHTML += `
            <div class="p-3 border-b cursor-pointer hover:bg-gray-50" onclick="openSheetFromSearch('${j.id}')">
                <div class="text-sm font-bold text-gray-800">${name}</div>
                
                ${searchField ? `<div class="text-xs font-bold text-blue-600 mt-0.5"><i class="fa-solid fa-magnifying-glass text-[10px]"></i> ${searchField}</div>` : ''}
                
                ${note ? `<div class="text-[10px] text-gray-500 truncate mt-0.5">${note}</div>` : ''}
            </div>`;
    });
}

function clearPlotSearchFocus() {
    if (plotSearchPulseTimer) window.clearInterval(plotSearchPulseTimer);
    plotSearchPulseTimer = null;
    if (plotSearchFocusLayer && map?.hasLayer(plotSearchFocusLayer)) map.removeLayer(plotSearchFocusLayer);
    plotSearchFocusLayer = null;
}

function setPlotSearchFocusStyle(layer, style) {
    if (layer?.eachLayer) layer.eachLayer(child => child.setStyle?.(style));
    else layer?.setStyle?.(style);
}

function pulsePlotSearchFocus(layer) {
    if (plotSearchPulseTimer) window.clearInterval(plotSearchPulseTimer);
    const normal = { color: '#10b981', fillColor: '#34d399', weight: 5, fillOpacity: 0.12, dashArray: '10 7', opacity: 1 };
    const flash = { color: '#facc15', fillColor: '#fde047', weight: 12, fillOpacity: 0.42, dashArray: null, opacity: 1 };
    let step = 0;
    setPlotSearchFocusStyle(layer, flash);
    plotSearchPulseTimer = window.setInterval(() => {
        step += 1;
        setPlotSearchFocusStyle(layer, step % 2 ? normal : flash);
        if (step >= 7) {
            window.clearInterval(plotSearchPulseTimer);
            plotSearchPulseTimer = null;
            setPlotSearchFocusStyle(layer, normal);
        }
    }, 260);
}

function flyToSearchPreview(bounds, fallbackLatLng) {
    const mapSize = map.getSize();
    // The search panel covers the upper map. Reserve that area so the selected
    // plot lands in the visible lower half instead of directly behind results.
    const topCovered = Math.min(340, Math.round(mapSize.y * 0.46));
    if (bounds?.isValid?.()) {
        map.flyToBounds(bounds, {
            paddingTopLeft: [28, topCovered],
            paddingBottomRight: [28, 58],
            maxZoom: 18,
            duration: 0.55
        });
        return;
    }
    const zoom = Math.max(map.getZoom(), 17);
    const targetPoint = map.project(fallbackLatLng, zoom);
    const desiredY = Math.round(mapSize.y * 0.68);
    const adjustedCenter = map.unproject(targetPoint.add([0, mapSize.y / 2 - desiredY]), zoom);
    map.flyTo(adjustedCenter, zoom, { duration: 0.55 });
}

function previewPlotFromSearch(id, event) {
    // Re-rendering the list during this click detaches the pressed button. Stop the
    // click here so the outside-click handler does not mistake it for a map tap.
    event?.stopPropagation();
    const job = findJobById(id);
    if (!job || !map) return;
    selectedPlotSearchJobId = id;
    clearPlotSearchFocus();
    const style = { color: '#10b981', fillColor: '#34d399', weight: 5, fillOpacity: 0.12, dashArray: '10 7', interactive: false };
    if (job.geometry?.type?.includes('Polygon')) {
        plotSearchFocusLayer = L.geoJSON(job.geometry, { style });
    } else if (job.properties?.is_circle && job.properties.radius) {
        plotSearchFocusLayer = L.circle([job.lat, job.lng], { ...style, radius: Number(job.properties.radius) });
    } else {
        plotSearchFocusLayer = L.circleMarker([job.lat, job.lng], { ...style, radius: 16, fillOpacity: 0.28 });
    }
    plotSearchFocusLayer.addTo(map);
    if (plotSearchFocusLayer.bringToFront) plotSearchFocusLayer.bringToFront();
    pulsePlotSearchFocus(plotSearchFocusLayer);
    const bounds = plotSearchFocusLayer.getBounds?.();
    flyToSearchPreview(bounds, L.latLng(job.lat, job.lng));
    doSearch();
}

function openSheetFromSearch(id) { previewPlotFromSearch(id); }

function openSelectedPlotSearchDetails() {
    const job = findJobById(selectedPlotSearchJobId);
    if (!job) return;
    restoreSearchAfterSheet = true;
    openSheet(job);
    document.getElementById('search-results')?.classList.remove('active');
}

function closePlotSearchResults() {
    restoreSearchAfterSheet = false;
    document.getElementById('search-results')?.classList.remove('active');
    document.getElementById('inp-search')?.blur();
    // A blue search-preview pin is only useful while its result list is open.
    removePlaceSearchPreview();
}
window.previewPlotFromSearch = previewPlotFromSearch;
window.openSelectedPlotSearchDetails = openSelectedPlotSearchDetails;
window.closePlotSearchResults = closePlotSearchResults;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('PWA Ready!', reg))
            .catch(err => console.log('PWA Failed', err));
    });
}

// --- Pin Labels Toggle & Cloudinary Upload Logic ---
function togglePinLabels() {
    showPinLabels = !showPinLabels;
    localStorage.setItem('survey_show_labels', showPinLabels);

    const btn = document.getElementById('btn-label');
    if (btn) {
        if (showPinLabels) {
            btn.classList.add('bg-blue-50', 'text-blue-600');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('bg-blue-50', 'text-blue-600');
            btn.classList.add('text-gray-400');
        }
    }

    refreshMapJobLabels();
    Swal.fire({ toast: true, icon: 'success', title: showPinLabels ? 'เปิดแสดงป้ายชื่อ' : 'ปิดแสดงป้ายชื่อ', timer: 1500, showConfirmButton: false });
}



function renderImageGallery(images, editable) {
    const container = document.getElementById('image-gallery-container');
    if (!container) return;
    container.innerHTML = '';

    // แปลงหากข้อมูลถูกบันทึกเป็น string
    if (typeof images === 'string') {
        try { images = JSON.parse(images); } catch (e) { images = []; }
    }

    if (!Array.isArray(images) || images.length === 0) {
        container.innerHTML = `<div class="text-xs text-gray-400 flex items-center justify-center w-full py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <i class="fa-solid fa-image mr-1"></i> ยังไม่มีรูปถ่ายแปลงสำรวจ
                </div>`;
        return;
    }

    images.forEach((img, idx) => {
        let url = '';
        if (img) {
            if (typeof img === 'string') {
                if (img.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(img);
                        url = parsed.url || parsed.secure_url || '';
                    } catch (e) {
                        url = img;
                    }
                } else {
                    url = img;
                }
            } else if (typeof img === 'object') {
                url = img.url || img.secure_url || '';
            }
        }

        if (!url) return;

        const card = document.createElement('div');
        card.className = 'relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-gray-200 shadow-sm cursor-pointer bg-gray-100 transition duration-200';

        const imgEl = document.createElement('img');
        imgEl.src = url;
        imgEl.className = 'w-full h-full object-cover';
        card.appendChild(imgEl);

        const handleView = (e) => {
            e.stopPropagation();
            e.preventDefault();
            viewFullScreenImage(images, idx);
        };
        card.addEventListener('click', handleView);
        card.addEventListener('touchend', handleView);

        if (editable) {
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'absolute top-1 right-1 z-20 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition transform hover:scale-110';
            deleteBtn.innerHTML = '<i class="fa-solid fa-xmark text-[10px]"></i>';

            const handleDelete = (e) => {
                e.stopPropagation();
                e.preventDefault();

                const job = findJobById(selectedJobId);
                if (!job || !job.properties.images) return;

                const imageToDel = job.properties.images[idx];
                if (imageToDel) {
                    if (imageToDel.isTemp) {
                        if (imageToDel.url && imageToDel.url.startsWith('blob:')) {
                            URL.revokeObjectURL(imageToDel.url);
                        }
                    } else {
                        const publicId = imageToDel.public_id || getPublicIdFromUrl(typeof imageToDel === 'string' ? imageToDel : imageToDel.url);
                        if (publicId) {
                            window.imagesToDeleteFromCloud.push(publicId);
                        }
                    }
                    job.properties.images.splice(idx, 1);

                    toggleInputs(true);
                    document.getElementById('btn-save').classList.remove('hidden');
                    document.getElementById('btn-edit').classList.add('hidden');

                    renderImageGallery(job.properties.images, true);
                }
            };

            deleteBtn.addEventListener('click', handleDelete);
            deleteBtn.addEventListener('touchend', handleDelete);
            card.appendChild(deleteBtn);
        }

        container.appendChild(card);
    });
}

function getPublicIdFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const parts = url.split('/image/upload/');
        if (parts.length < 2) return null;
        const pathAfterUpload = parts[1];
        const pathParts = pathAfterUpload.split('/');
        if (pathParts[0].match(/^v\d+$/)) {
            pathParts.shift();
        }
        const remaining = pathParts.join('/');
        const lastDotIdx = remaining.lastIndexOf('.');
        if (lastDotIdx !== -1) {
            return remaining.substring(0, lastDotIdx);
        }
        return remaining;
    } catch (e) {
        console.error("Error parsing public id from URL:", e);
        return null;
    }
}

let currentGalleryImages = [];
let currentGalleryIndex = 0;
let selectedImagesToDelete = [];

function viewFullScreenImage(data, startIndex = 0) {
    const formattedData = Array.isArray(data) ? data.map(item => {
        if (typeof item === 'string') return { url: item };
        return item;
    }) : [{ url: data }];

    currentGalleryImages = formattedData;
    currentGalleryIndex = startIndex;
    showGallerySwal();
}

function showGallerySwal() {
    const img = currentGalleryImages[currentGalleryIndex];
    if (!img) return;
    const url = img.url || img;

    const hasPrev = currentGalleryIndex > 0;
    const hasNext = currentGalleryIndex < currentGalleryImages.length - 1;

    Swal.fire({
        showCloseButton: true,
        closeButtonHtml: '<i class="fa-solid fa-times"></i>',
        html: `
            <div class="relative flex items-center justify-center w-full h-[70vh]">
                ${hasPrev ? `<button onclick="prevGalleryImage()" class="absolute left-2 z-[9999] w-10 h-10 bg-black/50 text-white rounded-full hover:bg-black/80 transition flex items-center justify-center"><i class="fa-solid fa-chevron-left"></i></button>` : ''}
                <img src="${url}" class="max-h-full max-w-full object-contain" />
                ${hasNext ? `<button onclick="nextGalleryImage()" class="absolute right-2 z-[9999] w-10 h-10 bg-black/50 text-white rounded-full hover:bg-black/80 transition flex items-center justify-center"><i class="fa-solid fa-chevron-right"></i></button>` : ''}
            </div>
            <div class="text-white mt-2 font-bold">${currentGalleryIndex + 1} / ${currentGalleryImages.length}</div>
        `,
        showConfirmButton: false,
        background: 'transparent',
        width: '100vw',
        padding: '0',
        customClass: {
            closeButton: 'text-white hover:text-red-500'
        }
    });
}

function prevGalleryImage() { if (currentGalleryIndex > 0) { currentGalleryIndex--; showGallerySwal(); } }
function nextGalleryImage() { if (currentGalleryIndex < currentGalleryImages.length - 1) { currentGalleryIndex++; showGallerySwal(); } }

function compressImage(file, targetWidth = 800, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // ย่อขนาดโดยคงสัดส่วนเดิม (Maintain aspect ratio)
                if (width > targetWidth) {
                    height = Math.round((height * targetWidth) / width);
                    width = targetWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    } else {
                        reject(new Error("Canvas toBlob failed"));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

function triggerCamera() {
    const job = findJobById(selectedJobId);
    if (!job) return;
    const images = job.properties.images || [];
    if (images.length >= 6) {
        return Swal.fire('อัปโหลดครบกำหนด', 'สามารถอัปโหลดได้สูงสุด 6 รูปเท่านั้น', 'warning');
    }

    if (!cloudinaryCloudName || !cloudinaryUploadPreset) {
        return Swal.fire(
            'กรุณาตั้งค่า Cloudinary',
            'ต้องกรอกข้อมูล Cloud Name และ Upload Preset ในหน้าต่างตั้งค่าก่อนใช้งาน',
            'warning'
        );
    }

    document.getElementById('camera-file-input').click();
}

async function handleImageUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const job = findJobById(selectedJobId);
    if (!job) return;
    if (!job.properties.images) job.properties.images = [];

    const originalInput = document.getElementById('camera-file-input');

    Swal.fire({
        title: 'กำลังบีบอัดรูปภาพ...',
        text: 'กรุณารอสักครู่',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        for (let file of files) {
            if (job.properties.images.length >= 6) {
                Swal.fire('ข้อจำกัด', 'สามารถอัปโหลดได้สูงสุด 6 รูปเท่านั้น', 'warning');
                break;
            }

            // บีบอัดภาพด้วย Canvas เป็นขนาดกว้าง 800px
            const compressedFile = await compressImage(file, 800, 0.75);
            const tempUrl = URL.createObjectURL(compressedFile);

            job.properties.images.push({
                url: tempUrl,
                isTemp: true,
                file: compressedFile
            });
        }
        Swal.close();

        // เมื่อเพิ่มภาพ ให้เปลี่ยนสถานะแถบข้อมูลเป็นโหมดแก้ไข (แสดงปุ่มบันทึก)
        toggleInputs(true);
        document.getElementById('btn-save').classList.remove('hidden');
        document.getElementById('btn-edit').classList.add('hidden');
    } catch (err) {
        console.error("Compression error:", err);
        Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถบีบอัดรูปภาพได้: ' + err.message, 'error');
    }

    renderImageGallery(job.properties.images, true);
    originalInput.value = '';
}

function showGalleryUploadingPlaceholder() {
    const container = document.getElementById('image-gallery-container');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col items-center justify-center bg-gray-50 relative';
    card.innerHTML = `
                <div class="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
                <span class="text-[9px] text-gray-500 mt-1">กำลังโหลด...</span>
            `;

    // Clear any dashed border placeholder first
    const noImagesEl = container.querySelector('.border-dashed');
    if (noImagesEl) {
        container.innerHTML = '';
    }
    container.appendChild(card);
}



// Export handlers to window for inline HTML event listener compatibility
window.handleAuthSubmit = handleAuthSubmit;
window.togglePinLabels = togglePinLabels;
window.syncJobsFromDB = syncJobsFromDB;
window.toggleViewMode = toggleViewMode;
window.toggleBaseMap = toggleBaseMap;
window.doSearch = doSearch;
window.onAmphoeChange = onAmphoeChange;
window.filterMap = filterMap;
window.importData = importData;
window.openToolsMenu = openToolsMenu;
window.openDashboard = openDashboard;
window.findNearestNewJob = findNearestNewJob;
window.toggleGPSFollow = toggleGPSFollow;
window.viewJsonData = viewJsonData;
window.saveData = saveData;
window.enableEdit = enableEdit;
window.deleteJob = deleteJob;
window.navGoogle = navGoogle;
window.startNav = startNav;
window.stopNav = stopNav;
window.closeSheet = closeSheet;
window.toggleSheetSize = toggleSheetSize;
window.closeSettingsModal = closeSettingsModal;
window.switchSettingsTab = switchSettingsTab;
window.copyUserCode = copyUserCode;
window.addCat = addCat;
window.clearAll = clearAll;
window.triggerCamera = triggerCamera;
window.handleImageUpload = handleImageUpload;
window.resetGps = resetGps;
window.openSheetFromSearch = openSheetFromSearch;
window.handleLogout = handleLogout;
window.openExportCalendarModal = openExportCalendarModal;
window.closeExportCalendarModal = closeExportCalendarModal;
window.navigateExportCalendar = navigateExportCalendar;
window.selectExportDate = selectExportDate;
window.confirmExportCalendar = confirmExportCalendar;
window.onExportWorkGroupChange = onExportWorkGroupChange;
window.onExportDateModeChange = onExportDateModeChange;
window.closeImportMappingModal = closeImportMappingModal;
window.viewFullScreenImage = viewFullScreenImage;
window.prevGalleryImage = prevGalleryImage;
window.nextGalleryImage = nextGalleryImage;
window.renderImportedMapsList = renderImportedMapsList;
window.deleteImportedMap = deleteImportedMap;
window.saveProfileCategory = saveProfileCategory;
window.toggleVoiceControl = toggleVoiceControl;
window.deleteSurveyData = deleteSurveyData;

// ============================================================================
// ExtraPro V2 data layer: immutable Base Maps + independent work records
// ============================================================================
let v2BaseMaps = [];
let v2BasePlots = [];
let v2WorkGroups = [];
let v2PlotRecords = [];
let v2SurveyForms = [];
let v2TeamProfiles = [];
let v2ActiveWorkGroup = null;
let surveyFormDraftFields = [];
let surveyFormDraftBaseline = '[]';
let surveyFormNameBaseline = '';
let surveyFormBuilderGroupId = null;
let surveyFormLayerSettingsBaseline = '{"type":"both","color":"#10b981"}';

function v2FlattenSearch(value, output = []) {
    if (value === null || value === undefined) return output;
    if (Array.isArray(value)) {
        value.forEach(item => v2FlattenSearch(item, output));
    } else if (typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => {
            output.push(key);
            v2FlattenSearch(item, output);
        });
    } else {
        output.push(String(value));
    }
    return output;
}

function v2SearchText(properties) {
    return v2FlattenSearch(properties).join(' ').toLocaleLowerCase('th').replace(/\s+/g, ' ').trim();
}

function v2PickDisplayName(properties, fallback) {
    const entries = Object.entries(properties || {});
    const preferred = [
        /^(plot|parcel|land|feature)[_\s-]*(id|no|number|code)$/i,
        /^(id|fid|objectid|เลข.*แปลง|รหัส.*แปลง|แปลง)$/i,
        /^(name|title|label|ชื่อ.*แปลง|ชื่อ)$/i
    ];
    for (const pattern of preferred) {
        const found = entries.find(([key, value]) => pattern.test(key) && value !== null && value !== '');
        if (found) return String(found[1]).trim();
    }
    const firstUseful = entries.find(([, value]) => ['string', 'number'].includes(typeof value) && String(value).trim());
    return firstUseful ? String(firstUseful[1]).trim() : fallback;
}

function v2CenterOfGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') return { lng: Number(geometry.coordinates[0]), lat: Number(geometry.coordinates[1]) };
    try {
        const bounds = L.geoJSON(geometry).getBounds();
        if (!bounds.isValid()) return null;
        const center = bounds.getCenter();
        return { lat: center.lat, lng: center.lng };
    } catch (error) {
        return null;
    }
}

async function v2FetchAll(table, orderColumn = 'created_at') {
    const rows = [];
    let from = 0;
    const limit = 1000;
    while (true) {
        const { data, error } = await supabaseClient.from(table).select('*').order(orderColumn, { ascending: true }).range(from, from + limit - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < limit) break;
        from += data.length;
    }
    return rows;
}

async function v2FetchOptionalTable(table, orderColumn = 'created_at') {
    try {
        return await v2FetchAll(table, orderColumn);
    } catch (error) {
        // Optional modules must never prevent Base Maps and survey records from loading.
        console.warn(`Optional table ${table} is not ready`, error);
        return [];
    }
}

async function v2EnsureWorkGroup(name, { isShared = undefined } = {}) {
    const cleanName = (name || currentUser.category || 'ทั่วไป').trim() || 'ทั่วไป';
    let group = v2VisibleWorkGroups().find(item => item.name === cleanName);
    if (!group) {
        const { data, error } = await supabaseClient.from('work_groups').upsert({
            team_id: currentUser.team_id,
            name: cleanName,
            created_by: currentUser.id,
            is_shared: isTeamOwner() && isShared === true,
            is_active: true
        }, { onConflict: 'team_id,name' }).select().single();
        if (error) throw error;
        group = data;
        v2WorkGroups.push(group);
    }
    v2ActiveWorkGroup = group;
    currentUser.category = group.name;
    localStorage.setItem('survey_current_cat', group.name);
    return group;
}

function v2ComposeJobs() {
    const mapById = new Map(v2BaseMaps.map(item => [item.id, item]));
    const recordByPlot = new Map(v2PlotRecords.map(item => [item.base_plot_id, item]));
    const activeGroupId = v2ActiveWorkGroup?.id;
    const activeMapIds = new Set(v2BaseMaps
        .filter(baseMap => baseMap.work_group_id === activeGroupId || (!baseMap.work_group_id && v2ActiveWorkGroup?.name === 'ทั่วไป'))
        .map(baseMap => baseMap.id));
    return v2BasePlots.filter(plot => {
        const sourceProps = plot.source_properties || {};
        const isCustomDraw = sourceProps.is_custom_draw === true;
        // Older releases could put an independent drawing in the shared
        // custom-map container of another work group. Its own group tag is
        // authoritative, so recover and show those existing drawings here.
        if (!activeMapIds.has(plot.base_map_id) && !(isCustomDraw && sourceProps.work_group_id === activeGroupId)) return false;
        if (!isCustomDraw) return true;

        const record = recordByPlot.get(plot.id);
        const ownerWorkGroupId = sourceProps.work_group_id;
        // Legacy drawings have no group tag, so only show them where a record exists.
        return Boolean(record) || (ownerWorkGroupId && ownerWorkGroupId === v2ActiveWorkGroup?.id);
    }).map(plot => {
        const record = recordByPlot.get(plot.id);
        const baseMap = mapById.get(plot.base_map_id);
        const recordProps = record?.record_properties || {};
        const sourceProps = plot.source_properties || {};
        return {
            id: plot.id,
            team_id: plot.team_id,
            lat: plot.lat,
            lng: plot.lng,
            geometry: plot.geometry,
            status: record?.status || 'waiting',
            category: v2ActiveWorkGroup?.name || currentUser.category,
            updated_at: record?.updated_at || plot.updated_at,
            properties: {
                ...sourceProps,
                ...recordProps,
                name: recordProps.name || plot.display_name,
                note: record?.note || '',
                images: record?.images || [],
                date: record?.recorded_at ? record.recorded_at.split('T')[0] : (recordProps.date || ''),
                import_source: baseMap?.name || baseMap?.source_name || '',
                base_map_id: plot.base_map_id,
                base_plot_id: plot.id,
                work_group_id: v2ActiveWorkGroup?.id,
                search_text: `${plot.search_text || ''} ${v2SearchText(recordProps)} ${record?.note || ''}`.toLocaleLowerCase('th'),
                navigator_id: record?.navigator_id || null,
                navigator_name: record?.navigator_name || null,
                recorded_by: record?.recorded_by || null,
                is_custom_draw: sourceProps.is_custom_draw === true
            }
        };
    });
}

syncJobsFromDB = async function (fitBounds = false) {
    if (!supabaseClient || !currentUser) return;
    showLoading(true, 'กำลังโหลด Base Map และข้อมูลบันทึก...');
    try {
        const [baseMaps, basePlots, workGroups, surveyForms, teamProfiles] = await Promise.all([
            v2FetchAll('base_maps', 'imported_at'),
            v2FetchAll('base_plots', 'created_at'),
            v2FetchAll('work_groups', 'created_at'),
            v2FetchOptionalTable('survey_forms', 'updated_at'),
            supabaseClient.from('profiles').select('id, display_name, email').eq('team_id', currentUser.team_id)
        ]);
        if (teamProfiles.error) throw teamProfiles.error;
        v2TeamProfiles = teamProfiles.data || [];
        const activeMemberIds = new Set(v2TeamProfiles.map(profile => profile.id));
        const importerById = new Map(v2TeamProfiles.map(profile => [profile.id, profile]));
        // A former member's Base Map remains stored, but no longer appears in this team workspace.
        v2BaseMaps = baseMaps.filter(mapItem => !mapItem.imported_by || activeMemberIds.has(mapItem.imported_by)).map(mapItem => ({
            ...mapItem,
            imported_by_name: importerById.get(mapItem.imported_by)?.display_name || importerById.get(mapItem.imported_by)?.email || 'ไม่ระบุผู้นำเข้า'
        }));
        v2BasePlots = basePlots;
        v2WorkGroups = workGroups;
        v2SurveyForms = surveyForms;
        const visibleGroups = v2VisibleWorkGroups();
        if (visibleGroups.length && !visibleGroups.some(group => group.name === currentUser.category)) {
            currentUser.category = visibleGroups[0].name;
        }
        await v2EnsureWorkGroup(currentUser.category || 'ทั่วไป');
        const { data: records, error } = await supabaseClient.from('plot_records').select('*').eq('work_group_id', v2ActiveWorkGroup.id);
        if (error) throw error;
        v2PlotRecords = records || [];
        dbJobs = v2ComposeJobs();
        saveOfflineMapSnapshot();
        categories = v2WorkGroups.map(group => group.name);
        if (!categories.includes(v2ActiveWorkGroup.name)) categories.push(v2ActiveWorkGroup.name);
        updateUserInfo();
        renderImportedMapsList();
        updateAmphoeDropdown();
        renderMap(fitBounds);
    } catch (error) {
        console.error('V2 data sync error', error);
        if (!navigator.onLine && restoreOfflineMapSnapshot()) {
            Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'กำลังใช้ข้อมูลแผนที่ที่บันทึกไว้ในเครื่อง', timer: 2400, showConfirmButton: false });
        } else {
            Swal.fire('โหลดข้อมูลไม่สำเร็จ', error.message, 'error');
        }
    } finally {
        showLoading(false);
    }
};

syncJobsSilently = async function () {
    // Do not redraw while a newly drawn pin/boundary is waiting for the user
    // to open its form. A redraw would remove that local draft from the map.
    if (window.pendingNewShapes?.length > 0 || window.pendingSurveyFeatureDrafts?.length > 0 || window.pendingGeomanUpdates?.size > 0) return;
    if (!supabaseClient || !currentUser || isNavigating || isMapClickBlocked) return;
    try {
        const { data: profile } = await supabaseClient.from('profiles').select('team_id').eq('id', currentUser.id).maybeSingle();
        if (profile?.team_id && profile.team_id !== currentUser.team_id) {
            currentUser.team_id = profile.team_id;
            try { localStorage.setItem('vision-tr-offline-user', JSON.stringify(currentUser)); } catch (error) { }
            await syncJobsFromDB(true);
            await loadTeamMembers();
            return;
        }
        const { data, error } = await supabaseClient.from('plot_records').select('*').eq('work_group_id', v2ActiveWorkGroup.id);
        if (error) throw error;
        v2PlotRecords = data || [];
        dbJobs = v2ComposeJobs();
        renderMap(false);
    } catch (error) {
        console.error('V2 silent sync error', error);
    }
};

saveJobToSupabase = async function (job) {
    if (!supabaseClient || !currentUser) return;
    const group = v2ActiveWorkGroup || await v2EnsureWorkGroup(currentUser.category);
    let plot = v2BasePlots.find(item => item.id === job.id);

    if (!plot) {
        // Each work group has its own hidden container for independent pins
        // and boundaries. Reusing a container from another group causes the
        // saved drawing to be filtered out after the next map refresh.
        let customMap = v2BaseMaps.find(item => item.source_name === '__custom_draw__' && item.work_group_id === group.id);
        if (!customMap) {
            const { data, error } = await supabaseClient.from('base_maps').insert({
                team_id: currentUser.team_id,
                work_group_id: group.id,
                name: 'แปลงที่วาดเพิ่มเติม',
                source_name: '__custom_draw__',
                imported_by: currentUser.id
            }).select().single();
            if (error) throw error;
            customMap = data;
            v2BaseMaps.push(customMap);
        }
        plot = {
            id: job.id,
            team_id: currentUser.team_id,
            base_map_id: customMap.id,
            source_feature_id: job.id,
            display_name: job.properties?.name || 'แปลงที่วาดใหม่',
            lat: job.lat,
            lng: job.lng,
            geometry: job.geometry,
            source_properties: {
                ...(job.properties || {}),
                is_custom_draw: true,
                work_group_id: group.id
            },
            search_text: v2SearchText(job.properties || {})
        };
        const { error } = await supabaseClient.from('base_plots').insert(plot);
        if (error) throw error;
        v2BasePlots.push(plot);
    }

    const props = job.properties || {};
    // Custom drawings own their Base Plot geometry. Survey records keep form
    // values, but do not contain the polygon itself. Persist the edited shape
    // before the record update so a reload cannot restore the old outline.
    if (plot.source_properties?.is_custom_draw === true || props.is_custom_draw === true) {
        const sourceProperties = {
            ...(plot.source_properties || {}),
            ...props,
            is_custom_draw: true,
            work_group_id: group.id
        };
        const { data: updatedPlot, error: plotUpdateError } = await supabaseClient
            .from('base_plots')
            .update({
                display_name: props.name || plot.display_name,
                lat: Number(job.lat),
                lng: Number(job.lng),
                geometry: job.geometry,
                source_properties: sourceProperties,
                search_text: v2SearchText(sourceProperties)
            })
            .eq('id', plot.id)
            .select()
            .single();
        if (plotUpdateError) throw plotUpdateError;
        plot = updatedPlot;
        const plotIndex = v2BasePlots.findIndex(item => item.id === plot.id);
        if (plotIndex >= 0) v2BasePlots[plotIndex] = plot;
    }
    const existingRecord = v2PlotRecords.find(item => item.base_plot_id === plot.id && item.work_group_id === group.id);
    const existingRecordProperties = existingRecord?.record_properties || {};
    const recordedAt = job.status === 'done' ? (props.date ? `${props.date}T00:00:00Z` : new Date().toISOString()) : null;
    const payload = {
        team_id: currentUser.team_id,
        base_plot_id: plot.id,
        work_group_id: group.id,
        status: job.status || 'waiting',
        note: props.note || '',
        images: props.images || [],
        record_properties: {
            ...existingRecordProperties,
            name: props.name || plot.display_name,
            date: props.date || '',
            survey_features: Array.isArray(props.survey_features)
                ? props.survey_features
                : (existingRecordProperties.survey_features || []),
            form_data: props.form_data || existingRecordProperties.form_data || {},
            form_version: props.form_version || existingRecordProperties.form_version || 0,
            form_schema: props.form_schema || existingRecordProperties.form_schema || [],
            form_layer_type: props.form_layer_type || existingRecordProperties.form_layer_type || getActiveSurveyLayerSettings().type,
            form_layer_color: props.form_layer_color || existingRecordProperties.form_layer_color || getSurveyLayerColorForGeometry(plot.geometry)
        },
        navigator_id: props.navigator_id || null,
        navigator_name: props.navigator_name || null,
        recorded_by: currentUser.id,
        recorded_at: recordedAt,
        updated_at: new Date().toISOString()
    };
    // Read the saved record back in the same request. This is essential for
    // every drawing tool (marker, polygon, rectangles and circle): rendering
    // from this confirmed record prevents a background refresh from dropping
    // its geometry/child drawing before a later fetch catches up.
    const { data: savedRecord, error } = await supabaseClient
        .from('plot_records')
        .upsert(payload, { onConflict: 'base_plot_id,work_group_id' })
        .select()
        .single();
    if (error) throw error;
    const recordIndex = v2PlotRecords.findIndex(item => item.base_plot_id === plot.id && item.work_group_id === group.id);
    if (recordIndex >= 0) v2PlotRecords[recordIndex] = savedRecord;
    else v2PlotRecords.push(savedRecord);
    dbJobs = v2ComposeJobs();
    renderMap(false);
};

deleteJobFromSupabase = async function (id) {
    const plot = v2BasePlots.find(item => item.id === id);
    if (!plot || !v2ActiveWorkGroup) return;
    const isCustomDraw = plot.source_properties?.is_custom_draw === true;
    let recordDelete = supabaseClient.from('plot_records').delete().eq('base_plot_id', id);
    if (!isCustomDraw) recordDelete = recordDelete.eq('work_group_id', v2ActiveWorkGroup.id);
    const { error } = await recordDelete;
    if (error) throw error;

    v2PlotRecords = v2PlotRecords.filter(record => {
        if (record.base_plot_id !== id) return true;
        return !isCustomDraw && record.work_group_id !== v2ActiveWorkGroup.id;
    });

    if (isCustomDraw) {
        const { error: plotError } = await supabaseClient.from('base_plots').delete().eq('id', id);
        if (plotError) throw plotError;
        v2BasePlots = v2BasePlots.filter(item => item.id !== id);
    }
};

clearAllSupabaseJobs = async function () {
    if (!v2ActiveWorkGroup) return;
    const { error } = await supabaseClient.from('plot_records').delete().eq('work_group_id', v2ActiveWorkGroup.id);
    if (error) throw error;
};

async function v2PromptImport(sourceName) {
    const suggestedMap = (sourceName || 'Base Map').replace(/\.(geo)?json$/i, '');
    const result = await Swal.fire({
        title: 'นำเข้าเป็น Base Map',
        html: `
            <div class="text-left space-y-3">
                <label class="block text-xs font-bold text-gray-600">ชื่อแผนที่หลัก</label>
                <input id="v2-map-name" class="swal2-input !m-0 !w-full" value="${suggestedMap.replace(/"/g, '&quot;')}">
                <label class="block text-xs font-bold text-gray-600">ชื่องาน / กลุ่มการบันทึก</label>
                <input id="v2-work-name" class="swal2-input !m-0 !w-full" value="" placeholder="ระบุชื่อกลุ่มงานสำหรับ Base Map นี้">
                ${isTeamOwner() ? '<label class="flex items-center gap-2 text-xs font-bold text-emerald-700"><input id="v2-work-shared" type="checkbox" class="h-4 w-4"> แชร์กลุ่มงานนี้ให้ทีม</label>' : ''}
                <p class="text-[11px] text-gray-500">ระบบจะอ่านและค้นหาทุกคอลัมน์โดยอัตโนมัติ</p>
            </div>`,
        showCancelButton: true,
        confirmButtonText: 'นำเข้าทันที',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const mapName = document.getElementById('v2-map-name').value.trim();
            const workName = document.getElementById('v2-work-name').value.trim();
            if (!mapName || !workName) return Swal.showValidationMessage('กรุณาระบุชื่อแผนที่และชื่องาน');
            return { mapName, workName, isShared: Boolean(document.getElementById('v2-work-shared')?.checked) };
        }
    });

    return result.isConfirmed ? result.value : null;
}

function v2ExtractCoordinates(properties) {
    if (!properties || typeof properties !== 'object') return null;
    const keys = Object.keys(properties);
    let latVal = null;
    let lngVal = null;

    const latKeys = [/^(lat|latitude|y|northing|n|ละติจูด|พิกัด[_\s]*n|พิกัด[_\s]*y)$/i];
    const lngKeys = [/^(lng|lon|long|longitude|x|easting|e|ลองจิจูด|พิกัด[_\s]*e|พิกัด[_\s]*x)$/i];

    for (const key of keys) {
        const val = properties[key];
        if (val === null || val === undefined || val === '') continue;
        const num = Number(val);
        if (!Number.isFinite(num)) continue;

        if (latVal === null) {
            for (const r of latKeys) {
                if (r.test(key)) { latVal = num; break; }
            }
        }
        if (lngVal === null) {
            for (const r of lngKeys) {
                if (r.test(key)) { lngVal = num; break; }
            }
        }
    }

    if (latVal !== null && lngVal !== null && Number.isFinite(latVal) && Number.isFinite(lngVal)) {
        return { lat: latVal, lng: lngVal };
    }
    return null;
}

function parseCSVToFeatures(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const delimiter = csvText.includes('\t') ? '\t' : (csvText.includes(';') ? ';' : ',');
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
    
    const features = [];
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, ''));
        if (row.length === 0 || (row.length === 1 && !row[0])) continue;

        const props = {};
        headers.forEach((h, idx) => {
            props[h] = row[idx] !== undefined ? row[idx] : '';
        });

        const coords = v2ExtractCoordinates(props);
        features.push({
            type: 'Feature',
            geometry: coords ? { type: 'Point', coordinates: [coords.lng, coords.lat] } : null,
            properties: props
        });
    }
    return features;
}

async function v2ImportFeatures(features, sourceName, sourceUrl = '') {
    const context = await v2PromptImport(sourceName);
    if (!context) return;
    showLoading(true, `กำลังนำเข้า Base Map ${features.length} แปลง...`);
    try {
        const group = await v2EnsureWorkGroup(context.workName, { isShared: context.isShared });
        const { data: baseMap, error: mapError } = await supabaseClient.from('base_maps').insert({
            team_id: currentUser.team_id,
            work_group_id: group.id,
            name: context.mapName,
            source_name: sourceName,
            source_url: sourceUrl || null,
            feature_count: features.length,
            imported_by: currentUser.id
        }).select().single();
        if (mapError) throw mapError;

        const rows = [];
        features.forEach((feature, index) => {
            const properties = feature?.properties || (feature && !feature.geometry ? feature : {});
            let geometry = feature?.geometry;
            if (!geometry) {
                const coords = v2ExtractCoordinates(properties);
                if (coords) {
                    geometry = { type: 'Point', coordinates: [coords.lng, coords.lat] };
                }
            }
            const center = v2CenterOfGeometry(geometry);
            if (!geometry || !center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
            const sourceId = String(feature?.id ?? properties.id ?? properties.ID ?? properties.fid ?? properties.OBJECTID ?? index + 1);
            rows.push({
                id: `${baseMap.id}_${sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${index + 1}`,
                team_id: currentUser.team_id,
                base_map_id: baseMap.id,
                source_feature_id: sourceId,
                display_name: v2PickDisplayName(properties, `แปลง ${index + 1}`),
                lat: center.lat,
                lng: center.lng,
                geometry,
                source_properties: properties,
                search_text: v2SearchText(properties)
            });
        });
        if (rows.length === 0) throw new Error('ไม่พบพิกัด (Lat, Lng) หรือ รูปแปลง (Geometry) ที่สามารถอ่านได้ในไฟล์');
        for (let index = 0; index < rows.length; index += 500) {
            const { error } = await supabaseClient.from('base_plots').insert(rows.slice(index, index + 500));
            if (error) throw error;
        }
        currentUser.category = group.name;

        // Reset any search or district filters so all imported data is visible
        const inpSearch = document.getElementById('inp-search');
        const selAmphoe = document.getElementById('sel-amphoe');
        const selTambon = document.getElementById('sel-tambon');
        if (inpSearch) inpSearch.value = '';
        if (selAmphoe) selAmphoe.value = '';
        if (selTambon) selTambon.value = '';

        await syncJobsFromDB(true);
        Swal.fire('นำเข้าสำเร็จ', `เพิ่ม Base Map “${context.mapName}” จำนวน ${rows.length} แปลงเรียบร้อยแล้ว`, 'success');
    } catch (error) {
        console.error('V2 import error', error);
        Swal.fire('นำเข้าไม่สำเร็จ', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

importData = async function (input) {
    const file = input?.files?.[0];
    if (!file) return;
    try {
        const fileName = file.name || '';
        const ext = fileName.split('.').pop().toLowerCase();
        let features = [];

        if (ext === 'csv' || ext === 'txt') {
            const text = await file.text();
            features = parseCSVToFeatures(text);
        } else {
            const text = await file.text();
            let json;
            try {
                json = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
            } catch (jsonErr) {
                throw new Error(`ไม่สามารถอ่านไฟล์ "${fileName}" ได้ กรุณาใช้ไฟล์รูปแบบ GeoJSON (.json, .geojson) หรือ CSV (.csv)`);
            }
            features = json.type === 'FeatureCollection' ? json.features : (Array.isArray(json) ? json : [json]);
        }

        if (!features || features.length === 0) {
            throw new Error('ไม่พบข้อมูลแปลงที่ดินในไฟล์');
        }

        await v2ImportFeatures(features, file.name);
    } catch (error) {
        Swal.fire('อ่านไฟล์ไม่สำเร็จ', error.message, 'error');
    } finally {
        input.value = '';
    }
};

getFilteredJobs = function () {
    const searchMode = document.getElementById('search-mode')?.value || 'data';
    const searchQuery = searchMode === 'data' ? v2ParsePlotSearchQuery(document.getElementById('inp-search').value || '') : { terms: [], savedOnly: false };
    const searchTerms = searchQuery.terms;
    const amphoe = document.getElementById('sel-amphoe').value;
    const tambon = document.getElementById('sel-tambon').value;
    return dbJobs.filter(job => {
        const properties = job.properties || {};
        // search_text is composed once when data is loaded, including Base Map,
        // parent form, child surveys and notes.  Avoid flattening the entire
        // JSON object again on every keystroke for large imports.
        const haystack = `${job.id} ${job.category} ${properties.search_text || v2SearchText(properties)}`.toLocaleLowerCase('th');
        const valueA = String(properties.amphoe || properties.AMPH_NAME || properties.AMPHOE || properties.district || '').trim();
        const valueT = String(properties.tambon || properties.TUMB_NAME || properties.TAMBON || properties.subdistrict || '').trim();
        const isSavedCustomDrawing = properties.is_custom_draw === true && job.status === 'done';
        const matchesBaseMapFilters = (!searchQuery.savedOnly || v2JobHasSavedSurvey(job))
            && (!searchTerms.length || searchTerms.every(term => haystack.includes(term)))
            && (!amphoe || valueA === amphoe)
            && (!tambon || valueT === tambon);
        // Search/facet filters target Base Map lists. Keep saved drawings in
        // the current work group visible so they never look deleted on save.
        return job.category === currentUser.category && (isSavedCustomDrawing || matchesBaseMapFilters);
    });
};

renderImportedMapsList = function () {
    const container = document.getElementById('imported-maps-list');
    if (!container) return;
    if (v2BaseMaps.length === 0) {
        container.innerHTML = '<div class="text-[11px] text-gray-400 text-center py-3">ยังไม่มี Base Map</div>';
        return;
    }
    container.innerHTML = v2BaseMaps.filter(mapItem => mapItem.source_name !== '__custom_draw__').map(mapItem => {
        const canDelete = mapItem.imported_by === currentUser?.id;
        return `
        <div class="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-gray-100">
            <div class="min-w-0 flex-1">
                <p class="text-xs font-bold text-gray-700 truncate">${mapItem.name}</p>
                <p class="text-[10px] text-gray-500 mt-1">${mapItem.feature_count || 0} แปลง · นำเข้า ${v2EscapeHtml(formatBaseMapImportedAt(mapItem.imported_at))}</p>
                <p class="text-[10px] text-blue-600 mt-0.5"><i class="fa-solid fa-user mr-1"></i>ผู้นำเข้า: ${v2EscapeHtml(mapItem.imported_by_name || 'ไม่ระบุผู้นำเข้า')}</p>
            </div>
            ${canDelete ? `<button onclick="deleteImportedMap('${mapItem.id}')" class="text-xs text-red-500 p-1.5" title="ลบ Base Map และผลบันทึกที่เชื่อมอยู่"><i class="fa-solid fa-trash-can"></i></button>` : '<span class="text-[9px] font-bold text-slate-400">ผู้อื่นนำเข้า</span>'}
        </div>`;
    }).join('');
};

async function getBaseMapRecordSummary(baseMapId) {
    const plotIds = v2BasePlots.filter(plot => plot.base_map_id === baseMapId).map(plot => plot.id);
    if (!plotIds.length) return { plotCount: 0, records: [], imageCount: 0, groups: [] };
    const records = [];
    const chunkSize = 100;
    for (let index = 0; index < plotIds.length; index += chunkSize) {
        const { data, error } = await supabaseClient.from('plot_records')
            .select('id, work_group_id, images, record_properties')
            .in('base_plot_id', plotIds.slice(index, index + chunkSize));
        if (error) throw error;
        records.push(...(data || []));
    }
    const byGroup = new Map();
    let imageCount = 0;
    records.forEach(record => {
        const groupName = v2WorkGroups.find(group => group.id === record.work_group_id)?.name || 'กลุ่มงานเดิม';
        byGroup.set(groupName, (byGroup.get(groupName) || 0) + 1);
        imageCount += Array.isArray(record.images) ? record.images.length : 0;
        (record.record_properties?.survey_features || []).forEach(feature => {
            imageCount += Array.isArray(feature?.images) ? feature.images.length : 0;
        });
    });
    return { plotCount: plotIds.length, records, imageCount, groups: [...byGroup.entries()] };
}

deleteImportedMap = async function (baseMapId) {
    const baseMap = v2BaseMaps.find(item => item.id === baseMapId);
    if (!baseMap) return;
    if (baseMap.imported_by !== currentUser?.id) {
        return Swal.fire('ไม่มีสิทธิ์ลบ Base Map นี้', 'เฉพาะผู้นำเข้า Base Map เท่านั้นที่ลบได้', 'warning');
    }
    showLoading(true, 'กำลังตรวจสอบข้อมูลที่เชื่อมกับ Base Map...');
    let summary;
    try {
        summary = await getBaseMapRecordSummary(baseMapId);
    } catch (error) {
        Swal.fire('ตรวจสอบข้อมูลไม่สำเร็จ', error.message, 'error');
        return;
    } finally { showLoading(false); }

    let confirmedLinkedDelete = false;
    if (summary.records.length) {
        const groupRows = summary.groups.map(([name, count]) => `<li>${v2EscapeHtml(name)}: ${count.toLocaleString()} ผลบันทึก</li>`).join('');
        const confirm = skipConfirm ? { isConfirmed: true } : await Swal.fire({
            title: 'ลบ Base Map พร้อมผลบันทึก?',
            icon: 'warning',
            html: `<div class="text-left text-sm text-slate-600"><p>คุณกำลังจะลบ Base Map “<b>${v2EscapeHtml(baseMap.name)}</b>” พร้อมข้อมูลที่เชื่อมอยู่</p><div class="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3"><b class="text-rose-700">ข้อมูลที่จะถูกลบถาวร</b><ul class="mt-1 list-disc space-y-1 pl-5 text-xs"><li>ขอบเขตแปลง: <b>${summary.plotCount.toLocaleString()} แปลง</b></li><li>ผลบันทึก/ผลสำรวจ: <b>${summary.records.length.toLocaleString()} รายการ</b></li><li>ข้อความ หมายเหตุ และรูปภาพ: <b>${summary.imageCount.toLocaleString()} รูป</b></li></ul></div><p class="mt-3 text-xs font-bold text-slate-700">แยกตามกลุ่มงาน</p><ul class="mt-1 list-disc pl-5 text-xs">${groupRows}</ul><p class="mt-3 text-xs text-rose-700">การดำเนินการนี้ไม่สามารถย้อนกลับได้ โปรดสำรองข้อมูลที่ต้องการก่อนลบ</p></div>`,
            showCancelButton: true,
            confirmButtonText: `ลบทั้งหมด ${summary.records.length.toLocaleString()} ผลบันทึก`,
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#e11d48'
        });
        if (!confirm.isConfirmed) return;
        confirmedLinkedDelete = true;
        showLoading(true, 'กำลังลบผลบันทึกและรูปภาพ...');
        try {
            const imagePublicIds = getWorkGroupImagePublicIds(summary.records);
            await Promise.all(imagePublicIds.map(async publicId => {
                try { await fetch(GAS_URL + '?publicId=' + encodeURIComponent(publicId), { mode: 'no-cors' }); }
                catch (error) { console.error('ลบรูปภาพจากคลาวด์ไม่สำเร็จ:', publicId, error); }
            }));
            const recordIds = summary.records.map(record => record.id);
            for (let index = 0; index < recordIds.length; index += 100) {
                const { error } = await supabaseClient.from('plot_records').delete().in('id', recordIds.slice(index, index + 100));
                if (error) throw error;
            }
        } catch (error) {
            Swal.fire('ลบผลบันทึกไม่สำเร็จ', error.message, 'error');
            return;
        } finally { showLoading(false); }
    }
    const result = confirmedLinkedDelete ? { isConfirmed: true } : await Swal.fire({
        title: 'ลบ Base Map?',
        html: `<p class="text-sm text-slate-600">Base Map “<b>${v2EscapeHtml(baseMap.name)}</b>” มี ${summary.plotCount.toLocaleString()} แปลง และไม่พบผลบันทึกหรือรูปภาพที่เชื่อมอยู่</p><p class="mt-2 text-xs text-rose-700">การลบจะลบขอบเขตแปลงทั้งหมดใน Base Map นี้</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ลบ Base Map',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#ef4444'
    });
    if (!result.isConfirmed) return;
    showLoading(true, 'กำลังลบ Base Map...');
    const { error } = await supabaseClient.from('base_maps').delete().eq('id', baseMapId);
    showLoading(false);
    if (error) return Swal.fire('ลบ Base Map ไม่สำเร็จ', `ไม่พบผลบันทึกเชื่อมอยู่ แต่ฐานข้อมูลปฏิเสธการลบ: ${v2EscapeHtml(error.message)}`, 'error');
    await syncJobsFromDB(true);
};

function v2EscapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
}

function v2ParsePlotSearchTerms(query) {
    return String(query || '').toLocaleLowerCase('th').split('/').map(term => term.trim()).filter(Boolean).slice(0, 8);
}

function v2ParsePlotSearchQuery(query) {
    const rawTerms = v2ParsePlotSearchTerms(query);
    const savedKeywords = new Set(['บันทึก', 'บันทึกแล้ว', 'ข้อมูลบันทึก', 'สำรวจแล้ว', 'recorded', 'saved']);
    return {
        savedOnly: rawTerms.some(term => savedKeywords.has(term)),
        terms: rawTerms.filter(term => !savedKeywords.has(term))
    };
}

function v2JobHasSavedSurvey(job) {
    const properties = job?.properties || {};
    return job?.status === 'done'
        || Boolean(String(properties.note || '').trim())
        || (Array.isArray(properties.images) && properties.images.length > 0)
        || Object.keys(properties.form_data || {}).length > 0
        || (Array.isArray(properties.survey_features) && properties.survey_features.some(feature => feature?.status === 'done'));
}

function v2MatchingFields(properties, terms) {
    const matches = [];
    Object.entries(properties || {}).forEach(([key, value]) => {
        if (matches.length >= 2 || value === null || value === undefined || typeof value === 'object' || key === 'search_text') return;
        const text = String(value);
        if (terms.some(term => `${key} ${text}`.toLocaleLowerCase('th').includes(term))) matches.push(`${key}: ${text}`);
    });
    return matches;
}

function v2RankPlotSearchResults(jobs, terms) {
    return [...jobs].sort((a, b) => {
        const score = job => {
            const props = job.properties || {};
            const primary = `${job.id} ${props.name || ''}`.toLocaleLowerCase('th');
            return terms.reduce((total, term) => total + (primary === term ? 1000 : primary.startsWith(term) ? 250 : primary.includes(term) ? 80 : 0), 0);
        };
        return score(b) - score(a) || String(a.properties?.name || a.id).localeCompare(String(b.properties?.name || b.id), 'th');
    });
}

let dataSearchTimer = null;
function scheduleDataSearch() {
    const mode = document.getElementById('search-mode')?.value || 'data';
    if (mode === 'map') { doSearch(); return; }
    window.clearTimeout(dataSearchTimer);
    dataSearchTimer = window.setTimeout(() => doSearch(), 280);
}
window.scheduleDataSearch = scheduleDataSearch;

function onSearchModeChange(clearValue = true) {
    const mode = document.getElementById('search-mode')?.value || 'data';
    const input = document.getElementById('inp-search');
    const results = document.getElementById('search-results');
    if (!input || !results) return;
    if (clearValue) input.value = '';
    selectedPlotSearchJobId = null;
    clearPlotSearchFocus();
    input.placeholder = mode === 'map' ? 'ค้นหาสถานที่ ร้านค้า หรือที่อยู่...' : 'ค้นหาชื่อแปลง รหัส หรือข้อมูลบันทึก · เช่น บันทึก/ค้างชำระ';
    results.innerHTML = '';
    results.classList.remove('active');
    renderMap(false);
    input.focus();
}

function getGoogleMapsApiKey() {
    return String(surveyConfig.googleMapsBrowserKey || window.GOOGLE_MAPS_API_KEY || '').trim();
}

async function loadGooglePlacesLibrary() {
    if (window.google?.maps?.importLibrary) return google.maps.importLibrary('places');
    if (googlePlacesLoaderPromise) return googlePlacesLoaderPromise;
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) throw new Error('ไม่สามารถโหลด Google Maps API Key ได้ กรุณารีเฟรชหน้าเว็บแล้วลองค้นหาอีกครั้ง');

    googlePlacesLoaderPromise = new Promise((resolve, reject) => {
        const callbackName = `surveyGoogleMapsReady_${Date.now()}`;
        const script = document.createElement('script');
        window[callbackName] = async () => {
            try {
                delete window[callbackName];
                resolve(await google.maps.importLibrary('places'));
            } catch (error) {
                googlePlacesLoaderPromise = null;
                reject(error);
            }
        };
        script.async = true;
        script.defer = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=places&language=th&region=TH&callback=${callbackName}`;
        script.onerror = () => {
            delete window[callbackName];
            googlePlacesLoaderPromise = null;
            reject(new Error('โหลด Google Places ไม่สำเร็จ กรุณาตรวจ API Key, Billing และการจำกัด HTTP referrer'));
        };
        document.head.appendChild(script);
    });
    return googlePlacesLoaderPromise;
}

async function searchMapPlaces(query) {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await loadGooglePlacesLibrary();
    if (!googlePlacesSessionToken) googlePlacesSessionToken = new AutocompleteSessionToken();
    const request = {
        input: query,
        language: 'th',
        region: 'th',
        includedRegionCodes: ['th'],
        sessionToken: googlePlacesSessionToken
    };
    if (userMarker) {
        const position = userMarker.getLatLng();
        request.origin = { lat: position.lat, lng: position.lng };
    } else if (map) {
        const center = map.getCenter();
        request.origin = { lat: center.lat, lng: center.lng };
    }
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    return (suggestions || [])
        .map(suggestion => suggestion.placePrediction)
        .filter(Boolean)
        .slice(0, 8)
        .map(prediction => ({
            name: prediction.text?.toString() || 'สถานที่',
            secondaryText: prediction.secondaryText?.toString() || '',
            placePrediction: prediction,
            source: 'Google Maps'
        }));
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

async function copyPlaceSearchLink(index, event) {
    event?.preventDefault();
    event?.stopPropagation();
    const place = window.currentPlaceSearchResults?.[index];
    if (!place) return;
    try {
        if (place.placePrediction && (!Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng)))) {
            const googlePlace = place.placePrediction.toPlace();
            await googlePlace.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
            if (googlePlace.location) {
                place.name = googlePlace.displayName || googlePlace.formattedAddress || place.name;
                place.address = googlePlace.formattedAddress || place.secondaryText || '';
                place.lat = googlePlace.location.lat();
                place.lng = googlePlace.location.lng();
            }
        }
        const query = Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng))
            ? `${place.lat},${place.lng}`
            : `${place.name || ''} ${place.address || place.secondaryText || ''}`.trim();
        await copyTextToClipboard(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'คัดลอกลิงก์สถานที่แล้ว', timer: 1700, showConfirmButton: false });
    } catch (error) {
        Swal.fire('คัดลอกลิงก์ไม่สำเร็จ', error.message || 'กรุณาลองใหม่อีกครั้ง', 'error');
    }
}
window.copyPlaceSearchLink = copyPlaceSearchLink;

async function selectPlaceSearchResult(index, event) {
    // The list stays on screen after previewing a place, just like plot search.
    event?.stopPropagation();
    const place = window.currentPlaceSearchResults?.[index];
    if (!place) return;
    if (place.placePrediction) {
        try {
            const googlePlace = place.placePrediction.toPlace();
            await googlePlace.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
            if (!googlePlace.location) throw new Error('ไม่พบพิกัดของสถานที่นี้');
            place.name = googlePlace.displayName || googlePlace.formattedAddress || place.name;
            place.address = googlePlace.formattedAddress || place.secondaryText || '';
            place.lat = googlePlace.location.lat();
            place.lng = googlePlace.location.lng();
            googlePlacesSessionToken = null;
        } catch (error) {
            return Swal.fire('เปิดสถานที่ไม่สำเร็จ', error.message, 'error');
        }
    }
    if (!Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return;
    selectedPlaceSearchIndex = index;
    document.querySelectorAll('#search-results [data-place-index]').forEach(item => {
        item.classList.toggle('plot-search-selected', Number(item.dataset.placeIndex) === index);
    });
    flyToSearchPreview(null, L.latLng(place.lat, place.lng));
    showPlaceSearchPreview(L.latLng(place.lat, place.lng), place.name);
}

doSearch = async function () {
    const mode = document.getElementById('search-mode')?.value || 'data';
    const search = (document.getElementById('inp-search').value || '').toLocaleLowerCase('th').trim();
    const plotQuery = mode === 'data' ? v2ParsePlotSearchQuery(search) : { terms: [], savedOnly: false };
    const plotTerms = plotQuery.terms;
    const results = document.getElementById('search-results');
    results.innerHTML = '';
    if (!search) {
        selectedPlotSearchJobId = null;
        clearPlotSearchFocus();
        results.classList.remove('active');
        return;
    }

    if (mode === 'map') {
        // A search-preview marker is temporary. Starting another place search
        // clears it unless the user explicitly converted it to a travel pin.
        removePlaceSearchPreview();
        selectedPlaceSearchIndex = null;
        const requestId = ++placeSearchRequestId;
        results.innerHTML = '<div class="p-3 text-xs text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i> กำลังค้นหาสถานที่...</div>';
        results.classList.add('active');
        await new Promise(resolve => setTimeout(resolve, 350));
        if (requestId !== placeSearchRequestId) return;
        try {
            const places = await searchMapPlaces(search);
            if (requestId !== placeSearchRequestId) return;
            window.currentPlaceSearchResults = places;
            results.innerHTML = places.length ? `
                <div class="sticky top-0 z-10 flex items-center justify-between bg-white border-b border-gray-100 px-3 py-2"><span class="text-[10px] font-bold text-gray-600"><i class="fa-solid fa-location-dot text-purple-600 mr-1"></i>แตะรายการเพื่อแสดงหมุด</span><button type="button" onclick="closePlotSearchResults()" class="w-7 h-7 rounded-full text-gray-500 hover:bg-gray-100" aria-label="ปิดผลค้นหา"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="px-3 py-2 text-[10px] text-gray-500 bg-gray-50 border-b">พบ ${places.length} สถานที่ · เลื่อนเพื่อดูรายการอื่น</div>` + places.slice(0, 50).map((place, index) => `
                <div role="button" tabindex="0" data-place-index="${index}" class="w-full text-left p-3 cursor-pointer hover:bg-purple-50" onclick="selectPlaceSearchResult(${index}, event)">
                    <div class="text-sm font-bold text-gray-800"><i class="fa-solid fa-location-dot text-purple-600 mr-1"></i>${v2EscapeHtml(place.name)} <button type="button" onclick="copyPlaceSearchLink(${index}, event)" class="inline-flex align-middle ml-1 text-blue-600 hover:text-blue-800" aria-label="คัดลอกลิงก์สถานที่" title="คัดลอกลิงก์สถานที่"><i class="fa-regular fa-copy"></i></button></div>
                    ${place.secondaryText ? `<div class="text-[10px] text-gray-500 mt-1">${v2EscapeHtml(place.secondaryText)}</div>` : ''}
                    <div class="text-[10px] text-red-500 mt-1"><i class="fab fa-google mr-1"></i>${v2EscapeHtml(place.source)} · แตะเพื่อแสดงตำแหน่งบนแผนที่</div>
                </div>`).join('') + '<div class="sticky bottom-0 bg-white/95 border-t border-gray-100 px-3 py-2 text-center text-[10px] text-gray-400 backdrop-blur">แตะหมุดบนแผนที่เพื่อปักหมุดหรือนำทาง</div>' : '<div class="p-3 text-xs text-gray-500">ไม่พบสถานที่ ลองระบุจังหวัดหรืออำเภอเพิ่ม</div>';
            results.classList.add('active');
        } catch (error) {
            if (requestId !== placeSearchRequestId) return;
            results.innerHTML = `<div class="p-3 text-xs text-red-600">${v2EscapeHtml(error.message)}</div>`;
            results.classList.add('active');
        }
        return;
    }

    renderMap();
    const hits = v2RankPlotSearchResults(getFilteredJobs(), plotTerms);
    if (selectedPlotSearchJobId && !hits.some(job => job.id === selectedPlotSearchJobId)) {
        selectedPlotSearchJobId = null;
        clearPlotSearchFocus();
    }
    results.classList.toggle('active', true);
    if (!hits.length) {
        const searchDescription = plotQuery.savedOnly ? 'เงื่อนไข “มีผลบันทึกแล้ว”' : plotTerms.map(term => `“${v2EscapeHtml(term)}”`).join(' + ');
        results.innerHTML = `<div class="p-3 text-xs text-gray-500"><i class="fa-solid fa-magnifying-glass mr-1"></i>ไม่พบแปลงที่ตรงกับ ${searchDescription}<div class="text-[10px] text-gray-400 mt-1">ลองตัดคำบางส่วนออก หรือใช้ / เพื่อค้นหาหลายเงื่อนไข</div></div>`;
        return;
    }
    const scopeHint = plotQuery.savedOnly
        ? `<div class="px-3 py-2 text-[10px] font-bold text-violet-700 bg-violet-50 border-b border-violet-100"><i class="fa-solid fa-floppy-disk mr-1"></i>เฉพาะแปลงที่มีผลบันทึกแล้ว${plotTerms.length ? ` · ค้นหาเพิ่ม: ${plotTerms.map(term => `<span class="inline-block bg-white border border-violet-200 rounded px-1.5 py-0.5 ml-1">${v2EscapeHtml(term)}</span>`).join('')}` : ''} · พบ ${hits.length} แปลง</div>`
        : plotTerms.length > 1
        ? `<div class="px-3 py-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 border-b border-emerald-100">ค้นหาครบทุกเงื่อนไข: ${plotTerms.map(term => `<span class="inline-block bg-white border border-emerald-200 rounded px-1.5 py-0.5 mr-1">${v2EscapeHtml(term)}</span>`).join('')} · พบ ${hits.length} แปลง</div>`
        : `<div class="px-3 py-2 text-[10px] text-gray-500 bg-gray-50 border-b">พบ ${hits.length} แปลง · เลื่อนเพื่อดูรายการอื่น</div>`;
    results.innerHTML = `<div class="sticky top-0 z-10 flex items-center justify-between bg-white border-b border-gray-100 px-3 py-2"><span class="text-[10px] font-bold text-gray-600"><i class="fa-solid fa-location-crosshairs text-emerald-600 mr-1"></i>แตะรายการเพื่อซูมดูแปลง</span><button type="button" onclick="closePlotSearchResults()" class="w-7 h-7 rounded-full text-gray-500 hover:bg-gray-100" aria-label="ปิดผลค้นหา"><i class="fa-solid fa-xmark"></i></button></div>${scopeHint}`;
    hits.slice(0, 50).forEach(job => {
        const properties = job.properties || {};
        const matches = v2MatchingFields(properties, plotTerms);
        const isSelected = job.id === selectedPlotSearchJobId;
        results.innerHTML += `
            <button type="button" class="w-full text-left p-3 border-b hover:bg-gray-50 ${isSelected ? 'plot-search-selected' : ''}" onclick="previewPlotFromSearch('${v2EscapeHtml(job.id)}', event)">
                <div class="flex items-center justify-between gap-2"><div class="text-sm font-bold text-gray-800 truncate">${v2EscapeHtml(properties.name || '(ไม่มีชื่อแปลง)')}</div>${isSelected ? '<span class="shrink-0 text-[10px] font-bold text-emerald-700"><i class="fa-solid fa-location-crosshairs"></i> บนแผนที่</span>' : ''}</div>
                <div class="text-[10px] text-blue-600 mt-0.5">${v2EscapeHtml(matches.join(' · ') || `พบใน Base Map · ${job.category}`)}</div>
                ${properties.note ? `<div class="text-[10px] text-gray-500 truncate mt-0.5">${v2EscapeHtml(properties.note)}</div>` : ''}
            </button>`;
    });
    results.innerHTML += `<div class="sticky bottom-0 flex gap-2 p-2 bg-white/95 border-t border-gray-100 backdrop-blur">${selectedPlotSearchJobId ? '<button type="button" onclick="openSelectedPlotSearchDetails()" class="w-full rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white">ดูรายละเอียดแปลงที่เลือก</button>' : '<span class="w-full py-1 text-center text-[10px] text-gray-400">แสดงครั้งละประมาณ 3 รายการ · เลื่อนเพื่อดูต่อ</span>'}</div>`;
};

window.onSearchModeChange = onSearchModeChange;
window.selectPlaceSearchResult = selectPlaceSearchResult;

addCat = async function () {
    const result = await Swal.fire({
        input: 'text',
        title: 'สร้างกลุ่มการบันทึกใหม่',
        inputPlaceholder: 'เช่น สำรวจเดือนกรกฎาคม',
        showCancelButton: true,
        confirmButtonText: 'สร้างกลุ่มงาน',
        cancelButtonText: 'ยกเลิก',
        inputValidator: value => !value?.trim() ? 'กรุณาระบุชื่อกลุ่มงาน' : undefined
    });
    if (!result.isConfirmed) return;
    try {
        await v2EnsureWorkGroup(result.value.trim());
        await syncJobsFromDB(false);
        Swal.fire({ toast: true, icon: 'success', title: `สร้างกลุ่มงาน “${result.value.trim()}” แล้ว`, timer: 1600, showConfirmButton: false });
    } catch (error) {
        Swal.fire('สร้างกลุ่มงานไม่สำเร็จ', error.message, 'error');
    }
};

window.importData = importData;
window.renderImportedMapsList = renderImportedMapsList;
window.deleteImportedMap = deleteImportedMap;
window.doSearch = doSearch;
window.addCat = addCat;

