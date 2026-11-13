package expo.modules.livechatbubbles

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

object LivechatNotifications {
  private const val PREFS_NAME = "livechat_bubbles"
  private const val KEY_CONVERSATION_IDS = "conversation_ids"
  private const val KEY_BUBBLES_CONFIGURED = "bubbles_configured"
  private const val CHANNEL_ID = "livechat"
  private const val SILENT_CHANNEL_ID = "livechat_silent"
  private const val TAG_PREFIX = "livechat_conversation_"
  private const val SHORTCUT_ID_PREFIX = "livechat_"
  private const val NOTIFICATION_ID_OFFSET = 700000
  private const val DEFAULT_SENDER = "LiveChat"
  private const val MESSAGE_TEXT = "New LiveChat message"
  private const val DEEP_LINK_SCHEME = "kmcqadminmobilechatapp"

  fun handleMessage(context: Context, data: Map<String, String>, foreground: Boolean) {
    if (data["type"] != "livechat_message") return

    val conversationId = data["conversationId"]?.toIntOrNull()?.takeIf { it > 0 } ?: return
    val senderName = data["senderName"]?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_SENDER

    ensureChannels(context)
    createShortcut(context, conversationId, senderName)
    rememberConversation(context, conversationId)

    val notification = buildNotification(context, conversationId, senderName, foreground)
    runCatching {
      NotificationManagerCompat.from(context).notify(tag(conversationId), notificationId(conversationId), notification)
    }
  }

  fun clearConversation(context: Context, conversationId: Int) {
    if (conversationId <= 0) return

    NotificationManagerCompat.from(context).cancel(tag(conversationId), notificationId(conversationId))
    forgetConversation(context, conversationId)
    runCatching {
      ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(shortcutId(conversationId)))
    }
  }

  fun clearAll(context: Context) {
    val ids = storedConversationIds(context)
    ids.forEach { id ->
      NotificationManagerCompat.from(context).cancel(tag(id), notificationId(id))
    }
    runCatching {
      ShortcutManagerCompat.removeDynamicShortcuts(context, ids.map(::shortcutId))
    }
    conversationPrefs(context).edit().remove(KEY_CONVERSATION_IDS).apply()
  }

  private fun buildNotification(
    context: Context,
    conversationId: Int,
    senderName: String,
    foreground: Boolean
  ): android.app.Notification {
    val builder = NotificationCompat.Builder(
      context,
      if (foreground) SILENT_CHANNEL_ID else CHANNEL_ID
    )
      .setSmallIcon(appIcon(context))
      .setContentTitle(senderName)
      .setContentText(MESSAGE_TEXT)
      .setStyle(messagingStyle(senderName))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(if (foreground) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(contentIntent(context, conversationId))
      .setAutoCancel(true)
      .setOnlyAlertOnce(foreground)
      .setSilent(foreground)
      .setShowWhen(true)
      .setWhen(System.currentTimeMillis())
      .setColor(Color.rgb(39, 163, 67))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    if (!foreground) {
      builder
        .setShortcutId(shortcutId(conversationId))
        .setBubbleMetadata(bubbleMetadata(context, conversationId))
    }

    return builder.build()
  }

  private fun messagingStyle(senderName: String): NotificationCompat.MessagingStyle {
    val visitor = Person.Builder()
      .setName(senderName)
      .setImportant(true)
      .build()
    val agent = Person.Builder()
      .setName("You")
      .build()

    return NotificationCompat.MessagingStyle(agent)
      .setGroupConversation(false)
      .addMessage(MESSAGE_TEXT, System.currentTimeMillis(), visitor)
  }

  private fun bubbleMetadata(context: Context, conversationId: Int): NotificationCompat.BubbleMetadata {
    return NotificationCompat.BubbleMetadata.Builder(
      contentIntent(context, conversationId),
      IconCompat.createWithResource(context, appIcon(context))
    )
      .setDesiredHeight(640)
      .setAutoExpandBubble(false)
      .setSuppressNotification(false)
      .build()
  }

  private fun createShortcut(context: Context, conversationId: Int, senderName: String) {
    val shortcut = ShortcutInfoCompat.Builder(context, shortcutId(conversationId))
      .setShortLabel(senderName.take(40))
      .setLongLabel("LiveChat with ${senderName.take(40)}")
      .setIcon(IconCompat.createWithResource(context, appIcon(context)))
      .setIntent(deepLinkIntent(context, conversationId))
      .setLongLived(true)
      .setPerson(
        Person.Builder()
          .setName(senderName)
          .setKey(shortcutId(conversationId))
          .setImportant(true)
          .build()
      )
      .build()

    runCatching {
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    }
  }

  private fun contentIntent(context: Context, conversationId: Int): PendingIntent {
    return PendingIntent.getActivity(
      context,
      conversationId,
      deepLinkIntent(context, conversationId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun deepLinkIntent(context: Context, conversationId: Int): Intent {
    val uri = Uri.parse("$DEEP_LINK_SCHEME://livechat?conversationId=$conversationId")
    return Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(context.packageName)
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
      )
    }
  }

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val prefs = conversationPrefs(context)

    val livechat = manager.getNotificationChannel(CHANNEL_ID)
    if (livechat == null || !prefs.getBoolean(KEY_BUBBLES_CONFIGURED, false)) {
      if (livechat != null) {
        manager.deleteNotificationChannel(CHANNEL_ID)
      }
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "LiveChat messages", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "New visitor messages"
          setSound(
            Uri.parse("android.resource://${context.packageName}/raw/kmcq_gmbh_doorbell"),
            AudioAttributes.Builder()
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .setUsage(AudioAttributes.USAGE_NOTIFICATION)
              .build()
          )
          enableVibration(true)
          setShowBadge(true)
          setAllowBubbles(true)
        }
      )
      prefs.edit().putBoolean(KEY_BUBBLES_CONFIGURED, true).apply()
    }

    if (manager.getNotificationChannel(SILENT_CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(SILENT_CHANNEL_ID, "LiveChat updates", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Silent updates while LiveChat is open"
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
        }
      )
    }
  }

  private fun rememberConversation(context: Context, conversationId: Int) {
    val ids = storedConversationIds(context)
    if (ids.add(conversationId)) {
      conversationPrefs(context).edit()
        .putStringSet(KEY_CONVERSATION_IDS, ids.map(Int::toString).toSet())
        .apply()
    }
  }

  private fun forgetConversation(context: Context, conversationId: Int) {
    val ids = storedConversationIds(context)
    if (ids.remove(conversationId)) {
      conversationPrefs(context).edit()
        .putStringSet(KEY_CONVERSATION_IDS, ids.map(Int::toString).toSet())
        .apply()
    }
  }

  private fun storedConversationIds(context: Context): MutableSet<Int> {
    return conversationPrefs(context)
      .getStringSet(KEY_CONVERSATION_IDS, emptySet())
      ?.mapNotNull(String::toIntOrNull)
      ?.toMutableSet()
      ?: mutableSetOf()
  }

  private fun conversationPrefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun appIcon(context: Context): Int =
    context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.stat_notify_chat

  private fun tag(conversationId: Int) = "$TAG_PREFIX$conversationId"

  private fun shortcutId(conversationId: Int) = "$SHORTCUT_ID_PREFIX$conversationId"

  private fun notificationId(conversationId: Int) =
    NOTIFICATION_ID_OFFSET + Math.floorMod(conversationId, 1_000_000)
}
