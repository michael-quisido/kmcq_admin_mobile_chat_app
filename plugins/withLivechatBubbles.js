const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const EXPO_FIREBASE_SERVICE =
  "expo.modules.notifications.service.ExpoFirebaseMessagingService";
const MAIN_ACTIVITY = ".MainActivity";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";

function withLivechatBubbles(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults;
    if (!manifest.manifest) return configWithManifest;

    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$["xmlns:tools"]) {
      manifest.manifest.$["xmlns:tools"] = TOOLS_NAMESPACE;
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    application.service = application.service || [];
    const alreadyRemoved = application.service.some(
      (service) =>
        service.$?.["android:name"] === EXPO_FIREBASE_SERVICE &&
        service.$?.["tools:node"] === "remove",
    );
    if (!alreadyRemoved) {
      application.service.push({
        $: {
          "android:name": EXPO_FIREBASE_SERVICE,
          "tools:node": "remove",
        },
      });
    }

    const mainActivity = (application.activity || []).find(
      (activity) => activity.$?.["android:name"] === MAIN_ACTIVITY,
    );
    if (mainActivity) {
      mainActivity.$ = mainActivity.$ || {};
      mainActivity.$["android:resizeableActivity"] = "true";
    }

    return configWithManifest;
  });
}

module.exports = withLivechatBubbles;
