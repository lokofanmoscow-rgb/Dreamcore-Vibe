package com.dreamcore.vibe;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the three.js game in a fullscreen WebView.
 * Assets are served from a virtual https origin so that fetch(), audio and
 * WebGL texture uploads behave exactly like on a normal web server.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE = "https://" + HOST + "/";

    private WebView web;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new AssetClient(getAssets()));

        setContentView(web);
        hideSystemUi();
        web.loadUrl(BASE + "index.html");
    }

    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.evaluateJavascript("window.__appPause && window.__appPause()", null);
            web.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.__appResume && window.__appResume()", null);
        }
        hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript("(window.__appBack && window.__appBack()) ? 1 : 0", value -> {
                if (!"1".equals(value)) moveTaskToBack(true);
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** JS -> native calls. */
    private class Bridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> finishAndRemoveTask());
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            } catch (Exception ignored) {
            }
        }
    }

    /** Serves files from the APK assets folder under https://appassets.androidplatform.net/ */
    private static class AssetClient extends WebViewClient {
        private final AssetManager assets;
        private final Map<String, byte[]> cache = new HashMap<>();

        AssetClient(AssetManager assets) {
            this.assets = assets;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (!HOST.equals(request.getUrl().getHost())) return null;
            String path = request.getUrl().getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            path = path.substring(1);
            byte[] data;
            try {
                data = load(path);
            } catch (IOException e) {
                WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8",
                        new ByteArrayInputStream(new byte[0]));
                r.setStatusCodeAndReasonPhrase(404, "Not Found");
                return r;
            }
            String mime = mime(path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-cache");

            String range = request.getRequestHeaders() != null ? request.getRequestHeaders().get("Range") : null;
            if (range == null) range = request.getRequestHeaders() != null ? request.getRequestHeaders().get("range") : null;
            if (range != null && range.startsWith("bytes=")) {
                try {
                    String[] parts = range.substring(6).split("-", -1);
                    int start = parts[0].isEmpty() ? 0 : Integer.parseInt(parts[0].trim());
                    int end = (parts.length > 1 && !parts[1].trim().isEmpty())
                            ? Integer.parseInt(parts[1].trim()) : data.length - 1;
                    if (end >= data.length) end = data.length - 1;
                    if (start > end) start = 0;
                    int len = end - start + 1;
                    headers.put("Content-Range", "bytes " + start + "-" + end + "/" + data.length);
                    headers.put("Content-Length", String.valueOf(len));
                    return new WebResourceResponse(mime, null, 206, "Partial Content", headers,
                            new ByteArrayInputStream(data, start, len));
                } catch (NumberFormatException ignored) {
                }
            }
            headers.put("Content-Length", String.valueOf(data.length));
            return new WebResourceResponse(mime, null, 200, "OK", headers, new ByteArrayInputStream(data));
        }

        private synchronized byte[] load(String path) throws IOException {
            byte[] cached = cache.get(path);
            if (cached != null) return cached;
            try (InputStream in = assets.open(path)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(4096, in.available()));
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                byte[] data = out.toByteArray();
                // Audio is large and only requested once per track; keep small files cached.
                if (data.length < 4 * 1024 * 1024) cache.put(path, data);
                return data;
            }
        }

        private static String mime(String p) {
            String l = p.toLowerCase();
            if (l.endsWith(".html")) return "text/html";
            if (l.endsWith(".js") || l.endsWith(".mjs")) return "application/javascript";
            if (l.endsWith(".css")) return "text/css";
            if (l.endsWith(".json")) return "application/json";
            if (l.endsWith(".png")) return "image/png";
            if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
            if (l.endsWith(".webp")) return "image/webp";
            if (l.endsWith(".svg")) return "image/svg+xml";
            if (l.endsWith(".mp3")) return "audio/mpeg";
            if (l.endsWith(".ogg")) return "audio/ogg";
            if (l.endsWith(".m4a")) return "audio/mp4";
            if (l.endsWith(".wav")) return "audio/wav";
            if (l.endsWith(".woff2")) return "font/woff2";
            return "application/octet-stream";
        }
    }
}
