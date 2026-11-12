package expo.modules.livechatbubbles

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

class LivechatFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    super.onMessageReceived(remoteMessage)

    if (remoteMessage.data["type"] != "livechat_message") return

    val foreground = ProcessLifecycleOwner.get()
      .lifecycle
      .currentState
      .isAtLeast(Lifecycle.State.RESUMED)

    runCatching {
      LivechatNotifications.handleMessage(applicationContext, remoteMessage.data, foreground)
    }
  }
}
