package expo.modules.livechatbubbles

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LivechatBubblesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LivechatBubbles")

    AsyncFunction("clearConversation") { conversationId: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      LivechatNotifications.clearConversation(context, conversationId)
      null
    }

    AsyncFunction("clearAll") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      LivechatNotifications.clearAll(context)
      null
    }
  }
}
