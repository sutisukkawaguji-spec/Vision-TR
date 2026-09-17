// Public browser configuration only.
// Never put Supabase secret/service_role keys or unrestricted server API keys here.
const surveyPublicConfig = {
    supabaseUrl: 'https://eocbxntymzwbgqaodvse.supabase.co',
    supabasePublishableKey: 'sb_publishable_FgUG7gVuo0sC_ILhzkToUw_IcZ0FjuZ',

    // A browser key is visible to users by design. Restrict it in Google Cloud to:
    //   - Websites (HTTP referrers)
    //   - Maps JavaScript API
    //   - Places API (New)
    googleMapsBrowserKey: 'AIzaSyAWnb6S0zVLvNyv_vXke1gs2Qm68eQFVrY',

    // Every device must authenticate before it can see survey data.
    devBypassAuth: false
};

const surveyLocalConfig = window.SURVEY_LOCAL_CONFIG || {};
window.SURVEY_CONFIG = Object.freeze({ ...surveyPublicConfig, ...surveyLocalConfig });
