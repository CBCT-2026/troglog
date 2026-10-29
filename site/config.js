// Private sync settings. Fill these in once your free Supabase project exists (see SETUP-SYNC.md).
// The anon key is meant to be public: row-level security means only your signed-in account
// can read or write your journal and photos.
window.TROGLOG_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefghijk.supabase.co"
  supabaseAnonKey: "",  // Project Settings → API → "anon public" key
  lockWhenSignedOut: true, // show a sign-in screen instead of the app until you sign in
};
