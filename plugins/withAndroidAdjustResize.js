const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const MAIN_ACTIVITY = ".MainActivity";

function withAndroidAdjustResize(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults;
    if (!manifest.manifest) return configWithManifest;

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const mainActivity = (application.activity || []).find(
      (activity) => activity.$?.["android:name"] === MAIN_ACTIVITY,
    );

    if (mainActivity) {
      mainActivity.$ = mainActivity.$ || {};
      mainActivity.$["android:windowSoftInputMode"] = "adjustResize";
    }

    return configWithManifest;
  });
}

module.exports = withAndroidAdjustResize;
