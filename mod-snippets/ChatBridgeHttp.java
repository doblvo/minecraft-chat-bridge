/*
  Snippet base para Forge.
  Ajusta BACKEND_URL y MOD_SECRET, o mejor léelos desde un config del mod.
  Este archivo es referencia: puede requerir ajustes según tu versión exacta de Forge/Minecraft.
*/

package com.felipe.chatbridge;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public class ChatBridgeHttp {
    private static final String BACKEND_URL = "https://minecraft-chat-bridge.onrender.com";
    private static final String MOD_SECRET = "CAMBIA_ESTO_POR_EL_MOD_SECRET_DE_RENDER";
    private static final String SERVER_ID = "main";

    private static final Gson GSON = new Gson();
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    public static void sendMinecraftChat(String player, String message) {
        JsonObject body = new JsonObject();
        body.addProperty("serverId", SERVER_ID);
        body.addProperty("player", player);
        body.addProperty("message", message);

        postJson("/mc/chat", body);
    }

    public static void sendPlayersHeartbeat(int maxPlayers, List<String> players) {
        JsonObject body = new JsonObject();
        body.addProperty("serverId", SERVER_ID);
        body.addProperty("online", true);
        body.addProperty("maxPlayers", maxPlayers);

        JsonArray arr = new JsonArray();
        for (String player : players) {
            arr.add(player);
        }
        body.add("players", arr);

        postJson("/mc/players", body);
    }

    public static CompletableFuture<WebMessage[]> pollWebMessages() {
        try {
            String serverIdEncoded = URLEncoder.encode(SERVER_ID, StandardCharsets.UTF_8);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(BACKEND_URL + "/mc/outbox?serverId=" + serverIdEncoded))
                    .timeout(Duration.ofSeconds(5))
                    .header("x-mod-secret", MOD_SECRET)
                    .GET()
                    .build();

            return CLIENT.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenApply(response -> {
                        if (response.statusCode() != 200) return new WebMessage[0];

                        JsonObject root = JsonParser.parseString(response.body()).getAsJsonObject();
                        if (!root.has("messages") || !root.get("messages").isJsonArray()) return new WebMessage[0];

                        JsonArray arr = root.getAsJsonArray("messages");
                        List<WebMessage> messages = new ArrayList<>();

                        for (int i = 0; i < arr.size(); i++) {
                            JsonObject item = arr.get(i).getAsJsonObject();
                            String player = item.has("player") ? item.get("player").getAsString() : "Web";
                            String message = item.has("message") ? item.get("message").getAsString() : "";
                            if (!message.isBlank()) messages.add(new WebMessage(player, message));
                        }

                        return messages.toArray(new WebMessage[0]);
                    })
                    .exceptionally(error -> new WebMessage[0]);
        } catch (Exception e) {
            return CompletableFuture.completedFuture(new WebMessage[0]);
        }
    }

    private static void postJson(String path, JsonObject body) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(BACKEND_URL + path))
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .header("x-mod-secret", MOD_SECRET)
                    .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body)))
                    .build();

            CLIENT.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .exceptionally(error -> null);
        } catch (Exception ignored) {}
    }

    public static class WebMessage {
        public final String player;
        public final String message;

        public WebMessage(String player, String message) {
            this.player = player;
            this.message = message;
        }
    }
}
