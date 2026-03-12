package com.githubcopilot.jsm.tomcat;

import org.apache.catalina.Lifecycle;
import org.apache.catalina.LifecycleEvent;
import org.apache.catalina.LifecycleListener;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class StartupLifecycleListener implements LifecycleListener {
    private static final String CALLBACK_URL_PROPERTY = "jsm.startup.callback.url";
    private static final String CALLBACK_TOKEN_PROPERTY = "jsm.startup.callback.token";
    private static final String STARTUP_ID_PROPERTY = "jsm.startup.callback.startupId";
    private static final String SERVER_KEY_PROPERTY = "jsm.startup.callback.serverKey";

    private volatile boolean outcomeDelivered;

    @Override
    public void lifecycleEvent(LifecycleEvent event) {
        if (outcomeDelivered) {
            return;
        }

        String eventType = event.getType();
        if (Lifecycle.AFTER_START_EVENT.equals(eventType)) {
            tryNotify("started", "Tomcat server started");
            return;
        }

        if (Lifecycle.BEFORE_STOP_EVENT.equals(eventType) || Lifecycle.AFTER_STOP_EVENT.equals(eventType)) {
            tryNotify("failed", "Tomcat stopped before startup completed");
        }
    }

    private synchronized void tryNotify(String status, String message) {
        if (outcomeDelivered) {
            return;
        }

        String callbackUrl = System.getProperty(CALLBACK_URL_PROPERTY);
        String token = System.getProperty(CALLBACK_TOKEN_PROPERTY);
        String startupId = System.getProperty(STARTUP_ID_PROPERTY);
        String serverKey = System.getProperty(SERVER_KEY_PROPERTY, "unknown");

        if (isBlank(callbackUrl) || isBlank(token) || isBlank(startupId)) {
            return;
        }

        HttpURLConnection connection = null;

        try {
            URL url = new URL(callbackUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");

            String payload = "{" +
                quote("token") + ":" + quote(token) + "," +
                quote("startupId") + ":" + quote(startupId) + "," +
                quote("serverKey") + ":" + quote(serverKey) + "," +
                quote("status") + ":" + quote(status) + "," +
                quote("message") + ":" + quote(message) +
                "}";

            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);

            OutputStream out = connection.getOutputStream();
            try {
                out.write(bytes);
                out.flush();
            } finally {
                out.close();
            }

            int responseCode = connection.getResponseCode();
            if (responseCode >= 200 && responseCode < 300) {
                outcomeDelivered = true;
            }
        } catch (IOException ignored) {
            // Best effort only. The extension still has process-exit and timeout fallbacks.
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static String quote(String value) {
        return "\"" + escapeJson(value) + "\"";
    }

    private static String escapeJson(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    escaped.append(ch);
            }
        }
        return escaped.toString();
    }
}