import React, { useRef, useState } from "react";
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from "react-native";
import { WebView, WebViewNavigation } from "react-native-webview";

const BASE_URL = "http://localhost:3000/administrator";
const ALLOWED_ORIGINS = ["http://localhost:3000"];

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!ALLOWED_ORIGINS.includes(`${u.protocol}//${u.host}`)) {
      return false;
    }
    const path = u.pathname;
    // Allow auth/login paths
    if (path === "/administrator" || path === "/administrator/") return true;
    if (path === "/administrator/login") return true;
    if (path.startsWith("/api/auth/")) return true;
    // Allow static/assets
    if (path.startsWith("/_next/") || path.startsWith("/static/") || path.startsWith("/image_logo/")) return true;
    // Only allow livechat
    if (path === "/administrator/livechat" || path.startsWith("/administrator/livechat/")) return true;
    return false;
  } catch {
    return false;
  }
}

export default function WebViewScreen() {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleNavigation = (navState: WebViewNavigation) => {
    const url = navState.url;
    if (!isAllowedUrl(url)) {
      // Try to redirect to livechat if authenticated, else to login
      webViewRef.current?.stopLoading();
      webViewRef.current?.injectJavaScript(`
        (function(){
          try {
            fetch('/api/auth/me').then(r=>{
              if(r.ok){ window.location.href='/administrator/livechat'; }
              else { window.location.href='/administrator'; }
            }).catch(()=>{ window.location.href='/administrator'; });
          } catch(e){ window.location.href='/administrator'; }
        })();
        true;
      `);
      return false;
    }
    return true;
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => { setError(null); setLoading(true); webViewRef.current?.reload(); }}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: BASE_URL }}
        style={styles.webview}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#040f2d" />
          </View>
        )}
        onShouldStartLoadWithRequest={(req) => handleNavigation(req as WebViewNavigation)}
        onNavigationStateChange={handleNavigation}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setError(nativeEvent.description || "Failed to load page");
        }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#040f2d" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#040f2d", padding: 20 },
  errorText: { color: "white", textAlign: "center", marginBottom: 20 },
  button: { backgroundColor: "white", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  buttonText: { color: "#040f2d", fontWeight: "bold" },
  loadingOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#040f2d" }
});
