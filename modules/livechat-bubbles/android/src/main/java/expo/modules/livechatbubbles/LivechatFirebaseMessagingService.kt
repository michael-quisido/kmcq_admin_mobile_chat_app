package expo.modules.livechatbubbles

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

class LivechatFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    super.onMessageReceived(remoteMessage)

    val data = livechatData(remoteMessage.data)
    if (data["type"] != "livechat_message") return

    val foreground = ProcessLifecycleOwner.get()
      .lifecycle
      .currentState
      .isAtLeast(Lifecycle.State.RESUMED)

    runCatching {
      LivechatNotifications.handleMessage(applicationContext, data, foreground)
    }
  }

  private fun livechatData(data: Map<String, String>): Map<String, String> {
    val body = data["body"] ?: return data
    val parsed = runCatching { JSONObject(body) }.getOrNull() ?: return data

    return buildMap {
      putAll(data)
      parsed.keys().forEach { key ->
        put(key, parsed.optString(key))
      }
    }
  }
}
